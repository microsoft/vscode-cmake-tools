/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
'use strict';

/**
 * Localization verifier.
 *
 * Guards the checked-in translations under `i18n/` against two classes of problem that an automatic
 * localization import can reintroduce:
 *
 *  1. Fix reversion: a human-reviewed translation recorded in the verified-fix ledger
 *     (jobs/loc/translation-fixes.json) is silently replaced by a different translation.
 *  2. Structural damage: a translation drops/adds/reorders the placeholders (`{0}`), `${variables}`,
 *     `#setting.id#` references, backtick code spans, or URLs that its English source contains,
 *     which breaks the string at runtime.
 *
 * The module is intentionally free of any build-time dependency (only `fs`, `path`, and
 * `jsonc-parser`, which the repo already ships) so its pure functions can be unit-tested directly.
 */

const fs = require('fs');
const path = require('path');
const jsonc = require('jsonc-parser');

const LEDGER_RELPATH = path.join('jobs', 'loc', 'translation-fixes.json');

/**
 * Extract the structural tokens that must be preserved verbatim across a translation.
 * Returns sorted arrays so two token sets can be compared as multisets.
 * @param {string} text
 */
function extractTokens(text) {
    const find = (re) => {
        const out = [];
        let m;
        const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        while ((m = r.exec(text)) !== null) {
            out.push(m[0]);
            if (m.index === r.lastIndex) {
                r.lastIndex++;
            }
        }
        return out.sort();
    };
    return {
        // Numeric message placeholders: {0}, {1}, ...
        placeholders: find(/\{\d+\}/g),
        // Expansion variables: ${testName}, ${sourceDir}, ...
        variables: find(/\$\{[^}]+\}/g),
        // Setting cross-references rendered as links: #cmake.revealLog#
        settings: find(/#[A-Za-z0-9_.]+#/g),
        // Inline code spans: `true`, `CMakeLists.txt`, ...
        codeSpans: find(/`[^`]*`/g),
        // URLs
        urls: find(/https?:\/\/[^\s)]+/g)
    };
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function multisetEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/**
 * Compare the structural tokens of an English source against a translation.
 * Returns a list of the token categories whose multisets differ.
 * @param {string} source English source string.
 * @param {string} translation Translated string.
 * @returns {{ category: string, source: string[], translation: string[] }[]}
 */
function compareStructure(source, translation) {
    const s = extractTokens(source);
    const t = extractTokens(translation);
    const problems = [];
    for (const category of Object.keys(s)) {
        if (!multisetEqual(s[category], t[category])) {
            problems.push({ category, source: s[category], translation: t[category] });
        }
    }
    return problems;
}

/**
 * Parse a JSONC `.i18n.json` file (they carry a machine-generated header comment) into a flat map.
 * @param {string} absPath
 * @returns {Record<string, string>}
 */
function readI18nFile(absPath) {
    const text = fs.readFileSync(absPath, 'utf8');
    const errors = [];
    const parsed = jsonc.parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
        throw new Error(`Malformed JSON in ${absPath}: ${jsonc.printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
    }
    return parsed || {};
}

/**
 * @param {string} repoRoot
 * @returns {{ $schema?: string, version: number, locales: Record<string, Record<string, Record<string, { value: string, source?: string, note?: string }>>> }}
 */
function loadLedger(repoRoot) {
    const abs = path.join(repoRoot, LEDGER_RELPATH);
    const text = fs.readFileSync(abs, 'utf8');
    return JSON.parse(text);
}

/**
 * Load the English source strings for `package.nls.json` keys (used to structurally lint the
 * `package.i18n.json` translations). Values may be a plain string or a `{ message, comment }` object.
 * @param {string} repoRoot
 * @returns {Record<string, string>}
 */
function loadPackageEnglish(repoRoot) {
    const text = fs.readFileSync(path.join(repoRoot, 'package.nls.json'), 'utf8');
    const nls = jsonc.parse(text);
    const out = {};
    for (const key of Object.keys(nls)) {
        const v = nls[key];
        out[key] = (v && typeof v === 'object') ? v.message : v;
    }
    return out;
}

// Token categories checked corpus-wide. Only the unambiguous, high-severity categories are used:
// dropping/mangling a message placeholder or an expansion variable breaks the string at runtime,
// and (unlike code spans / prose) these are never legitimately altered by translation. `settings`
// and `codeSpans` have known pre-existing debt and are only checked for curated ledger entries.
const CORPUS_TOKEN_CATEGORIES = ['placeholders', 'variables'];

/**
 * Structurally lint every `package.i18n.json` translation that has an English source, on the
 * high-severity token categories. Returns the divergences found.
 * @param {string} repoRoot
 * @returns {{ locale: string, key: string, problems: ReturnType<typeof compareStructure>, i18nPath: string }[]}
 */
function verifyPackageCorpus(repoRoot) {
    const english = loadPackageEnglish(repoRoot);
    const i18nRoot = path.join(repoRoot, 'i18n');
    const violations = [];
    if (!fs.existsSync(i18nRoot)) {
        return violations;
    }
    for (const locale of fs.readdirSync(i18nRoot)) {
        const pkgAbs = path.join(i18nRoot, locale, 'package.i18n.json');
        if (!fs.existsSync(pkgAbs)) {
            continue;
        }
        const translations = readI18nFile(pkgAbs);
        for (const key of Object.keys(translations)) {
            const source = english[key];
            if (typeof source !== 'string' || typeof translations[key] !== 'string') {
                continue;
            }
            const problems = compareStructure(source, translations[key])
                .filter(p => CORPUS_TOKEN_CATEGORIES.includes(p.category));
            if (problems.length > 0) {
                violations.push({ locale, key, problems, i18nPath: path.posix.join('i18n', locale, 'package.i18n.json') });
            }
        }
    }
    return violations;
}

/**
 * Verify all ledger entries against the on-disk translations.
 *
 * @param {string} repoRoot
 * @returns {{ reversions: Array<{ locale: string, file: string, key: string, expected: string, actual: string | undefined, i18nPath: string }>, structural: Array<{ locale: string, file: string, key: string, problems: ReturnType<typeof compareStructure>, i18nPath: string }>, checked: number }}
 */
function verify(repoRoot) {
    const ledger = loadLedger(repoRoot);
    const reversions = [];
    const structural = [];
    let checked = 0;

    for (const locale of Object.keys(ledger.locales)) {
        for (const file of Object.keys(ledger.locales[locale])) {
            const i18nRel = path.posix.join('i18n', locale, file);
            const i18nAbs = path.join(repoRoot, 'i18n', locale, ...file.split('/'));
            let contents;
            try {
                contents = readI18nFile(i18nAbs);
            } catch (err) {
                // A ledgered file that is missing or unreadable means its verified fixes are gone.
                // Surface it as a reversion (annotated) rather than crashing out of the run.
                for (const key of Object.keys(ledger.locales[locale][file])) {
                    checked++;
                    reversions.push({ locale, file, key, expected: ledger.locales[locale][file][key].value, actual: undefined, i18nPath: i18nRel });
                }
                continue;
            }
            for (const key of Object.keys(ledger.locales[locale][file])) {
                const entry = ledger.locales[locale][file][key];
                checked++;
                const actual = contents[key];
                if (actual !== entry.value) {
                    reversions.push({ locale, file, key, expected: entry.value, actual, i18nPath: i18nRel });
                }
                // Structural check: the verified translation must carry the same tokens as its
                // English source. This catches a future ledger edit (or hand-fix) that breaks a
                // placeholder/variable/setting/code-span/URL relative to the source.
                if (typeof entry.source === 'string' && typeof entry.value === 'string') {
                    const problems = compareStructure(entry.source, entry.value);
                    if (problems.length > 0) {
                        structural.push({ locale, file, key, problems, i18nPath: i18nRel });
                    }
                }
            }
        }
    }
    return { reversions, structural, checked };
}

/**
 * Restore reverted ledger values in place, preserving the file's comments/formatting.
 * @param {string} repoRoot
 * @returns {{ restored: Array<{ locale: string, file: string, key: string }> }}
 */
function restore(repoRoot) {
    const { reversions } = verify(repoRoot);
    const restored = [];
    // Group by file so we apply all edits to a file at once.
    const byFile = new Map();
    for (const r of reversions) {
        const abs = path.join(repoRoot, 'i18n', r.locale, ...r.file.split('/'));
        if (!byFile.has(abs)) {
            byFile.set(abs, []);
        }
        byFile.get(abs).push(r);
    }
    const ledger = loadLedger(repoRoot);
    for (const [abs, items] of byFile) {
        let text = fs.readFileSync(abs, 'utf8');
        for (const r of items) {
            const value = ledger.locales[r.locale][r.file][r.key].value;
            const edits = jsonc.modify(text, [r.key], value, { formattingOptions: { insertSpaces: false, tabSize: 1 } });
            text = jsonc.applyEdits(text, edits);
            restored.push({ locale: r.locale, file: r.file, key: r.key });
        }
        fs.writeFileSync(abs, text);
    }
    return { restored };
}

/**
 * Emit a GitHub Actions error annotation.
 * @param {string} file
 * @param {string} title
 * @param {string} message
 */
function annotate(file, title, message) {
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error file=${file},title=${esc(title)}::${esc(message)}`);
}

/**
 * Emit a GitHub Actions warning annotation (non-failing, informational tier).
 * @param {string} file
 * @param {string} title
 * @param {string} message
 */
function annotateWarning(file, title, message) {
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::warning file=${file},title=${esc(title)}::${esc(message)}`);
}

// --- Untranslated-import detection ------------------------------------------------------------
//
// A newly added English source string stays English in every locale until the localization team
// translates it in a later cycle; OneLocBuild returns the English <source> as each <target>. The
// English source for `src/*` keys is never committed (it is derived at build time by vscode-nls-dev),
// so we cannot compare a translation against its source. Instead we use a source-free signal:
// a real translation of prose diverges across languages, so a string that is byte-identical across
// many of the ~13 locales AND carries real translatable words is almost certainly untranslated
// English. This is used only to (a) annotate the readiness comment (informational, never blocks a
// partial import) and (b) let the pipeline skip opening a pull request that carries no translation
// progress at all. Brands, symbols, placeholders and short labels are filtered out so legitimately
// identical strings (e.g. "CMake", "Ninja", "{0}") are never flagged.

const UNTRANSLATED_DEFAULTS = {
    // Need at least this many locales present before cross-locale agreement is meaningful.
    requireMinLocales: 6,
    // Flag when a value is identical across >= max(minAgreementFloor, ceil(agreementRatio * total)).
    agreementRatio: 0.6,
    minAgreementFloor: 8,
    // Minimum translatable "units" (Latin words of length >= 2 plus CJK codepoints, brands removed).
    minUnits: 4,
    // Product/tooling names that are legitimately identical across locales; removed before counting.
    brandStopwords: ['cmake', 'cmakelists', 'ctest', 'cpack', 'cmakepresets', 'cmakeuserpresets',
        'ninja', 'makefiles', 'makefile', 'xcode', 'msvc', 'clang', 'gcc', 'kit', 'kits', 'vcpkg',
        'vsinstanceversion', 'visual', 'studio', 'json']
};

/**
 * Normalize a value for cross-locale equality grouping only (never written back). Unifies line
 * endings, applies Unicode NFC, and trims trailing spaces/tabs, so a stray escaping/whitespace
 * difference does not split an otherwise-identical machine-generated value. Interior whitespace and
 * case are deliberately preserved so genuinely distinct strings are not merged.
 * @param {string} s
 */
function normalizeForAgreement(s) {
    return s.replace(/\r\n/g, '\n').normalize('NFC').replace(/[ \t]+$/gm, '');
}

/**
 * Remove the structural tokens that are never localized (placeholders, expansion variables, setting
 * references, inline code spans, URLs) so only translatable prose remains for measurement.
 * @param {string} text
 */
function stripStructuralTokens(text) {
    return text
        .replace(/https?:\/\/[^\s)]+/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/\$\{[^}]+\}/g, ' ')
        .replace(/#[A-Za-z0-9_.]+#/g, ' ')
        .replace(/\{\d+\}/g, ' ');
}

/**
 * Count translatable "units" in a value: Latin/Cyrillic/Greek words (>= 2 letters, excluding brand
 * stopwords) plus CJK codepoints (Han/Hiragana/Katakana/Hangul, which are not space-delimited).
 * Structural tokens are stripped first. Brands, symbols, digits and placeholders contribute nothing,
 * so short/technical strings score low while real sentences score high.
 * @param {string} text
 * @param {typeof UNTRANSLATED_DEFAULTS} [options]
 */
function translatableUnits(text, options) {
    const opts = { ...UNTRANSLATED_DEFAULTS, ...(options || {}) };
    let residue = stripStructuralTokens(text).normalize('NFC');
    const cjk = residue.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
    const cjkCount = cjk.length;
    residue = residue.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ');
    const words = residue.match(/\p{L}[\p{L}\p{M}\d'’\-]*/gu) || [];
    const brands = new Set((opts.brandStopwords || []).map((b) => b.toLowerCase()));
    let wordCount = 0;
    for (const w of words) {
        if (w.length < 2) {
            continue;
        }
        if (brands.has(w.toLowerCase())) {
            continue;
        }
        wordCount++;
    }
    return wordCount + cjkCount;
}

/**
 * The agreement count required to flag, given the number of locales that carry the key.
 * @param {number} total
 * @param {typeof UNTRANSLATED_DEFAULTS} opts
 */
function requiredAgreement(total, opts) {
    return Math.max(opts.minAgreementFloor, Math.ceil(opts.agreementRatio * total));
}

/**
 * Detect likely-untranslated strings from cross-locale agreement. Pure: takes plain data so it can
 * be unit-tested without disk access.
 * @param {{ file: string, key: string, values: Record<string, string> }[]} entries One entry per
 *   (locale-relative file, key), with the raw value per locale.
 * @param {Partial<typeof UNTRANSLATED_DEFAULTS>} [options]
 * @returns {{ file: string, key: string, value: string, agree: number, total: number, units: number, locales: string[], confidence: 'high' | 'medium' }[]}
 */
function detectUntranslated(entries, options) {
    const opts = { ...UNTRANSLATED_DEFAULTS, ...(options || {}) };
    const findings = [];
    for (const entry of entries) {
        const locales = Object.keys(entry.values).filter((l) => typeof entry.values[l] === 'string');
        const total = locales.length;
        if (total < opts.requireMinLocales) {
            continue;
        }
        const groups = new Map();
        for (const loc of locales) {
            const nv = normalizeForAgreement(entry.values[loc]);
            if (!groups.has(nv)) {
                groups.set(nv, []);
            }
            groups.get(nv).push(loc);
        }
        let best = null;
        for (const [nv, locs] of groups) {
            if (!best || locs.length > best.locs.length) {
                best = { nv, locs };
            }
        }
        const agree = best.locs.length;
        if (agree < requiredAgreement(total, opts)) {
            continue;
        }
        if (translatableUnits(best.nv, opts) < opts.minUnits) {
            continue;
        }
        findings.push({
            file: entry.file,
            key: entry.key,
            value: best.nv,
            agree,
            total,
            units: translatableUnits(best.nv, opts),
            locales: best.locs.slice().sort(),
            confidence: agree === total ? 'high' : 'medium'
        });
    }
    return findings;
}

/**
 * Decide whether an import makes real localization progress. Pure.
 *
 * An occurrence is "semantic" when it is an addition/deletion or its normalized value changed (a
 * pure key reorder/reformat is not). A semantic add/update counts as "untranslated" only when THIS
 * locale's new value is exactly the flagged English blob for its (file,key); a locale that received
 * a real (diverging) translation this cycle counts as progress even if the same key is still English
 * in other locales. The import is blocked from opening a PR when either every changed file is pure
 * churn (no semantic change at all) or every semantic add/update is an untranslated English value
 * (no real new translation). A deletion always counts as progress (pruning an obsolete key is
 * legitimate synchronization), so an import is never blocked solely for pruning.
 * @param {{ file: string, key: string, locale: string, base?: string, head?: string, changeType: 'add' | 'update' | 'delete' }[]} changedEntries
 * @param {Map<string, string>} flaggedValues Map of `${file}\u0000${key}` -> the normalized English
 *   value that made it look untranslated (from `reportUntranslated`).
 * @returns {{ semantic: number, progress: number, untranslated: number, block: boolean, reason: string }}
 */
function assessImportProgress(changedEntries, flaggedValues) {
    const flaggedValueFor = (file, key) => (flaggedValues && typeof flaggedValues.get === 'function')
        ? flaggedValues.get(`${file}\u0000${key}`) : undefined;
    let semantic = 0;
    let progress = 0;
    let untranslated = 0;
    for (const e of changedEntries) {
        const isSemantic = e.changeType === 'add' || e.changeType === 'delete'
            || normalizeForAgreement(e.base || '') !== normalizeForAgreement(e.head || '');
        if (!isSemantic) {
            continue;
        }
        semantic++;
        const flaggedValue = e.changeType === 'delete' ? undefined : flaggedValueFor(e.file, e.key);
        // Only this locale's value being the flagged English blob makes it untranslated; a diverging
        // (real) translation in this locale is progress even if the key is still English elsewhere.
        if (flaggedValue !== undefined && normalizeForAgreement(e.head || '') === flaggedValue) {
            untranslated++;
        } else {
            progress++;
        }
    }
    let block = false;
    let reason = '';
    if (changedEntries.length > 0 && semantic === 0) {
        block = true;
        reason = 'no-semantic-change';
    } else if (semantic > 0 && progress === 0) {
        block = true;
        reason = 'no-localization-progress';
    }
    return { semantic, progress, untranslated, block, reason };
}

/**
 * Recursively list `*.i18n.json` files under a directory, returned as directory-relative POSIX paths.
 * @param {string} rootDir
 * @param {string} [rel]
 * @returns {string[]}
 */
function listI18nFiles(rootDir, rel = '') {
    const out = [];
    const abs = path.join(rootDir, rel);
    let entries;
    try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const dirent of entries) {
        const childRel = rel ? path.posix.join(rel, dirent.name) : dirent.name;
        if (dirent.isDirectory()) {
            out.push(...listI18nFiles(rootDir, childRel));
        } else if (dirent.isFile() && dirent.name.endsWith('.i18n.json')) {
            out.push(childRel);
        }
    }
    return out;
}

/**
 * Build the per-(file,key) locale->value map from the checked-in `i18n/<locale>/**` tree.
 * @param {string} repoRoot
 * @returns {{ file: string, key: string, values: Record<string, string> }[]}
 */
function collectLocaleEntries(repoRoot) {
    const i18nRoot = path.join(repoRoot, 'i18n');
    /** @type {Map<string, Map<string, Record<string, string>>>} file -> key -> {locale: value} */
    const byFile = new Map();
    if (!fs.existsSync(i18nRoot)) {
        return [];
    }
    for (const locale of fs.readdirSync(i18nRoot)) {
        const localeDir = path.join(i18nRoot, locale);
        let stat;
        try {
            stat = fs.statSync(localeDir);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) {
            continue;
        }
        for (const relFile of listI18nFiles(localeDir)) {
            let contents;
            try {
                contents = readI18nFile(path.join(localeDir, ...relFile.split('/')));
            } catch {
                continue;
            }
            for (const key of Object.keys(contents)) {
                if (typeof contents[key] !== 'string') {
                    continue;
                }
                if (!byFile.has(relFile)) {
                    byFile.set(relFile, new Map());
                }
                const keyMap = byFile.get(relFile);
                if (!keyMap.has(key)) {
                    keyMap.set(key, {});
                }
                keyMap.get(key)[locale] = contents[key];
            }
        }
    }
    const entries = [];
    for (const [file, keyMap] of byFile) {
        for (const [key, values] of keyMap) {
            entries.push({ file, key, values });
        }
    }
    return entries;
}

/**
 * Scan the checked-in translations for likely-untranslated strings. fs wrapper over the pure
 * `detectUntranslated`. Each finding gains an `i18nPath` (a representative locale's file) for
 * annotation.
 * @param {string} repoRoot
 * @param {Partial<typeof UNTRANSLATED_DEFAULTS>} [options]
 */
function reportUntranslated(repoRoot, options) {
    const findings = detectUntranslated(collectLocaleEntries(repoRoot), options);
    return findings.map((f) => ({ ...f, i18nPath: path.posix.join('i18n', f.locales[0], f.file) }));
}

function main(argv) {
    const repoRoot = path.resolve(__dirname, '..');
    const doRestore = argv.includes('--restore') || argv.includes('--restore-verified');
    // The ledger checks (reversion + structural) are safe on every PR: they compare against values
    // recorded in the ledger, not against the current English, so they cannot be tripped by a PR
    // that legitimately changes an English string. The corpus placeholder/variable lint compares
    // translations against the current package.nls.json, so it must only run where translations are
    // the thing being changed (the automatic-localization PR). Otherwise a normal PR that edits an
    // English string's placeholders would fail before the translations can be regenerated.
    const corpusOnly = argv.includes('--corpus-only');
    const ledgerOnly = argv.includes('--ledger-only');
    const reportUnt = argv.includes('--report-untranslated');
    const runLedger = !corpusOnly;
    const runCorpus = !ledgerOnly;

    if (doRestore) {
        const { restored } = restore(repoRoot);
        if (restored.length === 0) {
            console.log('translation-verifier: nothing to restore; all verified translations already match the ledger.');
        } else {
            for (const r of restored) {
                console.log(`translation-verifier: restored ${r.locale}/${r.file} -> ${r.key}`);
            }
            console.log(`translation-verifier: restored ${restored.length} verified translation(s).`);
        }
    }

    const { reversions, structural, checked } = runLedger ? verify(repoRoot) : { reversions: [], structural: [], checked: 0 };
    const corpus = runCorpus ? verifyPackageCorpus(repoRoot) : [];
    let failed = false;

    for (const r of reversions) {
        failed = true;
        annotate(r.i18nPath, 'Verified translation reverted',
            `${r.locale} / ${r.file} / ${r.key}: expected the verified translation but found a different value. ` +
            `Run "node tools/translation-verifier.js --restore" to restore it, or update jobs/loc/translation-fixes.json if the change is intentional.`);
    }
    for (const s of structural) {
        failed = true;
        const cats = s.problems.map(p => `${p.category} (source: ${JSON.stringify(p.source)}, translation: ${JSON.stringify(p.translation)})`).join('; ');
        annotate(s.i18nPath, 'Verified translation lost structural tokens',
            `${s.locale} / ${s.file} / ${s.key}: the translation no longer matches its English source tokens: ${cats}.`);
    }
    for (const c of corpus) {
        failed = true;
        const cats = c.problems.map(p => `${p.category} (source: ${JSON.stringify(p.source)}, translation: ${JSON.stringify(p.translation)})`).join('; ');
        annotate(c.i18nPath, 'Translation placeholder/variable mismatch',
            `${c.locale} / package.i18n.json / ${c.key}: the translation must keep the same placeholders and variables as its English source: ${cats}.`);
    }

    // Informational tier: strings that look like untranslated English (identical across many
    // locales, with real translatable content). This never fails the run — a newly added source
    // string is always English until the next localization cycle — it only surfaces a warning so the
    // readiness comment can list what is still awaiting translation.
    if (reportUnt) {
        const untranslated = reportUntranslated(repoRoot);
        for (const u of untranslated) {
            annotateWarning(u.i18nPath, 'Imported string still in English',
                `${u.file} / ${u.key}: identical text in ${u.agree}/${u.total} locales (${u.locales.join(', ')}). ` +
                `This looks like an untranslated English source string awaiting translation.`);
        }
        if (untranslated.length > 0) {
            console.log(`translation-verifier: ${untranslated.length} string(s) still appear to be untranslated English (informational).`);
        }
    }

    if (failed) {
        console.error(`\ntranslation-verifier: FAILED. ${reversions.length} reverted, ${structural.length} structurally broken, ${corpus.length} with placeholder/variable mismatches.`);
        console.error('These translations were deliberately fixed and/or must preserve their placeholders; they must not be reverted or broken by an automatic localization import.');
        return 1;
    }

    const scope = runLedger && runCorpus ? `all ${checked} verified translation(s) and every package.i18n.json string`
        : runLedger ? `all ${checked} verified translation(s)`
            : 'all package.i18n.json placeholders/variables';
    console.log(`translation-verifier: OK. ${scope} intact.`);
    return 0;
}

module.exports = {
    extractTokens,
    compareStructure,
    multisetEqual,
    readI18nFile,
    loadLedger,
    loadPackageEnglish,
    verify,
    verifyPackageCorpus,
    restore,
    CORPUS_TOKEN_CATEGORIES,
    LEDGER_RELPATH,
    UNTRANSLATED_DEFAULTS,
    normalizeForAgreement,
    stripStructuralTokens,
    translatableUnits,
    detectUntranslated,
    assessImportProgress,
    collectLocaleEntries,
    reportUntranslated
};

if (require.main === module) {
    process.exit(main(process.argv.slice(2)));
}

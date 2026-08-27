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
    LEDGER_RELPATH
};

if (require.main === module) {
    process.exit(main(process.argv.slice(2)));
}

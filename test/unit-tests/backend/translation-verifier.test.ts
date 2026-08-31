/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import * as path from 'path';

// The verifier is a plain CommonJS module (no vscode dependency), required directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verifier = require(path.resolve(__dirname, '../../../tools/translation-verifier.js'));

suite('Translation verifier', () => {
    suite('extractTokens', () => {
        test('extracts numeric placeholders as a sorted multiset', () => {
            expect(verifier.extractTokens('Test {1} failed with {0} and {1}').placeholders).to.deep.equal(['{0}', '{1}', '{1}']);
        });

        test('extracts ${variables}', () => {
            expect(verifier.extractTokens('use ${testName} and ${sourceDir}').variables).to.deep.equal(['${sourceDir}', '${testName}']);
        });

        test('extracts #setting# references', () => {
            expect(verifier.extractTokens('see `#cmake.revealLog#` and #cmake.other#').settings).to.deep.equal(['#cmake.other#', '#cmake.revealLog#']);
        });

        test('extracts backtick code spans and URLs', () => {
            const t = verifier.extractTokens('run `cmake` at https://example.com/x');
            expect(t.codeSpans).to.deep.equal(['`cmake`']);
            expect(t.urls).to.deep.equal(['https://example.com/x']);
        });

        test('returns empty arrays when no tokens are present', () => {
            const t = verifier.extractTokens('plain text');
            expect(t.placeholders).to.deep.equal([]);
            expect(t.variables).to.deep.equal([]);
            expect(t.settings).to.deep.equal([]);
        });
    });

    suite('multisetEqual', () => {
        test('true for identical sorted arrays', () => {
            expect(verifier.multisetEqual(['{0}', '{1}'], ['{0}', '{1}'])).to.equal(true);
        });
        test('false when counts differ (dropped duplicate)', () => {
            expect(verifier.multisetEqual(['{0}', '{0}'], ['{0}'])).to.equal(false);
        });
        test('false when a token differs', () => {
            expect(verifier.multisetEqual(['{0}'], ['{1}'])).to.equal(false);
        });
    });

    suite('compareStructure', () => {
        test('no problems when placeholders/variables are preserved (reordering allowed)', () => {
            const problems = verifier.compareStructure('Test {0} in {1}', 'In {1}: {0}');
            expect(problems).to.deep.equal([]);
        });

        test('flags a dropped placeholder', () => {
            const problems = verifier.compareStructure('Test {0} failed with code {1}.', 'Test fehlgeschlagen mit Code {1}.');
            expect(problems.map((p: any) => p.category)).to.include('placeholders');
        });

        test('flags a mangled ${variable}', () => {
            const problems = verifier.compareStructure('The ${testName} variable is unsupported.', 'La variabile ${nomeTest} non è supportata.');
            expect(problems.map((p: any) => p.category)).to.include('variables');
        });

        test('flags a changed #setting# reference (the inheritDefault-style bug)', () => {
            const problems = verifier.compareStructure(
                'Inherits `#cmake.options.advanced.statusBarVisibility#`.',
                'Erbt `#cmake.options.statusBarVisibility#`.');
            expect(problems.map((p: any) => p.category)).to.include('settings');
        });

        test('flags a translated code span', () => {
            const problems = verifier.compareStructure('the `file` field', 'das Feld `Datei`');
            expect(problems.map((p: any) => p.category)).to.include('codeSpans');
        });
    });

    suite('CORPUS_TOKEN_CATEGORIES', () => {
        test('corpus lint is limited to the unambiguous high-severity categories', () => {
            expect(verifier.CORPUS_TOKEN_CATEGORIES).to.deep.equal(['placeholders', 'variables']);
        });
    });

    suite('ledger + corpus verification against the real repository', () => {
        const repoRoot = path.resolve(__dirname, '../../..');

        test('the shipped ledger and package translations verify clean', () => {
            const result = verifier.verify(repoRoot);
            expect(result.reversions, 'no reverted verified translations').to.deep.equal([]);
            expect(result.structural, 'no structurally broken verified translations').to.deep.equal([]);
            expect(result.checked, 'ledger has entries').to.be.greaterThan(0);
            const corpus = verifier.verifyPackageCorpus(repoRoot);
            expect(corpus, 'no package placeholder/variable mismatches').to.deep.equal([]);
        });

        test('every ledger entry stores both a value and an English source', () => {
            const ledger = verifier.loadLedger(repoRoot);
            for (const locale of Object.keys(ledger.locales)) {
                for (const file of Object.keys(ledger.locales[locale])) {
                    for (const key of Object.keys(ledger.locales[locale][file])) {
                        const entry = ledger.locales[locale][file][key];
                        expect(entry.value, `${locale}/${file}/${key} value`).to.be.a('string').and.not.empty;
                        expect(entry.source, `${locale}/${file}/${key} source`).to.be.a('string').and.not.empty;
                    }
                }
            }
        });
    });

    suite('untranslated-import detection', () => {
        const LOCALES = ['chs', 'cht', 'csy', 'deu', 'esn', 'fra', 'ita', 'jpn', 'kor', 'plk', 'ptb', 'rus', 'trk'];
        const across = (value: string, locales: string[] = LOCALES): Record<string, string> => {
            const out: Record<string, string> = {};
            for (const l of locales) {
                out[l] = value;
            }
            return out;
        };
        // A newly added English source string (added in #5055, imported untranslated by #5061).
        const ENGLISH = 'Using the CMake bundled with the Visual Studio instance selected by vsInstanceVersion: {0}';
        // Real, divergent translations of test.failed.with.exit.code (from i18n/<locale>/src/ctest.i18n.json).
        const EXIT_CODE: Record<string, string> = {
            chs: '{0}\n测试 {1} 失败，退出代码: {2}。',
            cht: '{0}\n測試 {1} 失敗，結束代碼為 {2}。',
            csy: '{0}\nTest {1} byl neúspěšný s ukončovacím kódem {2}.',
            deu: '{0}\nFehler beim Test „{1}“ mit Exitcode „{2}“.',
            esn: '{0}\nError de prueba {1} con código de salida{2}.',
            fra: '{0}\nÉchec du test {1} avec le code de sortie {2}.',
            ita: '{0}\nTest {1} non riuscito con codice di uscita {2}.',
            jpn: '{0}\nテスト {1} が終了コード {2} で失敗しました。',
            kor: '{0}\n종료 코드 {2}을(를) 반환하며 테스트 {1}에 실패했습니다.',
            plk: '{0}\nTest {1} zakończył się niepowodzeniem z kodem zakończenia {2}.',
            ptb: '{0}\nO teste {1} falhou com código de saída {2}.',
            rus: '{0}\nСбой теста {1}. Код выхода: {2}.',
            trk: '{0}\n{1} testi {2} çıkış kodu ile başarısız oldu.'
        };

        suite('translatableUnits', () => {
            test('brands, symbols, placeholders and code spans score below the threshold', () => {
                expect(verifier.translatableUnits('Ninja')).to.equal(0);
                expect(verifier.translatableUnits('{0}')).to.equal(0);
                expect(verifier.translatableUnits('`CMakePresets.json`')).to.equal(0);
                expect(verifier.translatableUnits('https://example.com/{0}')).to.equal(0);
                expect(verifier.translatableUnits('Visual Studio Code')).to.be.lessThan(4);
                expect(verifier.translatableUnits('OK')).to.be.lessThan(4);
            });
            test('a real English sentence scores at or above the threshold', () => {
                expect(verifier.translatableUnits(ENGLISH)).to.be.greaterThan(4);
            });
            test('counts CJK codepoints even without spaces', () => {
                expect(verifier.translatableUnits('失败')).to.equal(2);
                expect(verifier.translatableUnits('종료 코드를 반환하며 테스트에 실패했습니다')).to.be.greaterThan(4);
            });
        });

        suite('detectUntranslated', () => {
            test('flags a new English string identical across all locales (the #5055/#5061 case)', () => {
                const findings = verifier.detectUntranslated([
                    { file: 'src/cmakeProject.i18n.json', key: 'using.vs.instance.cmake', values: across(ENGLISH) }
                ]);
                expect(findings).to.have.length(1);
                expect(findings[0].agree).to.equal(13);
                expect(findings[0].total).to.equal(13);
                expect(findings[0].confidence).to.equal('high');
            });
            test('does NOT flag a genuinely translated string (values diverge per language)', () => {
                const findings = verifier.detectUntranslated([
                    { file: 'src/ctest.i18n.json', key: 'test.failed.with.exit.code', values: EXIT_CODE }
                ]);
                expect(findings).to.deep.equal([]);
            });
            test('does NOT flag brand/short/placeholder-only strings even at full agreement', () => {
                const findings = verifier.detectUntranslated([
                    { file: 'x', key: 'ninja', values: across('Ninja') },
                    { file: 'x', key: 'ok', values: across('OK') },
                    { file: 'x', key: 'ph', values: across('{0}') },
                    { file: 'x', key: 'code', values: across('`CMakePresets.json`') },
                    { file: 'x', key: 'url', values: across('https://example.com/{0}') },
                    { file: 'x', key: 'vs', values: across('Visual Studio Code') }
                ]);
                expect(findings).to.deep.equal([]);
            });
            test('requires a minimum number of locales before judging agreement', () => {
                const findings = verifier.detectUntranslated([
                    { file: 'x', key: 'k', values: across(ENGLISH, ['deu', 'fra', 'ita']) }
                ]);
                expect(findings).to.deep.equal([]);
            });
            test('agreement below the threshold is not flagged; at the threshold it is', () => {
                // 7 identical English + 6 distinct real translations -> largest group 7 (< 8) -> not flagged.
                const mixed7: Record<string, string> = {};
                for (const l of LOCALES.slice(0, 7)) {
                    mixed7[l] = ENGLISH;
                }
                for (const l of LOCALES.slice(7)) {
                    mixed7[l] = EXIT_CODE[l];
                }
                expect(verifier.detectUntranslated([{ file: 'x', key: 'k', values: mixed7 }])).to.deep.equal([]);
                // 8 identical English + 5 distinct -> largest group 8 (>= 8) -> flagged, medium confidence.
                const mixed8: Record<string, string> = {};
                for (const l of LOCALES.slice(0, 8)) {
                    mixed8[l] = ENGLISH;
                }
                for (const l of LOCALES.slice(8)) {
                    mixed8[l] = EXIT_CODE[l];
                }
                const findings = verifier.detectUntranslated([{ file: 'x', key: 'k', values: mixed8 }]);
                expect(findings).to.have.length(1);
                expect(findings[0].agree).to.equal(8);
                expect(findings[0].confidence).to.equal('medium');
            });
            test('flags long CJK text identical across many locales', () => {
                const findings = verifier.detectUntranslated([
                    { file: 'x', key: 'k', values: across('종료 코드를 반환하며 테스트에 실패했습니다') }
                ]);
                expect(findings).to.have.length(1);
            });
        });

        suite('assessImportProgress', () => {
            const KEY = 'src/cmakeProject.i18n.json\u0000using.vs.instance.cmake';
            const flagged = new Map([[KEY, verifier.normalizeForAgreement(ENGLISH)]]);
            test('a partial import that carries real translations is not blocked (#5061)', () => {
                const changed: any[] = [];
                for (const l of LOCALES) {
                    // The new source string came back English in every locale (flagged) ...
                    changed.push({ file: 'src/cmakeProject.i18n.json', key: 'using.vs.instance.cmake', locale: l, head: ENGLISH, changeType: 'add' });
                    // ... but test.failed.with.signal is genuinely translated (diverges, not flagged).
                    changed.push({ file: 'src/ctest.i18n.json', key: 'test.failed.with.signal', locale: l, head: `signal-${l}`, changeType: 'add' });
                }
                const r = verifier.assessImportProgress(changed, flagged);
                expect(r.block).to.equal(false);
                expect(r.progress).to.equal(LOCALES.length);
            });
            test('a real translation in a minority locale is progress even when the key is still English elsewhere', () => {
                // One new key: English in 12 locales (flagged), a real German translation in the 13th.
                const changed = LOCALES.map((l) => ({
                    file: 'src/cmakeProject.i18n.json', key: 'using.vs.instance.cmake', locale: l,
                    head: l === 'deu' ? 'Verwenden der mit der Visual Studio-Instanz gebündelten CMake: {0}' : ENGLISH,
                    changeType: 'add'
                }));
                const r = verifier.assessImportProgress(changed, flagged);
                expect(r.block).to.equal(false);
                expect(r.progress).to.equal(1);
                expect(r.untranslated).to.equal(LOCALES.length - 1);
            });
            test('an import whose only additions are untranslated English is blocked', () => {
                const changed = LOCALES.map((l) => ({ file: 'src/cmakeProject.i18n.json', key: 'using.vs.instance.cmake', locale: l, head: ENGLISH, changeType: 'add' }));
                const r = verifier.assessImportProgress(changed, flagged);
                expect(r.block).to.equal(true);
                expect(r.reason).to.equal('no-localization-progress');
            });
            test('a reorder/format-only import (no semantic change) is blocked', () => {
                const changed = [{ file: 'f', key: 'k', locale: 'deu', base: 'Same value', head: 'Same value', changeType: 'update' }];
                const r = verifier.assessImportProgress(changed, new Map());
                expect(r.block).to.equal(true);
                expect(r.reason).to.equal('no-semantic-change');
            });
            test('a deletion counts as progress (pruning an obsolete key is allowed)', () => {
                const changed = [{ file: 'f', key: 'k', locale: 'deu', changeType: 'delete' }];
                expect(verifier.assessImportProgress(changed, new Map()).block).to.equal(false);
            });
            test('no changes at all is not blocked', () => {
                expect(verifier.assessImportProgress([], new Map()).block).to.equal(false);
            });
        });

        test('the current checked-in corpus reports no untranslated strings', () => {
            const repoRoot = path.resolve(__dirname, '../../..');
            const findings = verifier.reportUntranslated(repoRoot);
            expect(findings, `unexpected untranslated findings: ${JSON.stringify(findings.map((f: any) => `${f.file}/${f.key}`))}`).to.deep.equal([]);
        });
    });
});

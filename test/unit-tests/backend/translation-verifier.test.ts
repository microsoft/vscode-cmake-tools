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
});

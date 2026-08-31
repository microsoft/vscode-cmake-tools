/* eslint-disable @typescript-eslint/no-require-imports */
import { expect } from 'chai';
import * as path from 'path';

const readiness = require(path.resolve(__dirname, '../../../tools/localization-readiness.js'));

// A minimal in-memory mock of the pieces of the Octokit client the readiness logic uses. It records
// label state and comments so a test can assert what the workflow would do to a real PR.
function makeMockGitHub(options: { headSha: string; existingComments?: any[]; writeErrorStatus?: number }) {
    const labels = new Set<string>();
    const comments: any[] = (options.existingComments || []).slice();
    const calls: { method: string; args: any }[] = [];
    let commentIdSeq = 1000;

    // When writeErrorStatus is set, all label/comment mutations reject with that HTTP status — used
    // to simulate a read-only GITHUB_TOKEN (403 "Resource not accessible by integration").
    const maybeFail = () => {
        if (options.writeErrorStatus) {
            const err: any = new Error('Resource not accessible by integration');
            err.status = options.writeErrorStatus;
            throw err;
        }
    };

    const github: any = {
        rest: {
            pulls: {
                get: async (args: any) => {
                    calls.push({ method: 'pulls.get', args });
                    return { data: { head: { sha: options.headSha } } };
                }
            },
            issues: {
                addLabels: async (args: any) => {
                    calls.push({ method: 'addLabels', args });
                    maybeFail();
                    for (const l of args.labels) {
                        labels.add(l);
                    }
                },
                removeLabel: async (args: any) => {
                    calls.push({ method: 'removeLabel', args });
                    maybeFail();
                    if (!labels.has(args.name)) {
                        const err: any = new Error('Label does not exist');
                        err.status = 404;
                        throw err;
                    }
                    labels.delete(args.name);
                },
                listComments: async () => comments,
                createComment: async (args: any) => {
                    calls.push({ method: 'createComment', args });
                    maybeFail();
                    comments.push({ id: ++commentIdSeq, user: { login: 'github-actions[bot]' }, body: args.body });
                },
                updateComment: async (args: any) => {
                    calls.push({ method: 'updateComment', args });
                    maybeFail();
                    const c = comments.find((x) => x.id === args.comment_id);
                    if (c) {
                        c.body = args.body;
                    }
                }
            }
        },
        // github.paginate(fn, args) — the mock's listComments ignores paging and returns all.
        paginate: async (fn: any, args: any) => fn(args)
    };

    return { github, labels, comments, calls };
}

const context: any = {
    repo: { owner: 'microsoft', repo: 'vscode-cmake-tools' },
    issue: { number: 5058 },
    serverUrl: 'https://github.com',
    runId: 42
};
const core: any = { notice: () => { /* no-op */ }, warning: () => { /* no-op */ } };
function makeCore() {
    const warnings: string[] = [];
    return { core: { notice: () => { /* no-op */ }, warning: (m: string) => warnings.push(m) }, warnings };
}

const HEAD_SHA = 'abcdef1234567890abcdef1234567890abcdef12';

suite('Localization readiness signal', () => {
    suite('parseVerifierAnnotations', () => {
        test('parses the verifier ::error lines into issues (message may contain colons)', () => {
            const output = [
                'some preamble',
                '::error file=i18n/deu/src/presets/preset.i18n.json,title=Verified translation reverted::deu / src/presets/preset.i18n.json / using.vendor.vs.version: expected the verified translation but found a different value.',
                '::error file=i18n/deu/package.i18n.json,title=Translation placeholder/variable mismatch::deu / package.i18n.json / test.run.error: must keep the same placeholders.',
                'translation-verifier: FAILED.'
            ].join('\n');
            const issues = readiness.parseVerifierAnnotations(output);
            expect(issues).to.have.length(2);
            expect(issues[0].file).to.equal('i18n/deu/src/presets/preset.i18n.json');
            expect(issues[0].title).to.equal('Verified translation reverted');
            expect(issues[0].message).to.contain('using.vendor.vs.version');
        });

        test('returns an empty array when there are no annotations', () => {
            expect(readiness.parseVerifierAnnotations('all good\n')).to.deep.equal([]);
            expect(readiness.parseVerifierAnnotations('')).to.deep.equal([]);
        });
    });

    suite('parseVerifierWarnings', () => {
        test('parses the verifier ::warning lines (untranslated tier) into issues', () => {
            const output = [
                'translation-verifier: OK. all verified translations intact.',
                '::warning file=i18n/chs/src/cmakeProject.i18n.json,title=Imported string still in English::src/cmakeProject.i18n.json / using.vs.instance.cmake: identical text in 13/13 locales (chs, cht, csy). This looks like an untranslated English source string awaiting translation.',
                'translation-verifier: 1 string(s) still appear to be untranslated English (informational).'
            ].join('\n');
            const warnings = readiness.parseVerifierWarnings(output);
            expect(warnings).to.have.length(1);
            expect(warnings[0].title).to.equal('Imported string still in English');
            expect(warnings[0].message).to.contain('using.vs.instance.cmake');
        });

        test('does not confuse ::warning with ::error lines', () => {
            expect(readiness.parseVerifierWarnings('::error file=a,title=t::boom')).to.deep.equal([]);
        });
    });

    suite('buildReadinessComment', () => {
        test('ready body announces READY and carries the marker', () => {
            const body = readiness.buildReadinessComment({ ready: true, issues: [], shaShort: 'abcdef1', runLink: 'x' });
            expect(body).to.contain(readiness.MARKER);
            expect(body).to.contain('READY');
            expect(body).to.not.contain('NOT READY');
        });

        test('not-ready body announces NOT READY and lists the offending keys', () => {
            const issues = [{ file: 'i18n/deu/package.i18n.json', title: 'Translation placeholder/variable mismatch', message: 'test.run.error: must keep placeholders' }];
            const body = readiness.buildReadinessComment({ ready: false, issues, shaShort: 'abcdef1', runLink: 'x' });
            expect(body).to.contain('NOT READY');
            expect(body).to.contain('test.run.error');
        });

        test('ready body appends the Awaiting translation section when strings are still untranslated', () => {
            const untranslated = [{ file: 'i18n/chs/src/cmakeProject.i18n.json', title: 'Imported string still in English', message: 'src/cmakeProject.i18n.json / using.vs.instance.cmake: identical text in 13/13 locales.' }];
            const body = readiness.buildReadinessComment({ ready: true, issues: [], untranslated, shaShort: 'abcdef1', runLink: 'x' });
            expect(body).to.contain('READY');
            expect(body).to.not.contain('NOT READY');
            expect(body).to.contain('Awaiting translation');
            expect(body).to.contain('using.vs.instance.cmake');
        });

        test('ready body omits the Awaiting translation section when nothing is untranslated', () => {
            const body = readiness.buildReadinessComment({ ready: true, issues: [], untranslated: [], shaShort: 'abcdef1', runLink: 'x' });
            expect(body).to.not.contain('Awaiting translation');
        });

        test('not-ready body shows both the blocking issues and the Awaiting translation section', () => {
            const issues = [{ file: 'i18n/deu/package.i18n.json', title: 'Translation placeholder/variable mismatch', message: 'k: broke {0}' }];
            const untranslated = [{ file: 'i18n/chs/src/cmakeProject.i18n.json', title: 'Imported string still in English', message: 'using.vs.instance.cmake: identical text in 13/13 locales.' }];
            const body = readiness.buildReadinessComment({ ready: false, issues, untranslated, shaShort: 'abcdef1', runLink: 'x' });
            expect(body).to.contain('NOT READY');
            expect(body).to.contain('Issues');
            expect(body).to.contain('Awaiting translation');
        });
    });

    suite('updateLocalizationReadiness — recovery lifecycle', () => {
        test('a not-ready run adds the blocking label and posts a NOT READY comment', async () => {
            const mock = makeMockGitHub({ headSha: HEAD_SHA });
            await readiness.updateLocalizationReadiness({
                github: mock.github, context, core,
                verifyOutcome: 'failure',
                expectedHeadSha: HEAD_SHA,
                verifierOutput: '::error file=i18n/deu/package.i18n.json,title=Translation placeholder/variable mismatch::deu / package.i18n.json / test.run.error: broke {0}.'
            });
            expect([...mock.labels]).to.include(readiness.BLOCKING_LABEL);
            expect(mock.comments).to.have.length(1);
            expect(mock.comments[0].body).to.contain('NOT READY');
        });

        test('once ready, a later run REMOVES the blocking label and flips the comment to READY', async () => {
            // Start from the not-ready state: label present + a NOT READY sticky comment.
            const mock = makeMockGitHub({
                headSha: HEAD_SHA,
                existingComments: [{ id: 500, user: { login: 'github-actions[bot]' }, body: `${readiness.MARKER}\n## ⛔ Localization readiness: NOT READY — do not merge` }]
            });
            mock.labels.add(readiness.BLOCKING_LABEL);

            await readiness.updateLocalizationReadiness({
                github: mock.github, context, core,
                verifyOutcome: 'success',
                expectedHeadSha: HEAD_SHA,
                verifierOutput: ''
            });

            // The label is gone and the single sticky comment now says READY.
            expect([...mock.labels]).to.not.include(readiness.BLOCKING_LABEL);
            expect(mock.calls.some((c) => c.method === 'removeLabel' && c.args.name === readiness.BLOCKING_LABEL)).to.equal(true);
            expect(mock.comments).to.have.length(1); // updated in place, not a new comment
            expect(mock.comments[0].body).to.contain('READY');
            expect(mock.comments[0].body).to.not.contain('NOT READY');
        });

        test('removing the label when it is already absent is tolerated (404 swallowed)', async () => {
            const mock = makeMockGitHub({ headSha: HEAD_SHA }); // no label present
            let threw = false;
            try {
                await readiness.updateLocalizationReadiness({
                    github: mock.github, context, core,
                    verifyOutcome: 'success',
                    expectedHeadSha: HEAD_SHA,
                    verifierOutput: ''
                });
            } catch {
                threw = true;
            }
            expect(threw, 'a 404 from removeLabel must not fail the run').to.equal(false);
            expect(mock.comments[0].body).to.contain('READY');
        });

        test('a stale run (PR moved to a newer commit) makes no label/comment changes', async () => {
            const mock = makeMockGitHub({ headSha: 'newer000000000000000000000000000000000000' });
            mock.labels.add(readiness.BLOCKING_LABEL);
            const result = await readiness.updateLocalizationReadiness({
                github: mock.github, context, core,
                verifyOutcome: 'success',
                expectedHeadSha: HEAD_SHA, // this run is for an older SHA
                verifierOutput: ''
            });
            expect(result.skipped).to.equal(true);
            expect([...mock.labels]).to.include(readiness.BLOCKING_LABEL); // untouched
            expect(mock.calls.some((c) => c.method === 'removeLabel' || c.method === 'addLabels')).to.equal(false);
            expect(mock.calls.some((c) => c.method === 'createComment' || c.method === 'updateComment')).to.equal(false);
        });

        test('ready run with the label present but no prior comment removes the label and creates a READY comment', async () => {
            const mock = makeMockGitHub({ headSha: HEAD_SHA }); // no existing comment
            mock.labels.add(readiness.BLOCKING_LABEL);
            await readiness.updateLocalizationReadiness({
                github: mock.github, context, core,
                verifyOutcome: 'success', expectedHeadSha: HEAD_SHA, verifierOutput: ''
            });
            expect([...mock.labels]).to.not.include(readiness.BLOCKING_LABEL);
            expect(mock.calls.some((c) => c.method === 'createComment')).to.equal(true);
            expect(mock.comments).to.have.length(1);
            expect(mock.comments[0].body).to.contain('READY');
            expect(mock.comments[0].body).to.not.contain('NOT READY');
        });

        test('oscillation not-ready -> ready -> not-ready toggles the label and the single sticky comment', async () => {
            const mock = makeMockGitHub({ headSha: HEAD_SHA });
            const run = (outcome: string) => readiness.updateLocalizationReadiness({
                github: mock.github, context, core,
                verifyOutcome: outcome, expectedHeadSha: HEAD_SHA,
                verifierOutput: outcome === 'success' ? '' : '::error file=i18n/deu/package.i18n.json,title=Translation placeholder/variable mismatch::deu / package.i18n.json / k: broke {0}.'
            });

            await run('failure');
            expect([...mock.labels]).to.include(readiness.BLOCKING_LABEL);
            expect(mock.comments).to.have.length(1);
            expect(mock.comments[0].body).to.contain('NOT READY');

            await run('success');
            expect([...mock.labels]).to.not.include(readiness.BLOCKING_LABEL);
            expect(mock.comments).to.have.length(1); // still one comment, flipped in place
            expect(mock.comments[0].body).to.contain('READY');
            expect(mock.comments[0].body).to.not.contain('NOT READY');

            await run('failure');
            expect([...mock.labels]).to.include(readiness.BLOCKING_LABEL); // re-added
            expect(mock.comments).to.have.length(1);
            expect(mock.comments[0].body).to.contain('NOT READY');
        });
    });

    suite('read-only token resilience', () => {
        test('isPermissionError is true only for a 403', () => {
            expect(readiness.isPermissionError({ status: 403 })).to.equal(true);
            expect(readiness.isPermissionError({ status: 404 })).to.equal(false);
            expect(readiness.isPermissionError({ status: 500 })).to.equal(false);
            expect(readiness.isPermissionError(undefined)).to.equal(false);
        });

        test('a 403 on label/comment writes is degraded, not thrown (the #5061 failure mode)', async () => {
            const mock = makeMockGitHub({ headSha: HEAD_SHA, writeErrorStatus: 403 });
            const { core: recCore, warnings } = makeCore();
            let threw = false;
            let result: any;
            try {
                result = await readiness.updateLocalizationReadiness({
                    github: mock.github, context, core: recCore,
                    verifyOutcome: 'failure', expectedHeadSha: HEAD_SHA,
                    verifierOutput: '::error file=i18n/deu/src/presets/preset.i18n.json,title=Verified translation reverted::deu / using.vendor.vs.version: reverted.'
                });
            } catch {
                threw = true;
            }
            expect(threw, 'a read-only token must not fail the readiness step').to.equal(false);
            expect(result.degraded).to.equal(true);
            expect(warnings.length, 'a warning is logged for each blocked write').to.be.greaterThan(0);
            // It still attempted both writes (so it works the moment the token gains write access).
            expect(mock.calls.some((c) => c.method === 'addLabels')).to.equal(true);
            expect(mock.calls.some((c) => c.method === 'createComment' || c.method === 'updateComment')).to.equal(true);
        });

        test('a non-permission error (500) still throws', async () => {
            const mock = makeMockGitHub({ headSha: HEAD_SHA, writeErrorStatus: 500 });
            const { core: recCore } = makeCore();
            let threw = false;
            try {
                await readiness.updateLocalizationReadiness({
                    github: mock.github, context, core: recCore,
                    verifyOutcome: 'failure', expectedHeadSha: HEAD_SHA, verifierOutput: ''
                });
            } catch {
                threw = true;
            }
            expect(threw, 'an unexpected server error should not be silently swallowed').to.equal(true);
        });
    });

    suite('untranslated warnings surface without blocking', () => {
        test('a READY run with ::warning untranslated lines shows the section and does NOT add the blocking label', async () => {
            const mock = makeMockGitHub({ headSha: HEAD_SHA });
            await readiness.updateLocalizationReadiness({
                github: mock.github, context, core,
                verifyOutcome: 'success',
                expectedHeadSha: HEAD_SHA,
                verifierOutput: '::warning file=i18n/chs/src/cmakeProject.i18n.json,title=Imported string still in English::src/cmakeProject.i18n.json / using.vs.instance.cmake: identical text in 13/13 locales (chs, cht, csy).'
            });
            expect([...mock.labels], 'an informational warning must not add the blocking label').to.not.include(readiness.BLOCKING_LABEL);
            expect(mock.comments).to.have.length(1);
            expect(mock.comments[0].body).to.contain('READY');
            expect(mock.comments[0].body).to.not.contain('NOT READY');
            expect(mock.comments[0].body).to.contain('Awaiting translation');
            expect(mock.comments[0].body).to.contain('using.vs.instance.cmake');
        });
    });
});

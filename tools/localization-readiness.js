/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
'use strict';

/**
 * Logic for the Localization Readiness workflow (.github/workflows/localization-readiness.yml).
 *
 * It is factored out of the workflow's inline `actions/github-script` step so the behavior — in
 * particular that the `localization: not ready` label and the "not ready" comment are CLEARED once a
 * later run of the verifier passes — can be unit-tested with a mocked GitHub client
 * (see test/unit-tests/backend/localization-readiness.test.ts). No `vscode` or `@actions`
 * dependency: the workflow passes in the `github`/`context`/`core` objects.
 */

const fs = require('fs');

const BLOCKING_LABEL = 'localization: not ready';
const MARKER = '<!-- localization-readiness -->';
const OUTPUT_FILE = 'translation-verifier-output.txt';

/**
 * Parse the verifier's GitHub `::error file=...,title=...::message` annotation lines into structured
 * issues. Undecodes the annotation escaping the verifier applies (see `annotate()` in
 * tools/translation-verifier.js) and collapses whitespace so each issue renders on one line.
 * @param {string} output
 * @returns {{ file: string, title: string, message: string }[]}
 */
function parseVerifierAnnotations(output) {
    const decode = (v) => v.replace(/%0A/gi, '\n').replace(/%0D/gi, '\r').replace(/%25/gi, '%');
    return (output || '').split(/\r?\n/)
        .map((line) => /^::error file=([^,]+),title=([^:]+)::(.*)$/.exec(line))
        .filter(Boolean)
        .map((m) => ({ file: decode(m[1]), title: decode(m[2]), message: decode(m[3]).replace(/\s+/g, ' ').trim() }));
}

/**
 * Parse the verifier's `::warning file=...,title=...::message` lines (the informational tier used
 * for likely-untranslated strings) into structured issues, mirroring `parseVerifierAnnotations`.
 * @param {string} output
 * @returns {{ file: string, title: string, message: string }[]}
 */
function parseVerifierWarnings(output) {
    const decode = (v) => v.replace(/%0A/gi, '\n').replace(/%0D/gi, '\r').replace(/%25/gi, '%');
    return (output || '').split(/\r?\n/)
        .map((line) => /^::warning file=([^,]+),title=([^:]+)::(.*)$/.exec(line))
        .filter(Boolean)
        .map((m) => ({ file: decode(m[1]), title: decode(m[2]), message: decode(m[3]).replace(/\s+/g, ' ').trim() }));
}

/**
 * Build the "Awaiting translation" section listing strings that look like untranslated English. It
 * is purely informational and appended to both the READY and NOT READY bodies; it never changes the
 * verdict or the blocking label. Returns [] when there is nothing to report.
 * @param {{ file: string, title: string, message: string }[]} untranslated
 * @param {string} runLink
 * @returns {string[]}
 */
function buildAwaitingTranslationSection(untranslated, runLink) {
    if (!untranslated || untranslated.length === 0) {
        return [];
    }
    const shown = untranslated.slice(0, 20);
    const noun = untranslated.length === 1 ? 'string' : 'strings';
    const verb = untranslated.length === 1 ? 'appears' : 'appear';
    const lines = [
        '',
        '### ℹ️ Awaiting translation',
        `${untranslated.length} newly imported ${noun} ${verb} to still be in English across every locale — `
            + `a new source string the localization team hasn't translated yet. This does **not** block merge; `
            + `it will be translated in a later cycle.`,
        ...shown.map((w) => `- ${w.message}`)
    ];
    if (untranslated.length > shown.length) {
        lines.push(`- …and ${untranslated.length - shown.length} more; see the [workflow logs](${runLink}).`);
    }
    return lines;
}

/**
 * Build the sticky comment body for the current readiness state. Always starts with the hidden
 * marker so the workflow can find and update the single existing comment.
 * @param {{ ready: boolean, issues: { file: string, title: string, message: string }[], shaShort: string, runLink: string }} args
 * @returns {string}
 */
function buildReadinessComment({ ready, issues, untranslated = [], shaShort, runLink }) {
    const awaiting = buildAwaitingTranslationSection(untranslated, runLink);
    if (ready) {
        return [
            MARKER,
            '## ✅ Localization readiness: READY',
            '',
            'Reviewed translation fixes are intact and every checked placeholder and `${variable}` is preserved.',
            ...awaiting,
            '',
            `Checked commit \`${shaShort}\`. This check covers localization integrity only; normal review and other checks still apply.`
        ].join('\n');
    }
    const shown = issues.slice(0, 50);
    const detail = shown.length > 0
        ? shown.map((i) => `- **${i.title}** — \`${i.file}\`: ${i.message}`)
        : [`- The verifier did not complete. See the [workflow logs](${runLink}).`];
    const more = issues.length > shown.length ? [`- …and ${issues.length - shown.length} more; see the [workflow logs](${runLink}).`] : [];
    return [
        MARKER,
        '## ⛔ Localization readiness: NOT READY — do not merge',
        '',
        'This import reverted a reviewed translation fix or broke a required placeholder / `${variable}`.',
        '',
        '### Issues',
        ...detail,
        ...more,
        ...awaiting,
        '',
        'To fix: run `node tools/translation-verifier.js --restore` for reverted fixes, correct any remaining placeholder/variable mismatches, and let the localization pipeline regenerate the branch.',
        '',
        `Checked commit \`${shaShort}\`. [Workflow logs](${runLink}).`
    ].join('\n');
}

/**
 * Ensure the blocking label reflects the current readiness: removed when ready (tolerating a 404
 * when it was not present), added when not ready.
 * @param {any} github
 * @param {{ owner: string, repo: string, issue_number: number, ready: boolean }} args
 */
async function setReadinessLabel(github, { owner, repo, issue_number, ready }) {
    if (ready) {
        try {
            await github.rest.issues.removeLabel({ owner, repo, issue_number, name: BLOCKING_LABEL });
        } catch (error) {
            if (error.status !== 404) {
                throw error;
            }
        }
    } else {
        await github.rest.issues.addLabels({ owner, repo, issue_number, labels: [BLOCKING_LABEL] });
    }
}

/**
 * Post or update the single sticky readiness comment, matched by the hidden marker on a comment
 * authored by github-actions[bot] so it stays one comment across the daily force-push.
 * @param {any} github
 * @param {{ owner: string, repo: string, issue_number: number, body: string }} args
 */
async function upsertStickyComment(github, { owner, repo, issue_number, body }) {
    const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
    const existing = comments.find((c) => c.user && c.user.login === 'github-actions[bot]' && c.body && c.body.includes(MARKER));
    if (existing) {
        await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    } else {
        await github.rest.issues.createComment({ owner, repo, issue_number, body });
    }
}

/**
 * Whether an Octokit error is a permission failure. In organizations that restrict the Actions
 * `GITHUB_TOKEN` to read-only, label/comment writes fail with 403 "Resource not accessible by
 * integration" even when the workflow requests `issues: write`. The readiness signal degrades to the
 * failing check plus the verifier's inline annotations in that case, rather than erroring the run.
 * @param {any} error
 */
function isPermissionError(error) {
    return !!error && error.status === 403;
}

/**
 * Reconcile the readiness signal (label + sticky comment) for the localization PR against the latest
 * verifier result. A stale run (whose head SHA no longer matches the PR) is skipped so it cannot
 * overwrite a newer run's result. Label/comment writes are best-effort: if the token cannot write
 * (read-only `GITHUB_TOKEN`), the failure is logged and the run continues so the check still enforces.
 * @param {{ github: any, context: any, core: any, verifyOutcome: string, expectedHeadSha: string, verifierOutput?: string }} args
 * @returns {Promise<{ skipped?: boolean, ready?: boolean, degraded?: boolean }>}
 */
async function updateLocalizationReadiness({ github, context, core, verifyOutcome, expectedHeadSha, verifierOutput }) {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const issue_number = context.issue.number;
    const ready = verifyOutcome === 'success';

    // The localization branch is force-pushed daily; if this run is already stale (the PR now points
    // at a newer commit) leave the signal to the newer run instead of overwriting it.
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: issue_number });
    if (pr.head.sha !== expectedHeadSha) {
        core.notice(`Skipping stale readiness update for ${expectedHeadSha}; PR now at ${pr.head.sha}.`);
        return { skipped: true };
    }

    let output = verifierOutput;
    if (output === undefined) {
        try {
            output = fs.readFileSync(OUTPUT_FILE, 'utf8');
        } catch {
            output = '';
        }
    }
    const issues = parseVerifierAnnotations(output);
    const untranslated = parseVerifierWarnings(output);

    let degraded = false;
    const permissionHint = "The workflow's GITHUB_TOKEN cannot write to this pull request "
        + "(read-only token). The failing check and the inline annotations still convey readiness; "
        + "grant Actions read-write permissions to also get the label and comment.";

    try {
        await setReadinessLabel(github, { owner, repo, issue_number, ready });
    } catch (error) {
        if (isPermissionError(error)) {
            degraded = true;
            core.warning(`Could not update the "${BLOCKING_LABEL}" label: ${error.message}. ${permissionHint}`);
        } else {
            throw error;
        }
    }

    const runLink = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
    const body = buildReadinessComment({ ready, issues, untranslated, shaShort: expectedHeadSha.slice(0, 7), runLink });
    try {
        await upsertStickyComment(github, { owner, repo, issue_number, body });
    } catch (error) {
        if (isPermissionError(error)) {
            degraded = true;
            core.warning(`Could not post the localization readiness comment: ${error.message}. ${permissionHint}`);
        } else {
            throw error;
        }
    }

    return { ready, degraded };
}

module.exports = {
    BLOCKING_LABEL,
    MARKER,
    OUTPUT_FILE,
    isPermissionError,
    parseVerifierAnnotations,
    parseVerifierWarnings,
    buildAwaitingTranslationSection,
    buildReadinessComment,
    setReadinessLabel,
    upsertStickyComment,
    updateLocalizationReadiness
};

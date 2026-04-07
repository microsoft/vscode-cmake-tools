#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawnSync } from 'child_process';
import { relative, resolve, join } from 'path';
import { tmpdir } from 'os';

const THRESHOLD = Number(process.env.THRESHOLD ?? 60);
const SUMMARY_PATH = 'coverage/coverage-summary.json';
const REPO = process.env.GITHUB_REPOSITORY;     // e.g. "microsoft/vscode-cmake-tools"

if (!REPO) {
    console.error('GITHUB_REPOSITORY is not set — are you running outside GitHub Actions?');
    process.exit(1);
}

const RUN_URL = `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`;

// ── 1. Read Istanbul JSON summary ────────────────────────────────────────────
let summary;
try {
    summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
} catch {
    console.log('No coverage summary found — skipping issue creation.');
    process.exit(0);
}

// ── 2. Find files below threshold ────────────────────────────────────────────
const belowThreshold = [];
const repoRoot = resolve('.');

for (const [file, metrics] of Object.entries(summary)) {
    if (file === 'total') continue;

    // Normalize: c8/Istanbul may emit absolute paths or repo-relative paths
    const relPath = file.startsWith('/') || /^[A-Za-z]:[/\\]/.test(file)
        ? relative(repoRoot, file).replace(/\\/g, '/')
        : file;

    if (!relPath.startsWith('src/')) continue;

    const linePct   = metrics.lines.pct    ?? 0;
    const branchPct = metrics.branches.pct ?? 0;
    const fnPct     = metrics.functions.pct ?? 0;

    if (linePct < THRESHOLD || fnPct < THRESHOLD) {
        belowThreshold.push({ file: relPath, linePct, branchPct, fnPct });
    }
}

const total      = summary.total ?? {};
const totalLines = total.lines?.pct ?? 0;

console.log(`\nTotal line coverage: ${totalLines}%  (threshold: ${THRESHOLD}%)`);
console.log(`Files below threshold: ${belowThreshold.length}`);

if (belowThreshold.length === 0 && totalLines >= THRESHOLD) {
    console.log('✅ Coverage is above threshold — no issue needed.');
    process.exit(0);
}

// ── 3. Check for existing open coverage issue (avoid duplicates) ─────────────
let existingIssueNumber = null;
try {
    const result = spawnSync('gh', [
        'issue', 'list',
        '--repo', REPO,
        '--label', 'test-coverage',
        '--state', 'open',
        '--json', 'number',
        '--jq', '.[0].number'
    ], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
        existingIssueNumber = result.stdout.trim();
    }
} catch {
    // gh CLI may fail if label doesn't exist yet — continue to create
}

// ── 4. Build the issue body (this is the Copilot agent's instruction set) ────
belowThreshold.sort((a, b) => a.linePct - b.linePct);  // worst files first

const tableRows = belowThreshold
    .slice(0, 20)  // cap at 20 files per issue to keep it focused
    .map(f => `| \`${f.file}\` | ${f.linePct}% | ${f.branchPct}% | ${f.fnPct}% |`)
    .join('\n');

const fileList = belowThreshold
    .slice(0, 20)
    .map(f => `- \`${f.file}\` — ${f.linePct}% line coverage`)
    .join('\n');

const remainingCount = belowThreshold.length - Math.min(belowThreshold.length, 20);
const remainingNote = remainingCount > 0
    ? `\n\n> **${remainingCount} additional files** are also below threshold. They will appear here once the files above improve.`
    : '';

const issueBody = `\
## Coverage below ${THRESHOLD}% threshold

> **This issue is the instruction set for the GitHub Copilot coding agent.**
> Copilot: read this entire body before writing a single line of code.

**Coverage run:** ${RUN_URL}
**Total line coverage:** ${totalLines}% — threshold is ${THRESHOLD}%

### Files requiring new tests

| File | Lines | Branches | Functions |
|------|-------|----------|-----------|
${tableRows}

---

### Agent instructions

You are improving test coverage in \`microsoft/vscode-cmake-tools\`.
Read \`.github/instructions/copilot-test-coverage.instructions.md\` before starting — it contains the
mandatory self-audit protocol and test quality rules for this repo.

**Files to cover (worst first):**
${fileList}

For each file:
1. Read the source file fully before writing any test
2. Identify the module's exported API surface
3. Write tests in \`test/unit-tests/backend/\` that cover the uncovered branches
4. Run the self-audit steps from \`.github/instructions/copilot-test-coverage.instructions.md\`
5. Only open the PR after every self-audit step passes

### Self-audit checklist (must be checked before opening PR)

- [ ] \`yarn backendTests\` passes with no new failures
- [ ] Each file listed above improved by ≥ 10 percentage points OR reached ≥ ${THRESHOLD}% line coverage
- [ ] No test uses \`assert.ok(true)\` or is an empty stub
- [ ] Test names describe behavior: \`'expandString handles undefined variable'\` not \`'test 1'\`
- [ ] No test depends on another test's side effects
- [ ] Presets-mode and kits/variants mode both exercised where the source branches on \`useCMakePresets\`
- [ ] Single-config and multi-config generator paths both tested where relevant
- [ ] \`yarn lint\` passes
- [ ] \`CHANGELOG.md\` has an entry under \`Improvements:\`

### Scope and testability

Coverage is collected only from \`yarn backendTests\` (\`test/unit-tests/backend/\`).
New tests **must** go in \`test/unit-tests/backend/\` and run in plain Node.js (no VS Code host).

- If a \`src/\` file can be imported directly (no \`vscode\` dependency at import time), write backend tests for it.
- If a file deeply depends on \`vscode\` APIs (e.g., \`extension.ts\`, \`projectController.ts\`, UI modules), **skip it** — add a comment in the PR noting it needs integration-test coverage instead.
- Pure logic modules (\`expand.ts\`, \`shlex.ts\`, \`cache.ts\`, \`diagnostics/\`, \`preset.ts\`) are ideal targets.
${remainingNote}

### Constraints

- Tests go in \`test/unit-tests/backend/\` — use Mocha \`suite\`/\`test\` with \`assert\`
- Validate with \`yarn backendTests\`, not \`yarn unitTests\` (which requires a VS Code host)
- Import source under test via the \`@cmt/\` path alias
- Do **not** open the PR as a draft if the self-audit fails — fix it first
- Do **not** touch source files outside \`test/\`
`;

// ── 5. Ensure the test-coverage label exists ─────────────────────────────────
{
    const result = spawnSync('gh', [
        'label', 'create', 'test-coverage',
        '--repo', REPO,
        '--color', '0075ca',
        '--description', 'Opened by the coverage agent',
        '--force'
    ], { stdio: 'inherit' });
    // Non-zero is acceptable here — label may already exist without --force support
    if (result.error) {
        console.warn('Warning: could not ensure test-coverage label exists:', result.error.message);
    }
}

// ── 6. Create or update the coverage issue ───────────────────────────────────
const title = `Test coverage below ${THRESHOLD}% threshold — ${belowThreshold.length} files need tests (${new Date().toISOString().slice(0, 10)})`;

// Write body to a temp file to avoid shell injection via file paths in the body
const bodyFile = join(tmpdir(), `coverage-issue-body-${Date.now()}.md`);
writeFileSync(bodyFile, issueBody, 'utf8');

try {
    let result;
    if (existingIssueNumber) {
        console.log(`\nUpdating existing issue #${existingIssueNumber}`);
        result = spawnSync('gh', [
            'issue', 'edit', existingIssueNumber,
            '--repo', REPO,
            '--title', title,
            '--body-file', bodyFile
        ], { stdio: 'inherit' });
    } else {
        console.log(`\nOpening issue: ${title}`);
        result = spawnSync('gh', [
            'issue', 'create',
            '--repo', REPO,
            '--title', title,
            '--body-file', bodyFile,
            '--label', 'test-coverage'
        ], { stdio: 'inherit' });
    }
    if (result.status !== 0) {
        console.error(`gh command failed with exit code ${result.status}`);
        process.exit(result.status ?? 1);
    }
} finally {
    try { unlinkSync(bodyFile); } catch { /* cleanup best-effort */ }
}

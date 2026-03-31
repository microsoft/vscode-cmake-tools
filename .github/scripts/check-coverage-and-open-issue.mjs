#!/usr/bin/env node
// @ts-check
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const THRESHOLD = Number(process.env.THRESHOLD ?? 60);
const SUMMARY_PATH = 'coverage/coverage-summary.json';
const REPO = process.env.GITHUB_REPOSITORY;     // e.g. "microsoft/vscode-cmake-tools"
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

for (const [file, metrics] of Object.entries(summary)) {
    if (file === 'total') continue;
    if (!file.startsWith('src/')) continue;

    const linePct   = metrics.lines.pct    ?? 0;
    const branchPct = metrics.branches.pct ?? 0;
    const fnPct     = metrics.functions.pct ?? 0;

    if (linePct < THRESHOLD || fnPct < THRESHOLD) {
        belowThreshold.push({ file, linePct, branchPct, fnPct });
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

// ── 3. Build the issue body (this is the Copilot agent's instruction set) ────
belowThreshold.sort((a, b) => a.linePct - b.linePct);  // worst files first

const tableRows = belowThreshold
    .slice(0, 20)  // cap at 20 files per issue to keep it focused
    .map(f => `| \`${f.file}\` | ${f.linePct}% | ${f.branchPct}% | ${f.fnPct}% |`)
    .join('\n');

const fileList = belowThreshold
    .slice(0, 20)
    .map(f => `- \`${f.file}\` — ${f.linePct}% line coverage`)
    .join('\n');

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
Read \`.github/copilot-test-coverage.md\` before starting — it contains the
mandatory self-audit protocol and test quality rules for this repo.

**Files to cover (worst first):**
${fileList}

For each file:
1. Read the source file fully before writing any test
2. Identify the module's exported API surface
3. Write tests in \`test/unit-tests/\` that cover the uncovered branches
4. Run the self-audit steps from \`copilot-test-coverage.md\`
5. Only open the PR after every self-audit step passes

### Self-audit checklist (must be checked before opening PR)

- [ ] \`yarn backendTests\` passes with no new failures
- [ ] \`yarn unitTests\` passes with no new failures
- [ ] Each file listed above improved by ≥ 10 percentage points OR reached ≥ ${THRESHOLD}% line coverage
- [ ] No test uses \`assert.ok(true)\` or is an empty stub
- [ ] Test names describe behavior: \`'expandString handles undefined variable'\` not \`'test 1'\`
- [ ] No test depends on another test's side effects
- [ ] Presets-mode and kits/variants mode both exercised where the source branches on \`useCMakePresets\`
- [ ] Single-config and multi-config generator paths both tested where relevant
- [ ] \`yarn lint\` passes
- [ ] \`CHANGELOG.md\` has an entry under \`Improvements:\`

### Constraints

- Tests go in \`test/unit-tests/\` — use Mocha \`suite\`/\`test\` with \`assert\`
- Import source under test via the \`@cmt/\` path alias
- Do **not** open the PR as a draft if the self-audit fails — fix it first
- Do **not** touch source files outside \`test/\`
`;

// ── 4. Open the issue via gh CLI ──────────────────────────────────────────────
const title = `chore: improve test coverage -- ${belowThreshold.length} files below ${THRESHOLD}% (run ${new Date().toISOString().slice(0, 10)})`;

const cmd = [
    'gh', 'issue', 'create',
    '--repo', REPO,
    '--title', JSON.stringify(title),
    '--body',  JSON.stringify(issueBody),
    '--label', 'test-coverage',
].join(' ');

console.log(`\nOpening issue: ${title}`);
execSync(cmd, { stdio: 'inherit' });

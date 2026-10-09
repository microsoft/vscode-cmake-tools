'use strict'

const fs = require("fs-extra");
const cp = require("child_process");
const Octokit = require('@octokit/rest')
const path = require('path');

const branchName = 'localization';
const mergeTo = 'main';
const commitComment = 'Localization - Translated Strings';
const pullRequestTitle = '[Auto] Localization - Translated Strings';

let repoOwner = process.argv[2];
let repoName = process.argv[3];
let authUser = process.argv[4];
let authToken = process.argv[5];
let userFullName = process.argv[6];
let userEmail = process.argv[7];
let locRootPath = process.argv[8];
let locSubPath = process.argv[9];

if (!repoOwner || !repoName || !authUser || !authToken || !userFullName || !userEmail || !locRootPath || !locSubPath) {
    console.error(`ERROR: Usage: ${path.parse(process.argv[0]).base} ${path.parse(process.argv[1]).base} repo_owner repo_name auth_token user_full_name user_email loc_root_path loc_sub_path`);
    console.error(`   repo_owner - The owner of the repo on GitHub.  i.e. microsoft`);
    console.error(`   repo_name - The name of the repo on GitHub.  i.e. vscode-cpptools`);
    console.error(`   auth_user - User account wiith permission to post a pull request against the GitHub repo.`);
    console.error(`   auth_token - A PAT associated with auth_user.`);
    console.error(`   user_full_name - A full name to associate with a git commit. (This is replaced by the PR account if commit is squashed.)`);
    console.error(`   user_email - An email to associate with a git commit. (This is replaced by the PR account if commit is squashed.)`);
    console.error(`   loc_root_path - The path to the folder with language-specific directories (containing localized xlf files).`);
    console.error(`   loc_sub_path - A sub-path after the language-specific directory, where the xlf to import is located.  This should not include the name of the xlf file to import.)`);
    return;
}

console.log(`repoOwner=${repoOwner}`);
console.log(`repoName=${repoName}`);
console.log(`authUser=${authUser}`);
console.log(`userFullName=${userFullName}`);
console.log(`userEmail=${userEmail}`);
console.log(`locRootPath=${locRootPath}`);
console.log(`locSubPath=${locSubPath}`);

function hasBranch(branchName) {
    console.log(`Checking for existence of branch "${branchName}" (git branch --list ${branchName})`);
    let output = cp.execSync(`git branch --list ${branchName}`);
    let lines = output.toString().split("\n");
    let found = false;
    lines.forEach(line => {
        found = found || (line === `  ${branchName}`);
    });

    return found;
}

function hasAnyChanges() {
    console.log("Checking if any files have changed (git status --porcelain)");
    let output = cp.execSync('git status --porcelain');
    let lines = output.toString().split("\n");
    let anyChanges = false;
    lines.forEach(line => {
        if (line != '') {
            console.log("Change detected: " + line);
            anyChanges = true;
        }
    });

    return anyChanges;
}

// Decide whether this import actually advances localization. We compare each changed i18n file
// against its committed (HEAD/main) version key-by-key and classify the semantic change:
//   - a value that is byte-identical across many locales AND carries real translatable words is
//     almost certainly untranslated English (OneLocBuild returns the English source for a string
//     that has not been translated yet), and
//   - a file whose bytes changed but whose keys/values are unchanged is a pure reorder/reformat.
// If every semantic change is untranslated (or the only change is reordering) the import makes no
// real localization progress and we should not open a pull request for it. Uses the pure helpers in
// tools/translation-verifier.js so the classification is unit-tested.
function assessLocalizationProgress() {
    const verifier = require('./tools/translation-verifier.js');
    const jsonc = require('jsonc-parser');
    const repoRoot = __dirname;
    const parse = (text) => {
        if (!text) {
            return {};
        }
        const errors = [];
        const parsed = jsonc.parse(text, errors, { allowTrailingComma: true });
        return parsed && typeof parsed === 'object' ? parsed : {};
    };

    const statusOut = cp.execSync('git status --porcelain', { encoding: 'utf8' });
    const changedEntries = [];
    let physicalI18nChange = false;
    for (const rawLine of statusOut.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (!line) {
            continue;
        }
        // Porcelain lines are "XY <path>"; nothing is staged at this point so <path> starts at col 3.
        const filePath = line.slice(3).trim();
        if (!filePath.startsWith('i18n/') || !filePath.endsWith('.i18n.json')) {
            continue;
        }
        physicalI18nChange = true;
        const parts = filePath.split('/');
        if (parts.length < 3) {
            continue;
        }
        const locale = parts[1];
        const relFile = parts.slice(2).join('/');
        let baseText = '';
        try {
            baseText = cp.execSync(`git show HEAD:${filePath}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        } catch (e) {
            baseText = ''; // new file: no committed version.
        }
        let headText = '';
        try {
            headText = fs.readFileSync(path.join(repoRoot, ...filePath.split('/')), 'utf8');
        } catch (e) {
            headText = ''; // deleted file.
        }
        const base = parse(baseText);
        const head = parse(headText);
        for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
            const inBase = typeof base[key] === 'string';
            const inHead = typeof head[key] === 'string';
            if (inHead && !inBase) {
                changedEntries.push({ file: relFile, key, locale, base: undefined, head: head[key], changeType: 'add' });
            } else if (inBase && !inHead) {
                changedEntries.push({ file: relFile, key, locale, base: base[key], head: undefined, changeType: 'delete' });
            } else if (inBase && inHead && base[key] !== head[key]) {
                changedEntries.push({ file: relFile, key, locale, base: base[key], head: head[key], changeType: 'update' });
            }
        }
    }

    if (!physicalI18nChange) {
        return { block: false, reason: '' };
    }
    if (changedEntries.length === 0) {
        // The i18n files changed on disk but no key was added, removed, or changed in value.
        return { block: true, reason: 'no-semantic-change' };
    }
    const flaggedValues = new Map(verifier.reportUntranslated(repoRoot).map((f) => [`${f.file}\u0000${f.key}`, f.value]));
    return verifier.assessImportProgress(changedEntries, flaggedValues);
}

// When invoked on build server, we should already be in a repo freshly synced to the mergeTo branch

if (hasAnyChanges()) {
    console.log(`Changes already present in this repo!  This script is intended to be run against a freshly synced ${mergeTo} branch!`);
    return;
}

function sleep(ms) {
    var unixtime_ms = new Date().getTime();
    while(new Date().getTime() < unixtime_ms + ms) {}
}

console.log("This script is potentially DESTRUCTIVE!  Cancel now, or it will proceed in 10 seconds.");
sleep(10000);

let directories = [ "cs", "de", "es", "fr", "it", "ja", "ko", "pl", "pt-BR", "ru", "tr", "zh-Hans", "zh-Hant" ];
directories.forEach(languageId => {
    let sourcePath = `${locRootPath}\\${languageId}\\${locSubPath}\\${repoName}.${languageId}.xlf`;
    let destinationPath = `./vscode-translations-import/${languageId}/vscode-extensions/${repoName}.xlf`;
    console.log(`Copying "${sourcePath}" to "${destinationPath}"`);
    fs.copySync(sourcePath, destinationPath);
});

console.log("Import translations into i18n directory");
cp.execSync("npm run translations-import");

// Restore any human-reviewed translation fixes that this import reverted (see
// jobs/loc/translation-fixes.json and tools/translation-verifier.js). Use --ledger-only so a
// genuinely new placeholder/variable break does not abort publishing the PR; that residual case is
// surfaced on the pull request by the Localization Readiness workflow instead. Running this before
// the change check below means a PR whose only change was a reverted fix collapses to no change.
console.log("Restore human-reviewed translations reverted by the import (ledger)");
try {
    cp.execSync("node ./tools/translation-verifier.js --restore --ledger-only", { stdio: "inherit" });
} catch (e) {
    console.log("Localization restore reported residual issues; continuing so the pull request still surfaces for review.");
}

if (!hasAnyChanges()) {
    console.log("No changes detected");
    return;
}

// Do not open a pull request for an import that makes no real localization progress: either the
// only changes are untranslated English strings (a newly added source string OneLocBuild returned in
// English because it is not translated yet) or a pure key reorder/reformat. This mirrors the no-op
// guard above but inspects the semantic content of the change. Any failure fails open (we still
// publish) so a genuine translation update is never dropped.
try {
    const assessment = assessLocalizationProgress();
    if (assessment && assessment.block) {
        const detail = assessment.reason === 'no-semantic-change'
            ? 'it only reorders or reformats localization files'
            : 'every changed string is still the untranslated English source';
        console.log(`No real localization progress (${assessment.reason}); not opening a pull request because ${detail}.`);
        return;
    }
} catch (e) {
    console.log(`Localization progress assessment failed (${e && e.message}); continuing to publish so real translations are not dropped.`);
}

console.log("Changes detected");

console.log(`Ensure main ref is up to date locally (git fetch)`);
cp.execSync('git fetch');

// Remove old localization branch, if any
if (hasBranch("localization")) {
	console.log(`Remove old localization branch, if any (git branch -D localization)`);
	cp.execSync('git branch -D localization');
}

// Check out local branch
console.log(`Creating local branch for changes (git checkout -b ${branchName})`);
cp.execSync('git checkout -b localization');

// Add changed files.
console.log("Adding changed file (git add .)");
cp.execSync('git add .');

// git add may have resolves CR/LF's and there may not be anything to commit
if (!hasAnyChanges()) {
    console.log("No changes detected.  The only changes must have been due to CR/LF's, and have been corrected.");
    return;
}

// Set up user and permissions

// Save existing user name and email, in case already set.
var existingUserName;
var existingUserEmail;

// Use git config commands directly to ensure we are getting and setting the local config
try {
    existingUserName = cp.execSync('git config --local user.name', { encoding: 'utf8' }).trim();
} catch (e) {
    existingUserName = undefined;
}
try {
    existingUserEmail = cp.execSync('git config --local user.email', { encoding: 'utf8' }).trim();
} catch (e) {
    existingUserEmail = undefined;
}
if (existingUserName === undefined) {
    console.log(`Existing user name: undefined`);
} else {
    console.log(`Existing user name: "${existingUserName}"`);
    cp.execSync(`git config --local --unset user.name`);
}
if (existingUserEmail === undefined) {
    console.log(`Existing user email: undefined`);
} else {
    console.log(`Existing user email: "${existingUserEmail}"`);
    cp.execSync(`git config --local --unset user.email`);
}

console.log(`Setting local user name to: "${userFullName}"`);
cp.execSync(`git config --local user.name "${userFullName}"`);

console.log(`Setting local user email to: "${userEmail}"`);
cp.execSync(`git config --local user.email "${userEmail}"`);

console.log(`Configuring git with permission to push and to create pull requests (git remote remove origin && git remote add origin https://${authUser}:${authToken}@github.com/${repoOwner}/${repoName}.git`);
cp.execSync('git remote remove origin');
cp.execSync(`git remote add origin https://${authUser}:${authToken}@github.com/${repoOwner}/${repoName}.git`);

// Commit changed files.
console.log(`Commiting changes (git commit -m "${commitComment}")`);
cp.execSync(`git commit -m "${commitComment}"`);

if (existingUserName === undefined) {
    console.log(`Restoring original user name: undefined`);
    cp.execSync(`git config --local --unset user.name`);
} else {
    console.log(`Restoring original user name: "${existingUserName}"`);
    cp.execSync(`git config --local user.name "${existingUserName}"`);
}

if (existingUserEmail === undefined) {
    console.log(`Restoring original user email: undefined`);
    cp.execSync(`git config --local --unset user.email`);
} else {
    console.log(`Restoring original user email: "${existingUserEmail}"`);
    cp.execSync(`git config --local user.email "${existingUserEmail}"`);
}

console.log(`pushing to remove branch (git push -f origin ${branchName})`);
cp.execSync(`git push -f origin ${branchName}`);

console.log("Checking if there is already a pull request...");
const octokit = new Octokit.Octokit({auth: authToken});
octokit.pulls.list({ owner: repoOwner, repo: repoName }).then(({data}) => {
    let alreadyHasPullRequest = false;
    if (data) {
        data.forEach((pr) => {
            alreadyHasPullRequest = alreadyHasPullRequest || (pr.title === pullRequestTitle);
        });
    }

    // If not already present, create a PR against our remote branch.
    if (!alreadyHasPullRequest) {
        console.log("There is not already a pull request.  Creating one.");
        octokit.pulls.create({ body:"", owner: repoOwner, repo: repoName, title: pullRequestTitle, head: branchName, base: mergeTo });
    } else {
        console.log("There is already a pull request.");
    }

    console.log(`Restoring default git permissions`);
    cp.execSync('git remote remove origin');
    cp.execSync(`git remote add origin https://github.com/${repoOwner}/${repoName}.git`);

    console.log(`Run 'git fetch' against updated remote`);
    cp.execSync('git fetch');

    console.log(`Switching back to ${mergeTo} (git checkout ${mergeTo})`);
    cp.execSync(`git checkout ${mergeTo}`);

    console.log(`Remove localization branch (git branch -D localization)`);
    cp.execSync('git branch -D localization');
});

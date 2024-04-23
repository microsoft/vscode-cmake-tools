// Copyright (c) Microsoft Corporation.

import { getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import { IGitApi } from "azure-devops-node-api/GitApi";
import {
    GitPullRequest,
    GitRepository,
    PullRequestStatus
} from "azure-devops-node-api/interfaces/GitInterfaces";
import * as cp from "child_process";
import { randomBytes } from "crypto";
import * as path from "path";
import { program } from "commander";

function assertNotNull<T>(
    x: T,
    msg: string = ""
): asserts x is Exclude<T, null | undefined> {
    if (x === null || x === undefined) {
        throw new Error(`Assert failed: unexpected null. ${msg}`);
    }
}

type Possibly<T> = T | undefined;

const repoRoot: string = path.resolve(__dirname, "..", "..", "..");
const parentRoot: string = path.resolve(repoRoot, "..");
const sourceRepo: string = "vscode-cmake-tools";

interface Settings {
    orgUrl: string;
    project: string;
    repo: string;
    sourceBranch: string;
    targetBranch: string;
    targetLocation: string;
    token: string;
    username: string;
    email: string;
    title: string;
}

// Security token is automatically created for each CI run:
// https://docs.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops&tabs=yaml#systemaccesstoken
// For local testing, set the environment variable to a PAT with write access
// https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops&tabs=preview-page#use-a-pat
function gitAuthHeader(token: string, redact?: boolean): string {
    const encodedPat = redact
        ? "**********"
        : Buffer.from(`:${token}`).toString("base64");
    return `http.extraHeader="Authorization: Basic ${encodedPat}"`;
}

export function gitExtraArgs(
    username: string,
    email: string,
    token?: string,
    redact?: boolean
): string {
    const args = [`-c user.email="${email}"`, `-c user.name="${username}"`];
    if (token) {
        args.push(`-c ${gitAuthHeader(token, redact)}`);
    }
    return args.join(" ");
}

class Session {
    private api: Possibly<WebApi>;
    private git: Possibly<IGitApi>;
    private initialized: boolean = false;

    public constructor(private readonly settings: Settings) {}

    private async getWebApi(): Promise<WebApi> {
        const authHandler = getPersonalAccessTokenHandler(this.settings.token);
        return new WebApi(this.settings.orgUrl, authHandler);
    }

    private async init(): Promise<void> {
        if (this.initialized) {
            console.warn("Already initialized");
            return;
        }

        this.initialized = true;
        this.api = await this.getWebApi();
        this.git = await this.api.getGitApi();
    }

    private async getRepos(): Promise<GitRepository[]> {
        assertNotNull(this.git);
        return this.git.getRepositories(this.settings.project);
    }

    private async getTargetRepo(): Promise<GitRepository> {
        const repo = (await this.getRepos()).find(
            (repo) => repo.name === this.settings.repo
        );
        assertNotNull(repo);
        return repo;
    }

    private getRemoteUrl(): string {
        const { orgUrl, project, repo } = this.settings;
        return `${orgUrl}/${project}/_git/${repo}`;
    }

    private runGit(command: string, withAuth: boolean = false): string {
        const redactedCliString = `git ${gitExtraArgs(
            this.settings.username,
            this.settings.email,
            withAuth ? this.settings.token : "",
            true
        )} ${command}`;
        console.log(redactedCliString);

        const cliString = `git ${gitExtraArgs(
            this.settings.username,
            this.settings.email,
            withAuth ? this.settings.token : ""
        )} ${command}`;
        const result = cp.execSync(cliString).toString("utf8");
        console.log(result);
        return result;
    }

    private sourceBranchAlreadyExists(): boolean {
        try {
            this.runGit(
                `show-ref --verify --quiet refs/heads/${this.settings.sourceBranch}`
            );
        } catch (error) {
            // --verify returns error code 1 when branch exists
            return (error as { status: number }).status !== 1;
        }
        return true;
    }

    // Adapted from
    // https://github.com/microsoft/vscode-cmake-tools/blob/a057e5ceb3ce2f98c01f6eb8117d098101f5f234/translations_auto_pr.js#L56
    private hasStagedChanges(): boolean {
        console.log("Checking if any files have changed");
        const output = this.runGit("diff --staged --name-only");
        const lines = output.toString().split("\n");
        let anyChanges = false;
        lines.forEach((line) => {
            if (line !== "") {
                console.log("Change detected: " + line);
                anyChanges = true;
            }
        });

        return anyChanges;
    }

    private prepareSourceBranch(): void {
        if (this.sourceBranchAlreadyExists()) {
            throw new Error(
                `Source branch ${this.settings.sourceBranch} already exists`
            );
        }

        // remember original branch
        const origBranch = this.runGit(`rev-parse --abbrev-ref HEAD`).trim();
        try {
            // create source branch
            this.runGit(`checkout -b ${this.settings.sourceBranch}`);

            // add all modified files in target location
            this.runGit(`add ${this.settings.targetLocation}`);

            // if no changes were detected, then there are no new updates.
            if (!this.hasStagedChanges()) {
                throw new Error("No staged changes detected");
            }

            // commit changes
            this.runGit(`commit -m "${this.settings.title}"`);

            // add remote (remove if it already exists)
            this.runGit(`remote add target ${this.getRemoteUrl()}`);

            // push source branch to remote
            this.runGit(`push target ${this.settings.sourceBranch}`, true);
        } finally {
            // restore original commit ID
            this.runGit(`checkout ${origBranch}`);
        }
    }

    private async activePullRequestExists(): Promise<boolean> {
        assertNotNull(this.git);
        const repoId = (await this.getTargetRepo()).id;
        assertNotNull(repoId);
        const pullRequests = await this.git.getPullRequests(repoId, {
            status: PullRequestStatus.Active
        });
        return pullRequests.some((pr) => pr.title?.startsWith(this.settings.title.split(" ")[0]));
    }

    private async publishPullRequest(): Promise<void> {
        const request: GitPullRequest = {
            sourceRefName: `refs/heads/${this.settings.sourceBranch}`,
            targetRefName: `refs/heads/${this.settings.targetBranch}`,
            title: this.settings.title,
            description: "An automatic PR to share code between the CMake Tools repository and the target repo."
        };
        assertNotNull(this.git);
        const repoId = (await this.getTargetRepo()).id;
        assertNotNull(repoId);
        console.log("Creating Pull Request", request, repoId);
        const response = await this.git.createPullRequest(request, repoId);

        // Use the createdBy field in the response as the id of the autocompleter
        // https://developercommunity.visualstudio.com/t/how-to-get-identityref-for-the-current-user-or-arb/1129979#T-N1132219
        const createdBy = response.createdBy;
        const pullRequestId = response.pullRequestId;
        assertNotNull(
            createdBy,
            "Response is missing expected property: createdBy"
        );
        assertNotNull(
            pullRequestId,
            "Response is missing expected property: pullRequestId"
        );
        await this.git.updatePullRequest(
            { autoCompleteSetBy: createdBy },
            repoId,
            pullRequestId
        );
    }

    private cleanup(): void {
        try {
            // remove source branch
            this.runGit(`branch -D ${this.settings.sourceBranch}`);
        } catch (error) {
            // ok if the branch doesn't exist
        }
        try {
            // remove remote
            this.runGit(`remote remove target`);
        } catch (error) {
            // ok if the remote doesn't exist
        }
    }

    public async run(): Promise<void> {
        try {
            await this.init();
            if (await this.activePullRequestExists()) {
                console.warn(
                    "An active pull request already exists, exiting."
                );
                return;
            }
            this.prepareSourceBranch();
            await this.publishPullRequest();
        } catch (error) {
            console.error(error);
        } finally {
            this.cleanup();
        }
    }
}

export function createPullRequest(settings: Settings): void {
    void new Session(settings).run();
}

export function copyFiles(sourceLocation: string, targetRepo: string, targetLocation: string): void {
    // Copy files from source to target location
    const absoluteSourceLocation = path.resolve(parentRoot, `${sourceRepo}/${sourceLocation}/*`);
    const absoluteTargetLocation = path.resolve(parentRoot, `${targetRepo}/${targetLocation}`);
    console.log(absoluteSourceLocation);
    console.log(absoluteTargetLocation);
    cp.execSync(`copy ${absoluteSourceLocation} ${absoluteTargetLocation}`);
    console.log(`Copying files from ${absoluteSourceLocation} to ${absoluteTargetLocation}`);
}

program.description("Create a pull request in the desired location.");

program.requiredOption("--source-file-location <source-file-location>", "The source file location. Relative path from the root of the repository.")
    .requiredOption("--target-repo <target-repo>", "The target repository.")
    .requiredOption("--target-file-location <target-file-location>", "The target file location. Relative path from the root of the repository.")
    .parse(process.argv);

const options = program.opts();

if (options.sourceFileLocation && options.targetRepo && options.targetFileLocation) {
    copyFiles(options.sourceFileLocation, options.targetRepo, options.targetFileLocation);

    assertNotNull(process.env.SYSTEM_ACCESSTOKEN);
    assertNotNull(process.env.USERNAME);
    assertNotNull(process.env.EMAIL);
    assertNotNull(process.env.ORGURL);
    assertNotNull(process.env.SYSTEM_TEAMPROJECT);

    const buildIdentifier: string = process.env.BUILD_BUILDNUMBER
        ? // For CI, we use the build number
        process.env.BUILD_BUILDNUMBER
        : // For local testing, we use "localtest-<4 bytes of random hex>"
        `localtest-${randomBytes(4).toString("hex")}`;

    const prTitlePrefix: string = "[Updating code from vscode-cmake-tools]";

    const settings: Settings = {
        orgUrl: process.env.ORGURL,
        project: process.env.SYSTEM_TEAMPROJECT,
        repo: options.targetRepo,
        sourceBranch: `create-pr/${buildIdentifier}`,
        targetBranch: "main",
        targetLocation: options.targetFileLocation,
        token: process.env.SYSTEM_ACCESSTOKEN || "",
        username: process.env.USERNAME,
        email: process.env.EMAIL,
        title: `${prTitlePrefix} ${buildIdentifier}`
    };

    createPullRequest(settings);
}

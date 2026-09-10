import { platformNormalizePath } from '@cmt/util';

/**
 * Pure routing helpers shared by the test CodeLens provider and the CodeLens command handlers.
 *
 * A CodeLens action must always carry the identity of the project that owns the test, otherwise a
 * test name that exists in more than one project in the same workspace (for example `unit_tests`)
 * would be run against whichever project happens to be enumerated first.
 *
 * This module intentionally depends only on path utilities so that it can be unit tested directly.
 */

export const runTestFromCodeLensCommand = 'cmake.runTestFromCodeLens';
export const debugTestFromCodeLensCommand = 'cmake.debugTestFromCodeLens';

/**
 * The minimal shape of a `CMakeProject` needed to route a CodeLens action. The project's source
 * directory is the identity already used across the extension (project controller, test explorer
 * roots, driver map) to distinguish projects, so it is what the CodeLens carries.
 */
export interface CodeLensTestProject {
    readonly sourceDir: string;
    readonly cTestController: { getTestNames(): string[] | undefined };
}

export enum TestProjectResolutionError {
    /** The CodeLens did not carry a project identity, so the target project is unknown. */
    MissingProjectId = 'missingProjectId',
    /** The project identity no longer matches any open project (stale CodeLens). */
    UnknownProject = 'unknownProject',
    /** The identified project exists, but it does not own a test with this name. */
    TestNotInProject = 'testNotInProject'
}

export interface TestProjectResolution<T extends CodeLensTestProject> {
    project?: T;
    error?: TestProjectResolutionError;
}

export interface TestCodeLensCommand {
    title: string;
    command: string;
    arguments: [string, string];
}

/**
 * The stable identifier for a project, used in CodeLens command arguments.
 */
export function projectIdOf(project: CodeLensTestProject): string {
    return project.sourceDir;
}

function normalizeProjectId(projectId: string): string {
    return platformNormalizePath(projectId);
}

/**
 * Loose comparison of test names, matching the leniency of the doctest fallback in the CodeLens
 * provider (which may report a `TEST_CASE` name that CTest registered under a decorated name).
 */
export function normalizeTestName(testName: string): string {
    return testName
        .toLowerCase()
        .replace(/^\s*scenario:\s*/, '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Whether a project reports a test with this name. Returns undefined when the project has no
 * discovered tests yet, in which case ownership cannot be proven or disproven.
 */
export function projectOwnsTestName(project: CodeLensTestProject, testName: string): boolean | undefined {
    const names = project.cTestController.getTestNames();
    if (!names || names.length === 0) {
        return undefined;
    }
    if (names.includes(testName)) {
        return true;
    }
    const normalized = normalizeTestName(testName);
    return names.some(name => normalizeTestName(name) === normalized);
}

function isPathWithin(filePath: string, directory: string): boolean {
    const normalizedFile = platformNormalizePath(filePath);
    const normalizedDir = platformNormalizePath(directory);
    if (normalizedFile === normalizedDir) {
        return true;
    }
    const prefix = normalizedDir.endsWith('/') ? normalizedDir : `${normalizedDir}/`;
    return normalizedFile.startsWith(prefix);
}

/**
 * Resolves the project a CodeLens action must run in.
 *
 * Routing is always driven by the project identity carried in the CodeLens arguments; the test name
 * is only used to validate that the identified project really owns the test. When the identity is
 * missing, stale, or the test is not part of that project, this fails instead of falling back to a
 * same-named test in another project.
 */
export function resolveTestProject<T extends CodeLensTestProject>(
    projects: T[],
    projectId: string | undefined,
    testName: string | undefined
): TestProjectResolution<T> {
    if (!projectId || !testName) {
        return { error: TestProjectResolutionError.MissingProjectId };
    }

    const normalizedProjectId = normalizeProjectId(projectId);
    const project = projects.find(candidate => normalizeProjectId(candidate.sourceDir) === normalizedProjectId);
    if (!project) {
        return { error: TestProjectResolutionError.UnknownProject };
    }

    if (projectOwnsTestName(project, testName) === false) {
        return { error: TestProjectResolutionError.TestNotInProject };
    }

    return { project };
}

/**
 * Picks the project that owns a test that was parsed out of a document rather than mapped from
 * CTest metadata. Projects that have not discovered any tests yet cannot be excluded by name, so
 * ambiguity is broken by which project's source tree contains the document. Returns undefined when
 * the owner remains ambiguous, so that no CodeLens is offered rather than a mis-routed one.
 */
export function selectProjectForDocumentTest<T extends CodeLensTestProject>(
    projects: T[],
    documentPath: string,
    testName: string
): T | undefined {
    const candidates = projects.filter(project => projectOwnsTestName(project, testName) !== false);
    if (candidates.length === 0) {
        return undefined;
    }
    if (candidates.length === 1) {
        return candidates[0];
    }

    let best: T | undefined;
    let bestLength = -1;
    for (const candidate of candidates) {
        const sourceDir = platformNormalizePath(candidate.sourceDir);
        if (isPathWithin(documentPath, sourceDir) && sourceDir.length > bestLength) {
            best = candidate;
            bestLength = sourceDir.length;
        }
    }
    return best;
}

/**
 * Builds the command for a test CodeLens, always carrying the owning project's identity alongside
 * the test name.
 */
export function makeTestCodeLensCommand(command: string, title: string, testName: string, projectId: string): TestCodeLensCommand {
    return {
        title,
        command,
        arguments: [testName, projectId]
    };
}

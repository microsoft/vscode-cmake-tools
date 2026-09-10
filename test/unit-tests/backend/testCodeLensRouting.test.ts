import { expect } from 'chai';
import {
    debugTestFromCodeLensCommand,
    makeTestCodeLensCommand,
    resolveTestProject,
    runTestFromCodeLensCommand,
    selectProjectForDocumentTest,
    projectIdOf,
    TestProjectResolutionError
} from '@cmt/ui/testCodeLensRouting';

interface FakeProject {
    readonly sourceDir: string;
    readonly cTestController: { getTestNames(): string[] | undefined };
}

function makeProject(sourceDir: string, testNames?: string[]): FakeProject {
    return {
        sourceDir,
        cTestController: { getTestNames: () => testNames }
    };
}

/**
 * The pre-fix routing: find the first project that reports a test with this name. Kept here to show
 * that the regression it caused is actually fixed by resolveTestProject().
 */
function legacyResolveByTestNameOnly(projects: FakeProject[], testName: string): FakeProject | undefined {
    return projects.find(project => (project.cTestController.getTestNames() ?? []).includes(testName));
}

const projectA = makeProject('/work/projectA', ['unit_tests', 'a_only_tests']);
const projectB = makeProject('/work/projectB', ['unit_tests', 'b_only_tests']);
const projects = [projectA, projectB];

suite('[Test CodeLens routing]', () => {
    test('CodeLens command arguments carry the project identity', () => {
        const command = makeTestCodeLensCommand(runTestFromCodeLensCommand, '$(run) Run', 'unit_tests', projectIdOf(projectB));
        expect(command.command).to.equal('cmake.runTestFromCodeLens');
        expect(command.arguments).to.deep.equal(['unit_tests', '/work/projectB']);

        const debugCommand = makeTestCodeLensCommand(debugTestFromCodeLensCommand, '$(debug) Debug', 'unit_tests', projectIdOf(projectA));
        expect(debugCommand.command).to.equal('cmake.debugTestFromCodeLens');
        expect(debugCommand.arguments).to.deep.equal(['unit_tests', '/work/projectA']);
    });

    test('Same test name in two projects resolves to the requested project', () => {
        // Regression: routing by test name alone always picked project A.
        expect(legacyResolveByTestNameOnly(projects, 'unit_tests')).to.equal(projectA);

        const resolvedB = resolveTestProject(projects, projectIdOf(projectB), 'unit_tests');
        expect(resolvedB.project).to.equal(projectB);
        expect(resolvedB.error).to.equal(undefined);

        const resolvedA = resolveTestProject(projects, projectIdOf(projectA), 'unit_tests');
        expect(resolvedA.project).to.equal(projectA);
    });

    test('Stale project identity fails safely instead of falling back to another project', () => {
        const resolution = resolveTestProject(projects, '/work/projectC', 'unit_tests');
        expect(resolution.project).to.equal(undefined);
        expect(resolution.error).to.equal(TestProjectResolutionError.UnknownProject);
    });

    test('Missing project identity fails safely', () => {
        const resolution = resolveTestProject(projects, undefined, 'unit_tests');
        expect(resolution.project).to.equal(undefined);
        expect(resolution.error).to.equal(TestProjectResolutionError.MissingProjectId);
    });

    test('Missing test name fails safely', () => {
        const resolution = resolveTestProject(projects, projectIdOf(projectA), undefined);
        expect(resolution.project).to.equal(undefined);
        expect(resolution.error).to.equal(TestProjectResolutionError.MissingProjectId);
    });

    test('Identified project that does not own the test fails safely', () => {
        const resolution = resolveTestProject(projects, projectIdOf(projectB), 'a_only_tests');
        expect(resolution.project).to.equal(undefined);
        expect(resolution.error).to.equal(TestProjectResolutionError.TestNotInProject);
    });

    test('Project identity comparison is path normalized', () => {
        const windowsProjects = [makeProject('C:\\work\\Project B', ['unit_tests'])];
        const resolution = resolveTestProject(windowsProjects, 'C:/work/Project B/', 'unit_tests');
        expect(resolution.project).to.equal(windowsProjects[0]);
    });

    test('Project with no discovered tests is still routable by identity', () => {
        const notConfigured = makeProject('/work/projectC', undefined);
        const resolution = resolveTestProject([projectA, notConfigured], '/work/projectC', 'unit_tests');
        expect(resolution.project).to.equal(notConfigured);
    });

    test('Decorated CTest names match the parsed doctest name', () => {
        const doctestProject = makeProject('/work/projectD', ['Scenario: adds two numbers [math]']);
        const resolution = resolveTestProject([doctestProject], '/work/projectD', 'adds two numbers');
        expect(resolution.project).to.equal(doctestProject);
    });
});

suite('[Test CodeLens owner selection for parsed tests]', () => {
    test('Ambiguous test name is resolved by the document location', () => {
        const owner = selectProjectForDocumentTest(projects, '/work/projectB/src/tests.cpp', 'unit_tests');
        expect(owner).to.equal(projectB);
    });

    test('Unique owner is selected regardless of document location', () => {
        const owner = selectProjectForDocumentTest(projects, '/somewhere/else/tests.cpp', 'b_only_tests');
        expect(owner).to.equal(projectB);
    });

    test('Ambiguous owner outside every project source tree yields no CodeLens', () => {
        const owner = selectProjectForDocumentTest(projects, '/somewhere/else/tests.cpp', 'unit_tests');
        expect(owner).to.equal(undefined);
    });

    test('Nested projects prefer the innermost source directory', () => {
        const outer = makeProject('/work/outer', ['unit_tests']);
        const inner = makeProject('/work/outer/inner', ['unit_tests']);
        const owner = selectProjectForDocumentTest([outer, inner], '/work/outer/inner/src/tests.cpp', 'unit_tests');
        expect(owner).to.equal(inner);
    });

    test('No project reporting the test yields no CodeLens', () => {
        const owner = selectProjectForDocumentTest(projects, '/work/projectA/src/tests.cpp', 'unknown_test');
        expect(owner).to.equal(undefined);
    });
});

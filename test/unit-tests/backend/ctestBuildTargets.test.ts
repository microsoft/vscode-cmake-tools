import { expect } from 'chai';
import { resolveTestBuildTargets } from '@cmt/ctestBuildTargets';

function normalizePath(input: string): string {
    return input.replace(/\\/g, '/').toLowerCase();
}

suite('[CTest build target resolution]', () => {
    test('maps CTest programs to executable target names', () => {
        const result = resolveTestBuildTargets(
            ['C:\\project\\build\\direct_test.exe'],
            [
                { name: 'direct_test', path: 'C:\\project\\build\\direct_test.exe' },
                { name: 'helper', path: 'C:\\project\\build\\helper.exe' }
            ],
            normalizePath
        );

        expect(result.targets).to.deep.equal(['direct_test']);
        expect(result.unresolvedPrograms).to.deep.equal([]);
    });

    test('deduplicates targets shared by multiple tests', () => {
        const result = resolveTestBuildTargets(
            ['C:\\project\\build\\example_test.exe', 'C:\\project\\build\\example_test.exe'],
            [{ name: 'example_test', path: 'C:\\project\\build\\example_test.exe' }],
            normalizePath
        );

        expect(result.targets).to.deep.equal(['example_test']);
        expect(result.unresolvedPrograms).to.deep.equal([]);
    });

    test('excludes install targets from the executable lookup', () => {
        const result = resolveTestBuildTargets(
            ['C:\\project\\install\\example_test.exe'],
            [
                { name: 'example_test (Install)', path: 'C:\\project\\install\\example_test.exe', isInstallTarget: true }
            ],
            normalizePath
        );

        expect(result.targets).to.deep.equal([]);
        expect(result.unresolvedPrograms).to.deep.equal(['C:\\project\\install\\example_test.exe']);
    });

    test('reports wrapper commands as unresolved so callers can fall back to the default build', () => {
        const result = resolveTestBuildTargets(
            ['C:\\Windows\\System32\\cmd.exe'],
            [{ name: 'example_test', path: 'C:\\project\\build\\example_test.exe' }],
            normalizePath
        );

        expect(result.targets).to.deep.equal([]);
        expect(result.unresolvedPrograms).to.deep.equal(['C:\\Windows\\System32\\cmd.exe']);
    });

    test('preserves targeted builds when every selected test maps to a CMake executable target', () => {
        const result = resolveTestBuildTargets(
            ['C:\\project\\build\\a.exe', 'C:\\project\\build\\b.exe'],
            [
                { name: 'a', path: 'C:\\project\\build\\a.exe' },
                { name: 'b', path: 'C:\\project\\build\\b.exe' }
            ],
            normalizePath
        );

        expect(result.targets).to.deep.equal(['a', 'b']);
        expect(result.unresolvedPrograms).to.deep.equal([]);
    });
});

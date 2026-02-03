import * as util from '@cmt/util';
import * as vscode from 'vscode';
import { expect } from '@test/util';
import * as path from 'path';

suite('Utils test', () => {
    test('Split path into elements', () => {
        const elems = util.splitPath('foo/bar/baz');
        expect(elems).to.eql(['foo', 'bar', 'baz']);
    });
    test('Split empty path', () => {
        const elems = util.splitPath('');
        expect(elems).to.eql([]);
    });
    test('Milliseconds to time span string', () => {
        const tests: [x: number, s: string][] = [
            [0, '00:00:00.000'],
            [1, '00:00:00.001'],
            [10, '00:00:00.010'],
            [100, '00:00:00.100'],
            [1000, '00:00:01.000'],
            [10000, '00:00:10.000'],
            [60000, '00:01:00.000'],
            [600000, '00:10:00.000'],
            [3600000, '01:00:00.000'],
            [36000000, '10:00:00.000'],
            [39599999, '10:59:59.999']
        ];
        for (const test of tests) {
            expect(util.msToString(test[0])).to.eq(test[1]);
        }
    });
});

// Shared test helper for creating mock workspace folders
function createMockWorkspaceFolder(fsPath: string, name: string): vscode.WorkspaceFolder {
    return {
        uri: vscode.Uri.file(fsPath),
        name: name,
        index: 0
    };
}

// Test base path that works on both Windows and Unix
const testBasePath = process.platform === 'win32' ? 'C:\\Projects\\MyProject' : '/home/user/projects/myproject';

suite('expandExcludePath tests', () => {
    test('Expand ${workspaceFolder} variable', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('${workspaceFolder}/subdir', folder);
        const expected = path.normalize(path.join(testBasePath, 'subdir'));
        expect(result).to.eq(expected);
    });

    test('Expand multiple ${workspaceFolder} variables', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('${workspaceFolder}/foo/${workspaceFolder}/bar', folder);
        const expected = path.normalize(path.join(testBasePath, 'foo', testBasePath, 'bar'));
        expect(result).to.eq(expected);
    });

    test('Resolve relative path', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('subdir/nested', folder);
        const expected = path.normalize(path.join(testBasePath, 'subdir', 'nested'));
        expect(result).to.eq(expected);
    });

    test('Absolute path remains unchanged', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const absolutePath = process.platform === 'win32' ? 'D:\\Other\\Path' : '/other/path';
        const result = util.expandExcludePath(absolutePath, folder);
        const expected = path.normalize(absolutePath);
        expect(result).to.eq(expected);
    });

    test('Expand ${workspaceFolder} and resolve relative path', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('${workspaceFolder}/../other', folder);
        const expected = path.normalize(path.join(testBasePath, '..', 'other'));
        expect(result).to.eq(expected);
    });

    test('${workspaceFolder:name} fallback when folder name not found', () => {
        // When ${workspaceFolder:name} references a folder that doesn't exist in the workspace,
        // the variable should be left unchanged and then resolved as a relative path
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const input = '${workspaceFolder:NonExistentFolder}/subdir';
        const result = util.expandExcludePath(input, folder);
        // If vscode.workspace.workspaceFolders is empty or undefined, or if the folder is not found,
        // the ${workspaceFolder:NonExistentFolder} variable is left as-is
        // Then resolvePath treats it as a relative path segment
        const expectedPath = path.normalize(path.join(testBasePath, '${workspaceFolder:NonExistentFolder}', 'subdir'));
        expect(result).to.eq(expectedPath);
    });
});

suite('expandExcludePaths tests', () => {
    test('Expand multiple paths', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const paths = [
            '${workspaceFolder}/subdir1',
            'relative/path',
            process.platform === 'win32' ? 'D:\\Absolute\\Path' : '/absolute/path'
        ];
        const results = util.expandExcludePaths(paths, folder);

        expect(results).to.have.lengthOf(3);
        expect(results[0]).to.eq(path.normalize(path.join(testBasePath, 'subdir1')));
        expect(results[1]).to.eq(path.normalize(path.join(testBasePath, 'relative', 'path')));
        expect(results[2]).to.eq(path.normalize(process.platform === 'win32' ? 'D:\\Absolute\\Path' : '/absolute/path'));
    });

    test('Empty array returns empty array', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const results = util.expandExcludePaths([], folder);
        expect(results).to.have.lengthOf(0);
    });
});

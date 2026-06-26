/**
 * Unit tests for utility functions in util.ts
 */

import * as util from '@cmt/util';
import * as vscode from 'vscode';
import { expect } from '@test/util';
import * as path from 'path';
import * as sinon from 'sinon';

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
    // Helper to get expected path using the same normalization as the code under test
    // The expandExcludePath function uses lightNormalizePath which converts backslashes to forward slashes
    // and vscode.Uri.file().fsPath may return lowercase drive letters on Windows
    function getExpectedPath(...segments: string[]): string {
        const folder = createMockWorkspaceFolder(segments[0], 'test');
        return util.lightNormalizePath(path.join(...segments.map(s => s === segments[0] ? folder.uri.fsPath : s)));
    }

    test('Expand ${workspaceFolder} variable', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('${workspaceFolder}/subdir', folder);
        const expected = getExpectedPath(testBasePath, 'subdir');
        expect(result).to.eq(expected);
    });

    test('Expand multiple ${workspaceFolder} variables', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('${workspaceFolder}/foo/${workspaceFolder}/bar', folder);
        // For this case, we need to manually construct the expected path since it contains testBasePath twice
        const folderPath = folder.uri.fsPath;
        const expected = util.lightNormalizePath(path.join(folderPath, 'foo', folderPath, 'bar'));
        expect(result).to.eq(expected);
    });

    test('Resolve relative path', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('subdir/nested', folder);
        const expected = getExpectedPath(testBasePath, 'subdir', 'nested');
        expect(result).to.eq(expected);
    });

    test('Absolute path remains unchanged', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const absolutePath = process.platform === 'win32' ? 'D:\\Other\\Path' : '/other/path';
        const result = util.expandExcludePath(absolutePath, folder);
        const expected = util.lightNormalizePath(absolutePath);
        expect(result).to.eq(expected);
    });

    test('Expand ${workspaceFolder} and resolve relative path', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const result = util.expandExcludePath('${workspaceFolder}/../other', folder);
        const folderPath = folder.uri.fsPath;
        const expected = util.lightNormalizePath(path.join(folderPath, '..', 'other'));
        expect(result).to.eq(expected);
    });

    test('Expand ${workspaceFolder:name} when named folder exists', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const otherBasePath = process.platform === 'win32' ? 'C:\\Projects\\OtherProject' : '/home/user/projects/otherproject';
        const otherFolder = createMockWorkspaceFolder(otherBasePath, 'OtherProject');

        const stub = sinon.stub(vscode.workspace, 'workspaceFolders').value([folder, otherFolder]);
        try {
            const result = util.expandExcludePath('${workspaceFolder:OtherProject}/subdir', folder);
            const expected = util.lightNormalizePath(path.join(otherFolder.uri.fsPath, 'subdir'));
            expect(result).to.eq(expected);
        } finally {
            stub.restore();
        }
    });

    test('Expand ${workspaceFolder:name} is case-insensitive', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const otherBasePath = process.platform === 'win32' ? 'C:\\Projects\\OtherProject' : '/home/user/projects/otherproject';
        const otherFolder = createMockWorkspaceFolder(otherBasePath, 'OtherProject');

        const stub = sinon.stub(vscode.workspace, 'workspaceFolders').value([folder, otherFolder]);
        try {
            const result = util.expandExcludePath('${workspaceFolder:otherproject}/subdir', folder);
            const expected = util.lightNormalizePath(path.join(otherFolder.uri.fsPath, 'subdir'));
            expect(result).to.eq(expected);
        } finally {
            stub.restore();
        }
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
        const folderPath = folder.uri.fsPath;
        const expectedPath = util.lightNormalizePath(path.join(folderPath, '${workspaceFolder:NonExistentFolder}', 'subdir'));
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
        const folderPath = folder.uri.fsPath;

        expect(results).to.have.lengthOf(3);
        expect(results[0]).to.eq(util.lightNormalizePath(path.join(folderPath, 'subdir1')));
        expect(results[1]).to.eq(util.lightNormalizePath(path.join(folderPath, 'relative', 'path')));
        expect(results[2]).to.eq(util.lightNormalizePath(process.platform === 'win32' ? 'D:\\Absolute\\Path' : '/absolute/path'));
    });

    test('Empty array returns empty array', () => {
        const folder = createMockWorkspaceFolder(testBasePath, 'MyProject');
        const results = util.expandExcludePaths([], folder);
        expect(results).to.have.lengthOf(0);
    });
});

suite('getNestedCMakeListsDirs tests', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    let root: string;

    function makeFile(...segments: string[]): void {
        const file = path.join(root, ...segments);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '');
    }

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-nested-'));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });

    test('Finds a single nested CMakeLists.txt directory', async () => {
        makeFile('source', 'CMakeLists.txt');
        const dirs = await util.getNestedCMakeListsDirs(root);
        expect(dirs).to.eql([path.join(root, 'source')]);
    });

    test('Returns only the top-most CMakeLists.txt per branch', async () => {
        makeFile('source', 'CMakeLists.txt');
        makeFile('source', 'sub', 'CMakeLists.txt');
        const dirs = await util.getNestedCMakeListsDirs(root);
        expect(dirs).to.eql([path.join(root, 'source')]);
    });

    test('Excludes build and dependency directories', async () => {
        makeFile('build', 'CMakeLists.txt');
        makeFile('node_modules', 'pkg', 'CMakeLists.txt');
        makeFile('out', 'CMakeLists.txt');
        makeFile('.git', 'CMakeLists.txt');
        makeFile('vendor', 'CMakeLists.txt');
        makeFile('src', 'CMakeLists.txt');
        const dirs = await util.getNestedCMakeListsDirs(root);
        expect(dirs).to.eql([path.join(root, 'src')]);
    });

    test('Returns multiple sibling candidates sorted shallowest-first', async () => {
        makeFile('source', 'CMakeLists.txt');
        makeFile('tests', 'CMakeLists.txt');
        makeFile('tools', 'deep', 'CMakeLists.txt');
        const dirs = await util.getNestedCMakeListsDirs(root);
        const shallowest = dirs[0].split(path.sep).length;
        // The two depth-1 candidates come before the deeper one.
        expect(dirs.slice(0, 2).map(d => path.basename(d)).sort()).to.eql(['source', 'tests']);
        expect(dirs.every(d => d.split(path.sep).length >= shallowest)).to.equal(true);
    });

    test('Respects the maximum search depth', async () => {
        makeFile('a', 'b', 'c', 'd', 'CMakeLists.txt');
        const withinDefault = await util.getNestedCMakeListsDirs(root);
        expect(withinDefault).to.eql([]);
        const deeper = await util.getNestedCMakeListsDirs(root, 4);
        expect(deeper).to.eql([path.join(root, 'a', 'b', 'c', 'd')]);
    });

    test('Returns empty when there are no nested CMakeLists.txt files', async () => {
        makeFile('docs', 'readme.md');
        const dirs = await util.getNestedCMakeListsDirs(root);
        expect(dirs).to.eql([]);
    });
});

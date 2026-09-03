import { expect } from '@test/util';
import * as vscode from 'vscode';
import { activeProjectBelongsToFolder } from '@cmt/cmakeTaskProvider';

function projectStub(workspaceFolderPath: string): any {
    return {
        workspaceFolder: {
            uri: vscode.Uri.file(workspaceFolderPath)
        }
    };
}

function workspaceFolderStub(workspaceFolderPath: string): vscode.WorkspaceFolder {
    return { uri: vscode.Uri.file(workspaceFolderPath) } as any as vscode.WorkspaceFolder;
}

// Regression tests for #4512: a `cmake` task scoped to a workspace folder that hosts multiple
// projects (e.g. several cmake.sourceDirectory entries) must honor the active project instead of
// always falling back to the folder's first project.
suite('CMake task provider active-project selection (#4512)', () => {
    test('prefers the active project when it belongs to the task workspace folder', () => {
        const folder = process.platform === 'win32' ? 'C:\\ws' : '/ws';
        const activeProject = projectStub(folder);

        expect(activeProjectBelongsToFolder(activeProject, workspaceFolderStub(folder))).to.be.true;
    });

    test('falls back when the active project belongs to a different workspace folder', () => {
        const activeFolder = process.platform === 'win32' ? 'C:\\ws-a' : '/ws-a';
        const taskFolder = process.platform === 'win32' ? 'C:\\ws-b' : '/ws-b';
        const activeProject = projectStub(activeFolder);

        expect(activeProjectBelongsToFolder(activeProject, workspaceFolderStub(taskFolder))).to.be.false;
    });

    test('falls back when there is no active project', () => {
        const folder = process.platform === 'win32' ? 'C:\\ws' : '/ws';

        expect(activeProjectBelongsToFolder(undefined, workspaceFolderStub(folder))).to.be.false;
    });

    test('matches folders that differ only by path normalization', () => {
        // Same folder expressed with a different separator / drive-letter casing should still match.
        const projectFolder = process.platform === 'win32' ? 'c:/ws/proj/..' : '/ws/proj/..';
        const taskFolder = process.platform === 'win32' ? 'C:\\ws' : '/ws';
        const activeProject = projectStub(projectFolder);

        expect(activeProjectBelongsToFolder(activeProject, workspaceFolderStub(taskFolder))).to.be.true;
    });
});

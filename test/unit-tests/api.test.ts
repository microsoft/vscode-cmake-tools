import { expect } from '@test/util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CMakeToolsApiImpl } from '@cmt/api';
import { platformNormalizePath } from '@cmt/util';

function createProjectStub(sourceDir: string, workspaceFolderPath: string = sourceDir): any {
    return {
        sourceDir,
        workspaceFolder: {
            uri: vscode.Uri.file(workspaceFolderPath)
        }
    };
}

suite('CMake Tools API tests', () => {
    test('getProject resolves file URIs to the deepest matching project without folder lookup', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-tools-api-'));

        try {
            const projectRoot = path.join(tempRoot, 'project');
            const nestedProjectRoot = path.join(projectRoot, 'subproject');
            const sourceFile = path.join(nestedProjectRoot, 'src', 'main.cpp');

            fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
            fs.writeFileSync(sourceFile, 'int main() { return 0; }');

            const parentProject = createProjectStub(projectRoot);
            const nestedProject = createProjectStub(nestedProjectRoot);
            let folderLookupCalled = false;

            const api = new CMakeToolsApiImpl({
                projectController: {
                    getProjectForFolder: async (_folder: string) => {
                        folderLookupCalled = true;
                        return undefined;
                    },
                    getAllCMakeProjects: () => [parentProject, nestedProject]
                }
            } as any);

            const result = await api.getProject(vscode.Uri.file(sourceFile));

            expect(folderLookupCalled).to.be.false;
            expect(result).to.not.be.undefined;
            expect((result as any).project).to.equal(nestedProject);
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    test('getProject preserves exact folder lookup for directory URIs', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-tools-api-'));

        try {
            const projectRoot = path.join(tempRoot, 'project');
            fs.mkdirSync(projectRoot, { recursive: true });

            const exactProject = createProjectStub(projectRoot);
            let folderLookupPath: string | undefined;

            const api = new CMakeToolsApiImpl({
                projectController: {
                    getProjectForFolder: async (folder: string) => {
                        folderLookupPath = folder;
                        return exactProject;
                    },
                    getAllCMakeProjects: () => []
                }
            } as any);

            const result = await api.getProject(vscode.Uri.file(projectRoot));

            expect(platformNormalizePath(folderLookupPath || '')).to.equal(platformNormalizePath(projectRoot));
            expect(result).to.not.be.undefined;
            expect((result as any).project).to.equal(exactProject);
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });
});

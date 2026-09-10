import { expect } from 'chai';
import * as path from 'path';

import { BuildDirectoryRefusalReason, isSafeToDeleteBuildDirectory, withInProgressFlag } from '@cmt/drivers/buildDirectoryGuard';

const win32 = path.win32;
const posix = path.posix;

suite('Build directory deletion guard', () => {
    test('refuses to delete the build directory when it is the source directory', () => {
        const result = isSafeToDeleteBuildDirectory('C:\\src\\project', 'C:\\src\\project', ['C:\\src\\project'], win32);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);

        const posixResult = isSafeToDeleteBuildDirectory('/home/user/project', '/home/user/project', [], posix);
        expect(posixResult.safe).to.be.false;
        expect(posixResult.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);
    });

    test('refuses to delete the build directory when it is the source directory with different case or trailing separator (Windows)', () => {
        const result = isSafeToDeleteBuildDirectory('c:\\SRC\\Project\\', 'C:\\src\\project', [], win32);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);
    });

    test('refuses to delete the build directory when it is a workspace folder', () => {
        const result = isSafeToDeleteBuildDirectory('C:\\ws', 'C:\\src\\project', ['C:\\ws'], win32);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.WorkspaceRoot);
        expect(result.conflictingPath).to.equal('C:\\ws');
    });

    test('refuses to delete the build directory when it contains a workspace folder', () => {
        const result = isSafeToDeleteBuildDirectory('/home/user', '/opt/sources/project', ['/home/user/ws'], posix);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.WorkspaceRootAncestor);
        expect(result.conflictingPath).to.equal('/home/user/ws');
    });

    test('refuses to delete the build directory when it is a parent of the source directory', () => {
        const result = isSafeToDeleteBuildDirectory('C:\\src', 'C:\\src\\project', [], win32);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectoryAncestor);
        expect(result.conflictingPath).to.equal('C:\\src\\project');

        const posixResult = isSafeToDeleteBuildDirectory('/home', '/home/user/project', [], posix);
        expect(posixResult.safe).to.be.false;
        expect(posixResult.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectoryAncestor);
    });

    test('refuses a build directory that normalizes into a parent of the source directory', () => {
        const result = isSafeToDeleteBuildDirectory('C:\\src\\project\\build\\..\\..', 'C:\\src\\project', [], win32);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectoryAncestor);
    });

    test('allows deleting a normal out-of-source build directory', () => {
        const result = isSafeToDeleteBuildDirectory('C:\\src\\project\\build', 'C:\\src\\project', ['C:\\src\\project'], win32);
        expect(result.safe).to.be.true;
        expect(result.reason).to.be.undefined;
        expect(result.resolvedBinaryDir).to.equal('C:\\src\\project\\build');

        const sibling = isSafeToDeleteBuildDirectory('C:\\builds\\project-x86', 'C:\\src\\project', ['C:\\ws'], win32);
        expect(sibling.safe).to.be.true;

        const posixResult = isSafeToDeleteBuildDirectory('/home/user/project/build/', '/home/user/project', ['/home/user/project'], posix);
        expect(posixResult.safe).to.be.true;
        expect(posixResult.resolvedBinaryDir).to.equal('/home/user/project/build');
    });

    test('does not treat a path with a shared string prefix as an ancestor', () => {
        const result = isSafeToDeleteBuildDirectory('C:\\src\\proj', 'C:\\src\\project', [], win32);
        expect(result.safe).to.be.true;

        const posixResult = isSafeToDeleteBuildDirectory('/home/user/build', '/home/user/build-src', [], posix);
        expect(posixResult.safe).to.be.true;
    });

    test('refuses filesystem roots, including drive roots and UNC share roots', () => {
        for (const root of ['C:\\', 'C:\\\\', 'c:/', '\\\\server\\share', '\\\\server\\share\\']) {
            const result = isSafeToDeleteBuildDirectory(root, 'C:\\src\\project', [], win32);
            expect(result.safe, `expected ${root} to be refused`).to.be.false;
            expect(result.reason, `expected ${root} to be refused as a filesystem root`).to.equal(BuildDirectoryRefusalReason.FilesystemRoot);
        }

        const posixResult = isSafeToDeleteBuildDirectory('/', '/home/user/project', [], posix);
        expect(posixResult.safe).to.be.false;
        expect(posixResult.reason).to.equal(BuildDirectoryRefusalReason.FilesystemRoot);
    });

    test('refuses empty, relative and unvalidatable build directories', () => {
        expect(isSafeToDeleteBuildDirectory('', 'C:\\src\\project', [], win32).reason).to.equal(BuildDirectoryRefusalReason.EmptyPath);
        expect(isSafeToDeleteBuildDirectory('   ', 'C:\\src\\project', [], win32).reason).to.equal(BuildDirectoryRefusalReason.EmptyPath);
        expect(isSafeToDeleteBuildDirectory('build', 'C:\\src\\project', [], win32).reason).to.equal(BuildDirectoryRefusalReason.NotAbsolute);
        expect(isSafeToDeleteBuildDirectory('C:', 'C:\\src\\project', [], win32).reason).to.equal(BuildDirectoryRefusalReason.NotAbsolute);
        expect(isSafeToDeleteBuildDirectory('${workspaceFolder}/build', 'C:\\src\\project', [], win32).reason).to.equal(BuildDirectoryRefusalReason.NotAbsolute);
        expect(isSafeToDeleteBuildDirectory('C:\\src\\project\\build', '', [], win32).reason).to.equal(BuildDirectoryRefusalReason.UnknownSourceDirectory);
    });

    test('uses the platform path implementation by default', () => {
        const sourceDir = process.platform === 'win32' ? 'C:\\src\\project' : '/home/user/project';
        expect(isSafeToDeleteBuildDirectory(sourceDir, sourceDir, []).safe).to.be.false;
        expect(isSafeToDeleteBuildDirectory(path.join(sourceDir, 'build'), sourceDir, []).safe).to.be.true;
    });
});

suite('Clean configure in-progress flag', () => {
    test('clears the in-progress flag when the deletion succeeds', async () => {
        let inProgress = false;
        const observed: boolean[] = [];
        await withInProgressFlag(value => inProgress = value, async () => {
            observed.push(inProgress);
        });
        expect(observed).to.deep.equal([true]);
        expect(inProgress).to.be.false;
    });

    test('clears the in-progress flag when the deletion throws', async () => {
        let inProgress = false;
        let thrown: Error | undefined;
        try {
            await withInProgressFlag(value => inProgress = value, async () => {
                expect(inProgress).to.be.true;
                throw new Error('EPERM: build directory is locked');
            });
        } catch (e) {
            thrown = e as Error;
        }
        expect(thrown).to.be.instanceOf(Error);
        expect(thrown?.message).to.contain('EPERM');
        expect(inProgress, 'the in-progress flag must be reset after a failed deletion').to.be.false;
    });
});

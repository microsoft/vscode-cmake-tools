import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BuildDirectoryRefusalReason, isSafeToDeleteBuildDirectory, isSafeToDeleteBuildDirectoryResolved, RealpathFunction, withInProgressFlag } from '@cmt/drivers/buildDirectoryGuard';

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

suite('Build directory deletion guard resolved against the filesystem', () => {
    function fakeRealpath(map: Record<string, string>): RealpathFunction {
        return (candidate: string) => {
            if (candidate in map) {
                return map[candidate];
            }
            return candidate;
        };
    }

    test('refuses a build directory that is the source directory under a Windows 8.3 short name', async () => {
        const shortName = 'C:\\Users\\HANNIA~1\\.copilot';
        const longName = 'C:\\Users\\hanniavalera\\.copilot';
        const options = { realpath: fakeRealpath({ [shortName]: longName }), pathApi: win32 };

        expect(isSafeToDeleteBuildDirectory(shortName, longName, [], win32).safe, 'the lexical check alone cannot see through 8.3 names').to.be.true;

        const result = await isSafeToDeleteBuildDirectoryResolved(shortName, longName, [longName], options);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);
    });

    test('refuses a build directory reached through a junction or symbolic link', async () => {
        const junctioned = 'Q:\\repos\\cmt-integ\\node_modules\\isexe';
        const real = 'Q:\\repos\\vscode-cmake-tools\\node_modules\\isexe';
        const options = { realpath: fakeRealpath({ [junctioned]: real }), pathApi: win32 };

        const sameDirectory = await isSafeToDeleteBuildDirectoryResolved(junctioned, real, [], options);
        expect(sameDirectory.safe).to.be.false;
        expect(sameDirectory.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);

        const ancestor = await isSafeToDeleteBuildDirectoryResolved(junctioned, `${real}\\sub\\project`, [], options);
        expect(ancestor.safe).to.be.false;
        expect(ancestor.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectoryAncestor);
    });

    test('refuses a build directory whose trailing whitespace makes it the parent of the source directory', async () => {
        const binaryDir = '/tmp/source ';
        const sourceDir = '/tmp/source /child';
        const options = { realpath: fakeRealpath({}), pathApi: posix };

        const result = await isSafeToDeleteBuildDirectoryResolved(binaryDir, sourceDir, [], options);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectoryAncestor);
        expect(result.resolvedBinaryDir, 'the validated path must be the path that would be deleted').to.equal('/tmp/source ');

        // The pure guard must not trim either, otherwise it validates a different directory.
        expect(isSafeToDeleteBuildDirectory(binaryDir, sourceDir, [], posix).safe).to.be.false;
    });

    test('refuses a case-only difference on case insensitive volumes (macOS)', async () => {
        const binaryDir = '/Users/x/Proj';
        const sourceDir = '/Users/x/proj';
        const options = { realpath: fakeRealpath({ [binaryDir]: sourceDir }), pathApi: posix };

        const result = await isSafeToDeleteBuildDirectoryResolved(binaryDir, sourceDir, [], options);
        expect(result.safe).to.be.false;
        expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);
    });

    test('refuses extended-length and device roots', async () => {
        for (const root of ['\\\\?\\C:\\', '\\\\?\\c:', '\\\\?\\UNC\\server\\share', '\\\\?\\UNC\\server\\share\\', '\\\\.\\C:\\']) {
            const result = await isSafeToDeleteBuildDirectoryResolved(root, 'C:\\src\\project', [], { realpath: fakeRealpath({}), pathApi: win32 });
            expect(result.safe, `expected ${root} to be refused`).to.be.false;
            expect(result.reason, `expected ${root} to be refused as a filesystem root`).to.equal(BuildDirectoryRefusalReason.FilesystemRoot);
        }
    });

    test('compares extended-length paths against their ordinary spelling', async () => {
        const options = { realpath: fakeRealpath({}), pathApi: win32 };

        const sourceDirectory = await isSafeToDeleteBuildDirectoryResolved('\\\\?\\C:\\src\\project', 'C:\\src\\project', [], options);
        expect(sourceDirectory.safe).to.be.false;
        expect(sourceDirectory.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);

        const buildDirectory = await isSafeToDeleteBuildDirectoryResolved('\\\\?\\C:\\src\\project\\build', 'C:\\src\\project', [], options);
        expect(buildDirectory.safe).to.be.true;
    });

    test('still allows a normal out-of-source build directory', async () => {
        const options = { realpath: fakeRealpath({}), pathApi: win32 };
        const result = await isSafeToDeleteBuildDirectoryResolved('C:\\src\\project\\build', 'C:\\src\\project', ['C:\\src\\project'], options);
        expect(result.safe).to.be.true;
        expect(result.reason).to.be.undefined;
    });

    test('falls back to the lexical check when realpath fails', async () => {
        const failing: RealpathFunction = () => {
            const error: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
            error.code = 'ENOENT';
            throw error;
        };
        const refused = await isSafeToDeleteBuildDirectoryResolved('C:\\src\\project', 'C:\\src\\project', [], { realpath: failing, pathApi: win32 });
        expect(refused.safe).to.be.false;
        expect(refused.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);

        const allowed = await isSafeToDeleteBuildDirectoryResolved('C:\\src\\project\\build', 'C:\\src\\project', [], { realpath: failing, pathApi: win32 });
        expect(allowed.safe).to.be.true;
    });

    test('refuses a real on-disk link that points at the source directory', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-guard-'));
        const real = path.join(root, 'real-source');
        const link = path.join(root, 'link-to-source');
        try {
            fs.mkdirSync(real);
            fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
        } catch {
            // Creating links can require privileges we do not have; the fake-realpath tests
            // above already cover the behavior.
            fs.rmSync(root, { recursive: true, force: true });
            return;
        }
        try {
            const result = await isSafeToDeleteBuildDirectoryResolved(link, real, [], { realpath: candidate => fs.realpathSync.native(candidate) });
            expect(result.safe).to.be.false;
            expect(result.reason).to.equal(BuildDirectoryRefusalReason.SourceDirectory);

            const sibling = path.join(root, 'build');
            fs.mkdirSync(sibling);
            const allowed = await isSafeToDeleteBuildDirectoryResolved(sibling, real, [], { realpath: candidate => fs.realpathSync.native(candidate) });
            expect(allowed.safe).to.be.true;
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
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

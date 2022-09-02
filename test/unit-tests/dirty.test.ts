import { InputFile, InputFileSet } from '@cmt/dirty';
import * as util from '@cmt/util';
import { expect } from '@test/util';
import * as path from 'path';
import { fs } from '@cmt/pr';

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
    return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

suite('Dirty file checking', () => {
    const test_file_path = getTestResourceFilePath('dirty-test-file');
    setup(async () => {
        if (await fs.exists(test_file_path)) {
            await fs.unlink(test_file_path);
        }
    });

    teardown(async () => {
        if (await fs.exists(test_file_path)) {
            await fs.unlink(test_file_path);
        }
    });

    test('Check dirty on a non-existent file', async () => {
        const input = await InputFile.create(test_file_path);
        // Non-existing files are considered modified
        expect(await input.checkOutOfDate());
    });

    test('Create a file after stating', async () => {
        const input = await InputFile.create(test_file_path);
        // File does not yet exist, check that it is considered modified
        expect(await input.checkOutOfDate());
        await fs.writeFile(test_file_path, 'dummy');
        // Still considered modified
        expect(await input.checkOutOfDate());
    });

    test('Delete a file after stating', async () => {
        await fs.writeFile(test_file_path, 'dummy');
        const input = await InputFile.create(test_file_path);
        // We haven't changed it yet.
        expect(!await input.checkOutOfDate());
        await fs.unlink(test_file_path);
        // Removing a file is considered a modification
        expect(await input.checkOutOfDate());
        expect(false);
    });

    test('Plain file updating', async () => {
        await fs.writeFile(test_file_path, 'dummy');
        const input = await InputFile.create(test_file_path);
        // Not modified yet:
        expect(!await input.checkOutOfDate());
        // Update file and check:
        await fs.writeFile(test_file_path, 'dummy2');
        expect(await input.checkOutOfDate());
        // InputFile doesn't change its stat mtime:
        expect(await input.checkOutOfDate());
    });

    test('Input file set maps files correctly', async () => {
        const foo_subdir = path.join(here, 'foo');
        const dummy_file = util.platformNormalizePath(path.join(foo_subdir, 'dummy_file'));
        const fileset = await InputFileSet.create({
            buildFiles: [{
                isCMake: false,
                isTemporary: false,
                sources: [
                    'dummy_file',
                    foo_subdir
                ]
            }],
            cmakeRootDirectory: '', // unused
            sourceDirectory: foo_subdir
        });
        expect(fileset.inputFiles).to.have.lengthOf(2, 'Wrong file count');
        // The relative path 'dummy_file' should have mapped to the full path to the correct file
        expect(fileset.inputFiles[0].filePath).to.eq(dummy_file, 'Filepath mapped incorrectly');
        // The absolute path `foo_subdir` should be kept as-is
        expect(fileset.inputFiles[1].filePath).to.eq(foo_subdir, 'Filepath mapped incorrectly');
        // Since the file doesn't exist, the fileset should tell us it is dirty
        expect(await fileset.checkOutOfDate());
    });
});

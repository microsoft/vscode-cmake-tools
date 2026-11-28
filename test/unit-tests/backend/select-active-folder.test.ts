import { expect } from 'chai';
import * as path from 'path';
import { findProjectByFolder } from '@cmt/util';

/**
 * Tests for findProjectByFolder() from src/util.ts, which resolves the argument
 * of `cmake.selectActiveFolder`.
 *
 * Folder names are not unique: two workspace folders, or two source directories,
 * can both be called `armgcc`. The folder path tells them apart (issue #3538).
 */

function projectStub(folderPath: string) {
    return { folderName: path.basename(folderPath), folderPath };
}

const root = process.platform === 'win32' ? 'C:\\ws' : '/ws';

suite('findProjectByFolder', () => {
    test('selects a project by path when another project has the same folder name', () => {
        const first = projectStub(path.join(root, 'projectC', 'armgcc'));
        const second = projectStub(path.join(root, 'projectD', 'armgcc'));

        expect(findProjectByFolder([first, second], second.folderPath)).to.equal(second);
    });

    test('still selects a project by folder name', () => {
        const first = projectStub(path.join(root, 'app'));
        const second = projectStub(path.join(root, 'lib'));

        expect(findProjectByFolder([first, second], 'lib')).to.equal(second);
    });

    test('selects the first project when several have the same folder name', () => {
        const first = projectStub(path.join(root, 'projectC', 'armgcc'));
        const second = projectStub(path.join(root, 'projectD', 'armgcc'));

        expect(findProjectByFolder([first, second], 'armgcc')).to.equal(first);
    });

    test('matches a path that differs only by normalization', () => {
        const first = projectStub(path.join(root, 'projectC', 'armgcc'));
        const second = projectStub(path.join(root, 'projectD', 'armgcc') + path.sep);

        expect(findProjectByFolder([first, second], path.join(root, 'projectD', 'armgcc', 'sub') + path.sep + '..')).to.equal(second);
    });

    test('compares the path case-insensitively only on Windows', () => {
        const project = projectStub(path.join(root, 'projectD', 'armgcc'));

        expect(findProjectByFolder([project], path.join(root, 'PROJECTD', 'armgcc'))).to.equal(process.platform === 'win32' ? project : undefined);
    });

    test('returns undefined when no project matches', () => {
        const project = projectStub(path.join(root, 'app'));

        expect(findProjectByFolder([project], path.join(root, 'other'))).to.be.undefined;
    });
});

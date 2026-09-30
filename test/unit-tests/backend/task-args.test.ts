import { expect } from 'chai';
import { mergeBuildArgs } from '@cmt/taskArgs';

/**
 * Tests for mergeBuildArgs() from src/taskArgs.ts.
 *
 * This composes the additional `args` a user sets on a `cmake` build task into
 * the generated `cmake --build` argument list (issue #2554). Extra args must be
 * inserted before the `--` build-tool-args separator so flags like `-j` reach
 * CMake rather than the underlying build tool.
 */

suite('Task args merge', () => {
    test('inserts extra args before the -- build-tool-args separator', () => {
        const args = ['--build', 'build', '--config', 'Debug', '--target', 'all', '--', '-v'];
        expect(mergeBuildArgs(args, ['-j', '8'])).to.deep.equal(
            ['--build', 'build', '--config', 'Debug', '--target', 'all', '-j', '8', '--', '-v']
        );
    });

    test('appends extra args when there is no -- separator', () => {
        const args = ['--build', 'build', '--target', 'all'];
        expect(mergeBuildArgs(args, ['--clean-first'])).to.deep.equal(
            ['--build', 'build', '--target', 'all', '--clean-first']
        );
    });

    test('returns the original args when extra args is empty', () => {
        const args = ['--build', 'build', '--', '-v'];
        expect(mergeBuildArgs(args, [])).to.deep.equal(args);
    });

    test('inserts before the first -- when multiple are present', () => {
        const args = ['--build', 'build', '--', '-v', '--'];
        expect(mergeBuildArgs(args, ['-j'])).to.deep.equal(
            ['--build', 'build', '-j', '--', '-v', '--']
        );
    });
});

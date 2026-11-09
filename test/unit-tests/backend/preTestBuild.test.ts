import { expect } from 'chai';
import { shouldBuildBeforeTestOperation } from '@cmt/preTestBuild';

suite('Build before test operations', () => {
    test('running tests builds first when cmake.buildBeforeRun is on', () => {
        expect(shouldBuildBeforeTestOperation('ctest', true)).to.equal(true);
    });

    test('running tests skips the build when cmake.buildBeforeRun is off', () => {
        expect(shouldBuildBeforeTestOperation('ctest', false)).to.equal(false);
    });

    test('packaging always builds first', () => {
        expect(shouldBuildBeforeTestOperation('cpack', true)).to.equal(true);
        expect(shouldBuildBeforeTestOperation('cpack', false)).to.equal(true);
    });

    test('refreshing the test list always builds first', () => {
        expect(shouldBuildBeforeTestOperation('refreshTests', true)).to.equal(true);
        expect(shouldBuildBeforeTestOperation('refreshTests', false)).to.equal(true);
    });
});

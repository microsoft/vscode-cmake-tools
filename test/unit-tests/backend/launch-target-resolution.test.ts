import { expect } from 'chai';
import { isLaunchConfigLike, launchTargetCacheKey } from '@cmt/launchTargetResolution';

suite('Launch target resolution coalescing', () => {
    suite('isLaunchConfigLike', () => {
        test('true for a launch configuration object (has string type and request)', () => {
            expect(isLaunchConfigLike({ type: 'cppdbg', request: 'launch', name: 'Debug' })).to.equal(true);
            expect(isLaunchConfigLike({ type: 'cortex-debug', request: 'launch' })).to.equal(true);
        });

        test('false for undefined / null / primitives', () => {
            expect(isLaunchConfigLike(undefined)).to.equal(false);
            expect(isLaunchConfigLike(null)).to.equal(false);
            expect(isLaunchConfigLike('C:\\src')).to.equal(false);
            expect(isLaunchConfigLike(42)).to.equal(false);
        });

        test('false for a workspace-folder-like or {folder,targetName} programmatic argument', () => {
            expect(isLaunchConfigLike({ uri: {}, name: 'root', index: 0 })).to.equal(false);
            expect(isLaunchConfigLike({ folder: undefined, targetName: 'app' })).to.equal(false);
        });

        test('false when type or request is missing or not a string', () => {
            expect(isLaunchConfigLike({ type: 'cppdbg' })).to.equal(false);
            expect(isLaunchConfigLike({ request: 'launch' })).to.equal(false);
            expect(isLaunchConfigLike({ type: 1, request: 'launch' })).to.equal(false);
        });
    });

    suite('launchTargetCacheKey', () => {
        test('the active launch target and a named target never collide', () => {
            const activeKey = launchTargetCacheKey(undefined);
            expect(launchTargetCacheKey('app')).to.not.equal(activeKey);
            // A target literally named like the active sentinel is still distinct.
            expect(launchTargetCacheKey('active-launch-target')).to.not.equal(activeKey);
        });

        test('the same target name maps to the same key', () => {
            expect(launchTargetCacheKey('app')).to.equal(launchTargetCacheKey('app'));
        });

        test('different target names map to different keys', () => {
            expect(launchTargetCacheKey('app')).to.not.equal(launchTargetCacheKey('lib'));
        });
    });
});

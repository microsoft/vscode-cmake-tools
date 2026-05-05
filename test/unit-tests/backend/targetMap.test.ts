import { expect } from 'chai';

/** Simplified Target type mirroring @cmt/drivers/cmakeDriver for standalone testing */
interface RichTarget {
    type: 'rich';
    name: string;
    filepath: string;
    targetType: string;
}

type Target = RichTarget;

/**
 * Helper function that mimics the target resolution logic from CMakeFileApiDriver.get targets().
 * This tests the fallback behavior when currentBuildType doesn't match any key in the target map.
 */
function resolveTargets(targetMap: Map<string, Target[]>, currentBuildType: string): Target[] {
    let targets = targetMap.get(currentBuildType);
    // Fallback for single-config generators where config name may not match
    if (!targets && targetMap.size === 1) {
        targets = targetMap.values().next().value;
    }
    return targets || [];
}

function makeTarget(name: string): RichTarget {
    return {
        type: 'rich',
        name,
        filepath: `/path/to/${name}`,
        targetType: 'EXECUTABLE'
    };
}

suite('[TargetMap Resolution]', () => {

    test('Exact match returns targets', () => {
        const map = new Map<string, Target[]>();
        const targets = [makeTarget('app')];
        map.set('Debug', targets);

        const result = resolveTargets(map, 'Debug');
        expect(result).to.have.lengthOf(1);
        expect(result[0].name).to.equal('app');
    });

    test('Mismatched build type with single config falls back to available targets', () => {
        const map = new Map<string, Target[]>();
        const targets = [makeTarget('app')];
        // CMake File API returns empty string when CMAKE_BUILD_TYPE is not set
        map.set('', targets);

        // currentBuildType defaults to 'Debug' when preset doesn't specify CMAKE_BUILD_TYPE
        const result = resolveTargets(map, 'Debug');
        expect(result).to.have.lengthOf(1);
        expect(result[0].name).to.equal('app');
    });

    test('Mismatched build type with multiple configs returns empty', () => {
        const map = new Map<string, Target[]>();
        map.set('Release', [makeTarget('app_release')]);
        map.set('Debug', [makeTarget('app_debug')]);

        // If there are multiple configs, we should not fall back
        const result = resolveTargets(map, 'RelWithDebInfo');
        expect(result).to.have.lengthOf(0);
    });

    test('Empty target map returns empty', () => {
        const map = new Map<string, Target[]>();
        const result = resolveTargets(map, 'Debug');
        expect(result).to.have.lengthOf(0);
    });

    test('Single config with changed CMAKE_BUILD_TYPE falls back correctly', () => {
        const map = new Map<string, Target[]>();
        // User changed CMAKE_BUILD_TYPE to Release in CMakeLists.txt
        // but preset had RelWithDebInfo
        const targets = [makeTarget('app'), makeTarget('lib')];
        map.set('Release', targets);

        const result = resolveTargets(map, 'RelWithDebInfo');
        expect(result).to.have.lengthOf(2);
        expect(result[0].name).to.equal('app');
        expect(result[1].name).to.equal('lib');
    });

    test('Exact match is preferred over fallback for single config', () => {
        const map = new Map<string, Target[]>();
        const targets = [makeTarget('app')];
        map.set('Debug', targets);

        // If there's an exact match, it should be used
        const result = resolveTargets(map, 'Debug');
        expect(result).to.have.lengthOf(1);
        expect(result[0].name).to.equal('app');
    });
});

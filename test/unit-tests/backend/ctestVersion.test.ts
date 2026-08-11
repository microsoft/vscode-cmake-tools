import { expect } from 'chai';

import { getCTestDiscoveryArgument, parseCTestVersion } from '@cmt/ctestVersion';

suite('[CTest version]', () => {
    test('uses safe legacy discovery for an overridden old CTest', () => {
        const overriddenCTestOutput = 'ctest version 3.6.2\r\n';

        expect(parseCTestVersion(overriddenCTestOutput)).to.deep.equal({ major: 3, minor: 6, patch: 2 });
        expect(getCTestDiscoveryArgument(overriddenCTestOutput)).to.equal('-N');
    });

    test('keeps JSON discovery for modern CTest', () => {
        expect(getCTestDiscoveryArgument('ctest version 3.31.6\n')).to.equal('--show-only=json-v1');
    });

    test('uses safe legacy discovery when the CTest version is unknown', () => {
        expect(getCTestDiscoveryArgument(undefined)).to.equal('-N');
        expect(getCTestDiscoveryArgument('unexpected version output')).to.equal('-N');
    });
});

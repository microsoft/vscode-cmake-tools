import { expect } from 'chai';
import { matchesVsInstance, VsInstanceCandidate } from '@cmt/presets/vsInstanceSelection';

const vs2019: VsInstanceCandidate = {
    installationVersion: '16.11.35102.94',
    availableToolsets: ['14.29.30133'],
    hasVcVars: true
};
const vs2022: VsInstanceCandidate = {
    installationVersion: '17.14.37614.0',
    availableToolsets: ['14.44.35207', '14.29.30133'],
    hasVcVars: true
};
const vs2026: VsInstanceCandidate = {
    installationVersion: '18.0.10000.0',
    availableToolsets: ['14.50.10000', '14.29.30133'],
    hasVcVars: true
};

suite('vsInstanceVersion and toolset selection', () => {
    test('pins VS2019 when every installation provides the toolset, preserving unpinned selection', () => {
        const installs = [vs2026, vs2022, vs2019];

        expect(installs.find(vs => matchesVsInstance(vs, {}))).to.equal(vs2026);
        expect(installs.find(vs => matchesVsInstance(vs, { toolsetVersion: '14.29' }))).to.equal(vs2026);
        expect(installs.find(vs => matchesVsInstance(vs, { vsGeneratorVersion: 16 }))).to.equal(vs2019);
        expect(installs.find(vs => matchesVsInstance(vs, {
            vendorVsVersion: 16,
            toolsetVersion: '14.29'
        }))).to.equal(vs2019);
    });

    test('pins VS2022 despite a newer installation, preserving vendor and toolset precedence over the generator', () => {
        const installs = [vs2026, vs2022, vs2019];

        expect(installs.find(vs => matchesVsInstance(vs, {
            vendorVsVersion: 17,
            vsGeneratorVersion: 16
        }))).to.equal(vs2022);
        expect(installs.find(vs => matchesVsInstance(vs, {
            toolsetVersion: '14.29',
            vsGeneratorVersion: 16
        }))).to.equal(vs2026);
        expect(installs.find(vs => matchesVsInstance(vs, {
            vendorVsVersion: 17,
            toolsetVersion: '14.29',
            vsGeneratorVersion: 16
        }))).to.equal(vs2022);
    });

    test('does not fall back when the pinned version lacks the requested toolset', () => {
        const pinned = { ...vs2019, availableToolsets: ['14.16.27023'] };
        const installs = [vs2026, vs2022, pinned];

        expect(installs.find(vs => matchesVsInstance(vs, { vendorVsVersion: 16 }))).to.equal(pinned);
        expect(installs.find(vs => matchesVsInstance(vs, { toolsetVersion: '14.29' }))).to.equal(vs2026);
        expect(installs.find(vs => matchesVsInstance(vs, {
            vendorVsVersion: 16,
            toolsetVersion: '14.29'
        }))).to.equal(undefined);
    });

    test('continues within the pinned version until both constraints match', () => {
        const newerPinned = { ...vs2019, installationVersion: '16.11.40000.0', availableToolsets: ['14.16.27023'] };
        const installs = [vs2026, vs2022, newerPinned, vs2019];

        expect(installs.find(vs => matchesVsInstance(vs, { vendorVsVersion: 16 }))).to.equal(newerPinned);
        expect(installs.find(vs => matchesVsInstance(vs, {
            vendorVsVersion: 16,
            toolsetVersion: '14.29.30133'
        }))).to.equal(vs2019);
    });

    test('rejects a pinned installation without vcvars even if other versions provide the toolset', () => {
        const installs = [vs2026, vs2022, { ...vs2019, hasVcVars: false }];

        expect(installs.find(vs => matchesVsInstance(vs, { vendorVsVersion: 16 }))).to.equal(undefined);
        expect(installs.find(vs => matchesVsInstance(vs, { toolsetVersion: '14.29' }))).to.equal(vs2026);
        expect(installs.find(vs => matchesVsInstance(vs, {
            vendorVsVersion: 16,
            toolsetVersion: '14.29'
        }))).to.equal(undefined);
    });

    for (const availableToolsets of [undefined, []]) {
        test(`does not fall back when the pinned toolset list is ${availableToolsets ? 'empty' : 'unavailable'}`, () => {
            const pinned = { ...vs2019, availableToolsets };
            const installs = [vs2026, vs2022, pinned];

            expect(installs.find(vs => matchesVsInstance(vs, { vendorVsVersion: 16 }))).to.equal(pinned);
            expect(installs.find(vs => matchesVsInstance(vs, {
                vendorVsVersion: 16,
                toolsetVersion: '14.29'
            }))).to.equal(undefined);
        });
    }

    test('does not fall back when the pinned version is not installed', () => {
        const installs = [vs2026, vs2022, vs2019];

        expect(installs.find(vs => matchesVsInstance(vs, { vendorVsVersion: 15 }))).to.equal(undefined);
        expect(installs.find(vs => matchesVsInstance(vs, {
            vendorVsVersion: 15,
            toolsetVersion: '14.29'
        }))).to.equal(undefined);
    });
});

import { expect } from 'chai';
import { shouldUsePinnedVsInstanceCMake, vsBundledCMakePath, PinnedVsInstanceCMakeContext } from '@cmt/vsInstanceCMake';

const baseCtx = (over: Partial<PinnedVsInstanceCMakeContext> = {}): PinnedVsInstanceCMakeContext => ({
    platform: 'win32',
    useCMakePresets: true,
    presetCMakeExecutable: undefined,
    rawCMakePath: 'cmake',
    vsInstallPath: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    ...over
});

suite('vsInstanceVersion CMake selection', () => {
    suite('vsBundledCMakePath', () => {
        test('derives the VS-bundled cmake.exe path under the install root', () => {
            const p = vsBundledCMakePath('C:\\VS\\2022\\Community');
            expect(p.replace(/\//g, '\\')).to.equal('C:\\VS\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe');
        });
    });

    suite('shouldUsePinnedVsInstanceCMake', () => {
        test('true when Windows + presets + VS pinned + no explicit cmake pin (default "cmake")', () => {
            expect(shouldUsePinnedVsInstanceCMake(baseCtx())).to.equal(true);
        });

        test('true when the cmake path setting is "auto"', () => {
            expect(shouldUsePinnedVsInstanceCMake(baseCtx({ rawCMakePath: 'auto' }))).to.equal(true);
        });

        test('false when no VS instance was pinned via vsInstanceVersion', () => {
            expect(shouldUsePinnedVsInstanceCMake(baseCtx({ vsInstallPath: undefined }))).to.equal(false);
        });

        test('false when the preset explicitly sets cmakeExecutable', () => {
            expect(shouldUsePinnedVsInstanceCMake(baseCtx({ presetCMakeExecutable: 'D:\\cmake\\cmake.exe' }))).to.equal(false);
        });

        test('false when the user set an explicit cmake.cmakePath', () => {
            expect(shouldUsePinnedVsInstanceCMake(baseCtx({ rawCMakePath: 'C:\\tools\\cmake\\bin\\cmake.exe' }))).to.equal(false);
        });

        test('false off Windows', () => {
            expect(shouldUsePinnedVsInstanceCMake(baseCtx({ platform: 'linux' }))).to.equal(false);
            expect(shouldUsePinnedVsInstanceCMake(baseCtx({ platform: 'darwin' }))).to.equal(false);
        });

        test('false in kits/variants mode', () => {
            expect(shouldUsePinnedVsInstanceCMake(baseCtx({ useCMakePresets: false }))).to.equal(false);
        });
    });
});

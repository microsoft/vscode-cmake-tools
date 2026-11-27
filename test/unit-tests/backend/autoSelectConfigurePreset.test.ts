import { expect } from 'chai';
import { type ConfigurePreset, getConfigurePresetToSelectOnInit, getOnlySelectableConfigurePreset } from '@cmt/presets/preset';

function configurePreset(name: string, extra: Partial<ConfigurePreset> = {}): ConfigurePreset {
    return { name, ...extra };
}

/**
 * Tests for getOnlySelectableConfigurePreset, which decides whether a configure
 * preset can be selected automatically because it is the only one the
 * "Select Configure Preset" quick pick would offer (#2711).
 */
suite('getOnlySelectableConfigurePreset', () => {
    function forHost(name: string, hostOS: 'Windows' | 'Linux' | 'macOS' | ('Windows' | 'Linux' | 'macOS')[]): ConfigurePreset {
        return configurePreset(name, { vendor: { 'microsoft.com/VisualStudioSettings/CMake/1.0': { hostOS } } });
    }

    test('returns the preset when it is the only one', () => {
        const presets = [configurePreset('default')];
        expect(getOnlySelectableConfigurePreset(presets, 'Linux')?.name).to.equal('default');
    });

    test('ignores hidden base presets', () => {
        const presets = [configurePreset('base', { hidden: true }), configurePreset('default', { inherits: 'base' })];
        expect(getOnlySelectableConfigurePreset(presets, 'Linux')?.name).to.equal('default');
    });

    test('returns undefined when more than one preset is selectable', () => {
        const presets = [configurePreset('debug'), configurePreset('release')];
        expect(getOnlySelectableConfigurePreset(presets, 'Linux')).to.equal(undefined);
    });

    test('returns undefined when there is no selectable preset', () => {
        expect(getOnlySelectableConfigurePreset([], 'Linux')).to.equal(undefined);
        expect(getOnlySelectableConfigurePreset([configurePreset('base', { hidden: true })], 'Linux')).to.equal(undefined);
    });

    test('ignores presets whose condition evaluates to false', () => {
        const presets = [configurePreset('disabled', { condition: false }), configurePreset('default')];
        expect(getOnlySelectableConfigurePreset(presets, 'Linux')?.name).to.equal('default');
    });

    test('ignores presets restricted to another host OS', () => {
        const presets = [forHost('windows', 'Windows'), forHost('unix', ['Linux', 'macOS'])];
        expect(getOnlySelectableConfigurePreset(presets, 'Linux')?.name).to.equal('unix');
        expect(getOnlySelectableConfigurePreset(presets, 'Windows')?.name).to.equal('windows');
    });

    test('ignores presets that inherit a false condition from a hidden base preset', () => {
        const presets = [
            configurePreset('base', { hidden: true, condition: false }),
            configurePreset('child', { inherits: 'base' }),
            configurePreset('other')
        ];
        expect(getOnlySelectableConfigurePreset(presets, 'Linux')?.name).to.equal('other');
    });

    test('ignores presets whose object condition is not met', () => {
        const presets = [
            configurePreset('never', { condition: { type: 'equals', lhs: 'a', rhs: 'b' } }),
            configurePreset('default')
        ];
        expect(getOnlySelectableConfigurePreset(presets, 'Linux')?.name).to.equal('default');
    });
});

suite('getConfigurePresetToSelectOnInit', () => {
    const autoSelect = { autoSelectSinglePreset: true, languageServerOnlyMode: false };

    test('restores a valid remembered preset even when another single preset could be auto-selected', () => {
        const presets = [configurePreset('debug'), configurePreset('release', { condition: false })];
        expect(getConfigurePresetToSelectOnInit('release', presets, 'Linux', autoSelect)).to.equal('release');
    });

    test('restores a valid remembered preset outside of project initialization and in language-server-only mode', () => {
        const presets = [configurePreset('debug'), configurePreset('release')];
        expect(getConfigurePresetToSelectOnInit('release', presets, 'Linux', { autoSelectSinglePreset: false, languageServerOnlyMode: false })).to.equal('release');
        expect(getConfigurePresetToSelectOnInit('release', presets, 'Linux', { autoSelectSinglePreset: true, languageServerOnlyMode: true })).to.equal('release');
    });

    test('does not select anything when the remembered preset is hidden or no longer exists', () => {
        const presets = [configurePreset('base', { hidden: true }), configurePreset('default', { inherits: 'base' })];
        expect(getConfigurePresetToSelectOnInit('base', presets, 'Linux', autoSelect)).to.equal(undefined);
        expect(getConfigurePresetToSelectOnInit('removed', presets, 'Linux', autoSelect)).to.equal(undefined);
    });

    test('selects the only selectable preset when nothing is remembered', () => {
        const presets = [configurePreset('base', { hidden: true }), configurePreset('default', { inherits: 'base' })];
        expect(getConfigurePresetToSelectOnInit(undefined, presets, 'Linux', autoSelect)).to.equal('default');
    });

    test('does not select anything when several or no presets are selectable', () => {
        expect(getConfigurePresetToSelectOnInit(undefined, [configurePreset('debug'), configurePreset('release')], 'Linux', autoSelect)).to.equal(undefined);
        expect(getConfigurePresetToSelectOnInit(undefined, [], 'Linux', autoSelect)).to.equal(undefined);
    });

    test('does not auto-select outside of project initialization', () => {
        const presets = [configurePreset('default')];
        expect(getConfigurePresetToSelectOnInit(undefined, presets, 'Linux', { autoSelectSinglePreset: false, languageServerOnlyMode: false })).to.equal(undefined);
    });

    test('does not auto-select in language-server-only mode', () => {
        const presets = [configurePreset('default')];
        expect(getConfigurePresetToSelectOnInit(undefined, presets, 'Linux', { autoSelectSinglePreset: true, languageServerOnlyMode: true })).to.equal(undefined);
    });

    test('does not auto-select and does not throw when a preset has an empty allOf condition', () => {
        const presets = [configurePreset('broken', { condition: { type: 'allOf', conditions: [] } }), configurePreset('default')];
        expect(getConfigurePresetToSelectOnInit(undefined, presets, 'Linux', autoSelect)).to.equal(undefined);
    });

    test('does not auto-select and does not throw when a preset condition has an invalid regex', () => {
        const presets = [configurePreset('broken', { condition: { type: 'matches', string: 'x', regex: '(' } }), configurePreset('default')];
        expect(getConfigurePresetToSelectOnInit(undefined, presets, 'Linux', autoSelect)).to.equal(undefined);
    });
});

import { expect } from 'chai';
import { hasExplicitBuildPresetTargets, presetTargetsReset, resolveDefaultBuildTargets, shouldOfferPresetTargetsReset } from '@cmt/buildTargetSelection';

// The localized label older versions persisted as the default build target.
const presetLabel = '[Targets In Preset]';

suite('Build target selection', () => {
    suite('presetTargetsReset', () => {
        test('is a unique symbol that cannot equal any target-name string', () => {
            expect(typeof presetTargetsReset).to.equal('symbol');
            expect((presetTargetsReset as unknown) === '__cmake_tools_targets_in_preset__').to.equal(false);
        });
    });

    suite('hasExplicitBuildPresetTargets', () => {
        test('is false when the preset declares no targets', () => {
            expect(hasExplicitBuildPresetTargets(undefined)).to.equal(false);
        });

        test('is false for an empty targets array or empty string', () => {
            expect(hasExplicitBuildPresetTargets([])).to.equal(false);
            expect(hasExplicitBuildPresetTargets('')).to.equal(false);
        });

        test('is true when the preset declares one or more targets', () => {
            expect(hasExplicitBuildPresetTargets('app')).to.equal(true);
            expect(hasExplicitBuildPresetTargets(['app'])).to.equal(true);
            expect(hasExplicitBuildPresetTargets(['app', 'lib'])).to.equal(true);
        });
    });

    suite('shouldOfferPresetTargetsReset', () => {
        test('never offers the reset in kits/variants mode', () => {
            expect(shouldOfferPresetTargetsReset(false, true, true)).to.equal(false);
            expect(shouldOfferPresetTargetsReset(false, false, true)).to.equal(false);
            expect(shouldOfferPresetTargetsReset(false, true, false)).to.equal(false);
        });

        test('default-target picker always offers the reset in presets mode (the #3587 regression)', () => {
            // Even when the build preset declares no explicit targets, the user must be able to
            // return to "[Targets In Preset]" after pinning a specific target.
            expect(shouldOfferPresetTargetsReset(true, true, false)).to.equal(true);
            expect(shouldOfferPresetTargetsReset(true, true, true)).to.equal(true);
        });

        test('one-shot build picker only offers the reset when the preset defines targets', () => {
            // Without explicit preset targets the reset would fall back to the pinned default, so the
            // one-shot picker (allowPresetReset = false) must not offer it.
            expect(shouldOfferPresetTargetsReset(true, false, true)).to.equal(true);
            expect(shouldOfferPresetTargetsReset(true, false, false)).to.equal(false);
        });
    });

    suite('resolveDefaultBuildTargets', () => {
        test('presets: a cleared default builds the preset-defined targets', () => {
            expect(resolveDefaultBuildTargets(true, null, presetLabel, ['app', 'lib'], '')).to.deep.equal(['app', 'lib']);
        });

        test('presets: a cleared default with no preset targets builds the default (undefined)', () => {
            expect(resolveDefaultBuildTargets(true, null, presetLabel, undefined, '')).to.equal(undefined);
        });

        test('presets: a cleared default with an empty preset targets array builds the default', () => {
            expect(resolveDefaultBuildTargets(true, null, presetLabel, [], '')).to.deep.equal([]);
        });

        test('presets: a pinned concrete target is honored', () => {
            expect(resolveDefaultBuildTargets(true, 'lib', presetLabel, ['app', 'lib'], '')).to.deep.equal(['lib']);
        });

        test('presets: a legacy persisted "[Targets In Preset]" label maps to the preset targets', () => {
            expect(resolveDefaultBuildTargets(true, presetLabel, presetLabel, ['app'], '')).to.deep.equal(['app']);
        });

        test('presets: a single-string preset target is normalized to an array', () => {
            expect(resolveDefaultBuildTargets(true, null, presetLabel, 'app', '')).to.deep.equal(['app']);
        });

        test('kits: a cleared default builds the all target', () => {
            expect(resolveDefaultBuildTargets(false, null, presetLabel, undefined, 'all')).to.deep.equal(['all']);
            expect(resolveDefaultBuildTargets(false, null, presetLabel, undefined, 'ALL_BUILD')).to.deep.equal(['ALL_BUILD']);
        });

        test('kits: a pinned concrete target is honored', () => {
            expect(resolveDefaultBuildTargets(false, 'mylib', presetLabel, undefined, 'all')).to.deep.equal(['mylib']);
        });
    });
});

import { expect } from 'chai';
import { decideMissingCMakeListsAction, decideEnsurePresetOrKitAction } from '@cmt/startupPromptDecisions';

/**
 * Guards the fix for #5000 (CMake Tools showing unsolicited quick picks on workspace open, which
 * cancel the user's active quick pick / command palette because VS Code's quick input is a single
 * shared "last-caller-wins" widget).
 *
 * The core invariant enforced here: an *automatic* on-open path must NEVER resolve to a quick pick
 * ('quickpick*') — it defers to a non-modal notification — while explicit user gestures keep their
 * existing direct quick-pick behavior. These are pure functions, so they import directly via
 * `@cmt/*` with no VS Code mock required.
 */
suite('[startupPromptDecisions] #5000 no unsolicited startup quick picks', () => {
    suite('decideMissingCMakeListsAction', () => {
        test('automatic on-open defers to a notification when configureOnOpen is on', () => {
            expect(decideMissingCMakeListsAction(true, false, true)).to.equal('notification');
        });

        test('automatic on-open does nothing when configureOnOpen is off', () => {
            // No unsolicited UI at all when the user opted out of configure-on-open.
            expect(decideMissingCMakeListsAction(true, false, false)).to.equal('none');
        });

        test('automatic path never opens a quick pick regardless of inputs', () => {
            for (const isConfiguring of [true, false]) {
                for (const configureOnOpen of [true, false]) {
                    expect(decideMissingCMakeListsAction(true, isConfiguring, configureOnOpen)).to.not.equal('quickpick');
                }
            }
        });

        test('explicit configure keeps the direct quick pick', () => {
            expect(decideMissingCMakeListsAction(false, true, false)).to.equal('quickpick');
            expect(decideMissingCMakeListsAction(false, true, true)).to.equal('quickpick');
        });

        test('user gesture with configureOnOpen on keeps the direct quick pick', () => {
            expect(decideMissingCMakeListsAction(false, false, true)).to.equal('quickpick');
        });

        test('user gesture, not configuring, configureOnOpen off does nothing', () => {
            expect(decideMissingCMakeListsAction(false, false, false)).to.equal('none');
        });
    });

    suite('decideEnsurePresetOrKitAction', () => {
        // Presets mode
        test('presets mode with a preset already selected is ok', () => {
            expect(decideEnsurePresetOrKitAction(true, true, true, true, true)).to.equal('ok');
            expect(decideEnsurePresetOrKitAction(false, true, true, true, true)).to.equal('ok');
        });

        test('presets mode, no preset, automatic -> notification (not quick pick)', () => {
            expect(decideEnsurePresetOrKitAction(true, true, false, true, true)).to.equal('notificationConfigurePreset');
        });

        test('presets mode, no preset, user gesture -> quick pick', () => {
            expect(decideEnsurePresetOrKitAction(false, true, false, true, true)).to.equal('quickpickConfigurePreset');
        });

        // Kits mode
        test('kits mode with an active kit is ok', () => {
            expect(decideEnsurePresetOrKitAction(true, false, true, true, true)).to.equal('ok');
        });

        test('kits mode, no kit, automatic -> notification (not quick pick)', () => {
            expect(decideEnsurePresetOrKitAction(true, false, false, true, true)).to.equal('notificationKit');
        });

        test('kits mode, no kit, user gesture -> quick pick', () => {
            expect(decideEnsurePresetOrKitAction(false, false, false, true, true)).to.equal('quickpickKit');
        });

        test('kits mode silently adopts Unspecified when automatic kit scan is off', () => {
            // Even automatic here is a silent set (no prompt, no notification), preserving old behavior.
            expect(decideEnsurePresetOrKitAction(true, false, false, false, true)).to.equal('setUnspecified');
            expect(decideEnsurePresetOrKitAction(false, false, false, false, true)).to.equal('setUnspecified');
        });

        test('kits mode silently adopts Unspecified when there is no CMakeLists.txt', () => {
            expect(decideEnsurePresetOrKitAction(true, false, false, true, false)).to.equal('setUnspecified');
            expect(decideEnsurePresetOrKitAction(false, false, false, true, false)).to.equal('setUnspecified');
        });

        test('automatic path never opens a quick pick across the full input matrix', () => {
            for (const useCMakePresets of [true, false]) {
                for (const hasSelection of [true, false]) {
                    for (const enableAutomaticKitScan of [true, false]) {
                        for (const hasCMakeLists of [true, false]) {
                            const action = decideEnsurePresetOrKitAction(true, useCMakePresets, hasSelection, enableAutomaticKitScan, hasCMakeLists);
                            expect(action, JSON.stringify({ useCMakePresets, hasSelection, enableAutomaticKitScan, hasCMakeLists })).to.not.match(/^quickpick/);
                        }
                    }
                }
            }
        });
    });
});

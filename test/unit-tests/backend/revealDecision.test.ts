import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the "minimize interruptions" behavior: automatic/programmatic CMake operations
 * (configure-on-open, automatic reconfigure, and builds/tests invoked through the CMake
 * Tools API by e.g. Copilot via the C/C++ DevTools companion) must not proactively reveal
 * the build output (Output channel or the colorized "CMake Build" terminal) and steal the
 * panel from a terminal the user is using - unless `cmake.revealLogOnAutomaticTrigger` is set.
 * Explicit user operations keep their `cmake.revealLog` behavior, and failures always surface.
 *
 * `src/logging.ts` and `src/cmakeProject.ts` transitively import `vscode`, so per the
 * backend-test convention (see `expand.test.ts`, `shell-propagation.test.ts`) the pure
 * decision logic is mirrored inline here. Keep these mirrors in sync with `decideReveal`
 * (src/logging.ts) and `isAutomaticConfigureTrigger` (src/cmakeProject.ts).
 */

type RevealLogKey = 'always' | 'never' | 'focus' | 'error';

// Mirror of `decideReveal` in src/logging.ts.
// Mirror of `decideReveal` in src/logging.ts (returns { shouldShow, preserveFocus }, matching
// the cmake.revealLogOnAutomaticTrigger gate shared with the #4988 work).
function decideReveal(revealLog: RevealLogKey, errorToShow: boolean | undefined, isAutomatic: boolean, revealOnAutomatic: boolean): { shouldShow: boolean; preserveFocus: boolean } {
    const isFailureReveal = errorToShow === true;
    if (isAutomatic && !isFailureReveal && !revealOnAutomatic) {
        return { shouldShow: false, preserveFocus: true };
    }
    let shouldShow = false;
    if (revealLog === 'always') {
        shouldShow = true;
    }
    if (revealLog === 'error' && errorToShow !== undefined) {
        shouldShow = errorToShow;
    }
    const shouldFocus = (revealLog === 'focus');
    if (shouldFocus) {
        shouldShow = true;
    }
    return { shouldShow, preserveFocus: !shouldFocus };
}

// Mirror of the colorization-only `revealLogDecision` wrapper: maps decideReveal's
// { shouldShow, preserveFocus } to the { show, focus } shape the colorized terminal reveal uses.
function revealLogDecision(revealLog: RevealLogKey, errorToShow: boolean | undefined, isAutomatic: boolean, revealOnAutomatic: boolean): { show: boolean; focus: boolean } {
    const d = decideReveal(revealLog, errorToShow, isAutomatic, revealOnAutomatic);
    return { show: d.shouldShow, focus: !d.preserveFocus };
}

// Mirror of `isAutomaticConfigureTrigger` in src/cmakeProject.ts (ConfigureTrigger values).
function isAutomaticConfigureTrigger(trigger: string): boolean {
    switch (trigger) {
        case 'configureOnOpen':
        case 'configureWithCache':
        case 'cmakeListsChange':
        case 'sourceDirectoryChange':
        case 'compilation':
        case 'api':
        case 'taskProvider':
        case 'workflow':
        case 'runTests':
        case 'package':
        case 'badHomeDir':
            return true;
        default:
            return false;
    }
}

function findExtensionDir(): string {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
            const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            if (json?.contributes?.languages?.some((l: { id?: string }) => l.id === 'cmake')) {
                return dir;
            }
        }
        dir = path.dirname(dir);
    }
    throw new Error('CMake Tools package.json (with a `cmake` language contribution) was not found');
}

suite('[revealDecision] #4988 minimize interruptions on automatic triggers', () => {
    suite('manifest', () => {
        let manifest: any;
        let nls: any;
        suiteSetup(() => {
            const dir = findExtensionDir();
            manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
            nls = JSON.parse(fs.readFileSync(path.join(dir, 'package.nls.json'), 'utf8'));
        });

        test('declares cmake.revealLogOnAutomaticTrigger as a window-scoped boolean defaulting to false', () => {
            const prop = manifest.contributes.configuration.properties['cmake.revealLogOnAutomaticTrigger'];
            expect(prop, 'cmake.revealLogOnAutomaticTrigger property').to.be.an('object');
            expect(prop.type, 'type').to.equal('boolean');
            expect(prop.default, 'default').to.equal(false);
            expect(prop.scope, 'scope').to.equal('window');
            expect(prop.markdownDescription, 'markdownDescription').to.equal('%cmake-tools.configuration.cmake.revealLogOnAutomaticTrigger.markdownDescription%');
        });

        test('the NLS markdownDescription key exists', () => {
            expect(nls['cmake-tools.configuration.cmake.revealLogOnAutomaticTrigger.markdownDescription'], 'nls key').to.be.a('string').and.not.empty;
        });
    });

    suite('decideReveal', () => {
        test('user-initiated operations keep legacy revealLog behavior', () => {
            expect(decideReveal('always', undefined, false, false)).to.deep.equal({ shouldShow: true, preserveFocus: true });
            expect(decideReveal('focus', undefined, false, false)).to.deep.equal({ shouldShow: true, preserveFocus: false });
            expect(decideReveal('never', undefined, false, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
            expect(decideReveal('error', undefined, false, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });

        test('automatic operations are suppressed by default (the fix)', () => {
            expect(decideReveal('always', undefined, true, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
            // Even when the user chose `focus`, an automatic op must not steal focus.
            expect(decideReveal('focus', undefined, true, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });

        test('automatic operations reveal when the user opts in', () => {
            expect(decideReveal('always', undefined, true, true)).to.deep.equal({ shouldShow: true, preserveFocus: true });
            expect(decideReveal('focus', undefined, true, true)).to.deep.equal({ shouldShow: true, preserveFocus: false });
        });

        test('failures always surface, even for automatic operations and even when opted out', () => {
            expect(decideReveal('always', true, true, false)).to.deep.equal({ shouldShow: true, preserveFocus: true });
            expect(decideReveal('error', true, true, false)).to.deep.equal({ shouldShow: true, preserveFocus: true });
            expect(decideReveal('focus', true, true, false)).to.deep.equal({ shouldShow: true, preserveFocus: false });
        });

        test('successful automatic results are not revealed under error mode', () => {
            expect(decideReveal('error', false, true, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });

        test('never suppresses everything, including failures (subordinate to revealLog as today)', () => {
            expect(decideReveal('never', true, false, true)).to.deep.equal({ shouldShow: false, preserveFocus: true });
            expect(decideReveal('never', true, true, true)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });
    });

    suite('revealLogDecision (colorized terminal mapping)', () => {
        test('maps shouldShow -> show and preserveFocus -> !focus', () => {
            // always/user: shown, focus preserved (no focus steal)
            expect(revealLogDecision('always', undefined, false, false)).to.deep.equal({ show: true, focus: false });
            // focus/user: shown and takes focus
            expect(revealLogDecision('focus', undefined, false, false)).to.deep.equal({ show: true, focus: true });
            // automatic suppressed by default
            expect(revealLogDecision('always', undefined, true, false)).to.deep.equal({ show: false, focus: false });
            // failure always shows
            expect(revealLogDecision('always', true, true, false)).to.deep.equal({ show: true, focus: false });
        });
    });

    suite('isAutomaticConfigureTrigger', () => {
        const automatic = ['configureOnOpen', 'configureWithCache', 'cmakeListsChange', 'sourceDirectoryChange', 'compilation', 'api', 'taskProvider', 'workflow', 'runTests', 'package', 'badHomeDir'];
        const userInitiated = ['commandConfigure', 'commandCleanConfigure', 'commandConfigureWithDebugger', 'selectKit', 'selectConfigurePreset', 'quickStart', 'launch', 'setVariant', 'buttonNewKitsDefinition', 'commandEditCacheUI', 'commandEditCache'];

        test('automatic/programmatic triggers are classified automatic', () => {
            for (const t of automatic) {
                expect(isAutomaticConfigureTrigger(t), t).to.equal(true);
            }
        });

        test('explicit user triggers are classified user-initiated', () => {
            for (const t of userInitiated) {
                expect(isAutomaticConfigureTrigger(t), t).to.equal(false);
            }
        });
    });
});

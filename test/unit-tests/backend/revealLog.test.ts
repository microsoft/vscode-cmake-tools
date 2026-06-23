import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the fix for #4988 (the CMake output channel stealing the panel away from the
 * terminal during automatic configures and programmatic/Copilot builds).
 *
 * The fix adds the `cmake.revealLogOnAutomaticTrigger` setting and threads a "trigger
 * origin" flag so that:
 *   - automatic/programmatic operations (configure-on-open, automatic reconfigure, and
 *     builds/tests invoked through the CMake Tools API) only proactively reveal the output
 *     channel when `cmake.revealLogOnAutomaticTrigger` is `true`;
 *   - explicit user-initiated operations keep their existing `cmake.revealLog` behavior;
 *   - failures always surface, regardless of the new setting.
 *
 * `src/logging.ts` and `src/cmakeProject.ts` both transitively import `vscode`, so per the
 * backend-test convention (see `expand.test.ts`, `shell-propagation.test.ts`) the pure
 * decision logic is mirrored inline here. Keep these mirrors in sync with
 * `decideReveal` (src/logging.ts) and `isAutomaticConfigureTrigger` (src/cmakeProject.ts).
 */

type RevealLogKey = 'always' | 'never' | 'focus' | 'error';

// Mirror of `decideReveal` in src/logging.ts.
function decideReveal(revealLog: RevealLogKey, errorToShow: boolean | undefined, isAutomatic: boolean, revealOnAutomatic: boolean): { shouldShow: boolean; preserveFocus: boolean } {
    const isFailureReveal = errorToShow === true;
    if (isAutomatic && !isFailureReveal && !revealOnAutomatic) {
        return { shouldShow: false, preserveFocus: true };
    }

    let shouldShow: boolean = false;
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

function findExtensionManifest(): { contributes: any } {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
            const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            if (json?.contributes?.languages?.some((l: { id?: string }) => l.id === 'cmake')) {
                return json;
            }
        }
        dir = path.dirname(dir);
    }
    throw new Error('CMake Tools package.json (with a `cmake` language contribution) was not found');
}

suite('[revealLog] #4988 output channel focus on automatic triggers', () => {
    suite('manifest', () => {
        let manifest: any;
        let nls: any;
        suiteSetup(() => {
            manifest = findExtensionManifest();
            // package.nls.json sits next to package.json.
            let dir = __dirname;
            while (dir !== path.dirname(dir)) {
                const p = path.join(dir, 'package.json');
                if (fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8'))?.contributes?.languages?.some((l: { id?: string }) => l.id === 'cmake')) {
                    nls = JSON.parse(fs.readFileSync(path.join(dir, 'package.nls.json'), 'utf8'));
                    break;
                }
                dir = path.dirname(dir);
            }
        });

        test('declares cmake.revealLogOnAutomaticTrigger as a window-scoped boolean defaulting to false', () => {
            const prop = manifest.contributes.configuration.properties['cmake.revealLogOnAutomaticTrigger'];
            expect(prop, 'cmake.revealLogOnAutomaticTrigger property').to.be.an('object');
            expect(prop.type, 'type').to.equal('boolean');
            // Default false => automatic/programmatic operations do NOT steal the panel.
            expect(prop.default, 'default').to.equal(false);
            // Window scope: this is global UI/output behavior, not project-specific config.
            expect(prop.scope, 'scope').to.equal('window');
            expect(prop.markdownDescription, 'markdownDescription').to.equal('%cmake-tools.configuration.cmake.revealLogOnAutomaticTrigger.markdownDescription%');
        });

        test('the NLS markdownDescription key exists', () => {
            expect(nls['cmake-tools.configuration.cmake.revealLogOnAutomaticTrigger.markdownDescription'], 'nls key').to.be.a('string').and.not.empty;
        });
    });

    suite('decideReveal', () => {
        test('user-initiated builds keep legacy revealLog behavior', () => {
            // always -> reveal, preserve keyboard focus
            expect(decideReveal('always', undefined, false, false)).to.deep.equal({ shouldShow: true, preserveFocus: true });
            // focus -> reveal AND take focus
            expect(decideReveal('focus', undefined, false, false)).to.deep.equal({ shouldShow: true, preserveFocus: false });
            // never -> nothing
            expect(decideReveal('never', undefined, false, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
            // error with no result -> nothing
            expect(decideReveal('error', undefined, false, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });

        test('automatic operations are suppressed by default (the fix)', () => {
            expect(decideReveal('always', undefined, true, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
            // Even when the user chose `focus`, an automatic op must not steal keyboard focus.
            expect(decideReveal('focus', undefined, true, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });

        test('automatic operations reveal when the user opts in', () => {
            expect(decideReveal('always', undefined, true, true)).to.deep.equal({ shouldShow: true, preserveFocus: true });
        });

        test('failures always surface, even for automatic operations and even when opted out', () => {
            expect(decideReveal('always', true, true, false)).to.deep.equal({ shouldShow: true, preserveFocus: true });
            expect(decideReveal('error', true, true, false)).to.deep.equal({ shouldShow: true, preserveFocus: true });
            expect(decideReveal('focus', true, true, false)).to.deep.equal({ shouldShow: true, preserveFocus: false });
        });

        test('successful automatic results are not revealed even under error mode', () => {
            // errorToShow === false (a successful result) is not a failure reveal, so the gate applies.
            expect(decideReveal('error', false, true, false)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });

        test('never always wins for user-initiated ops', () => {
            expect(decideReveal('never', true, false, true)).to.deep.equal({ shouldShow: false, preserveFocus: true });
        });
    });

    suite('isAutomaticConfigureTrigger', () => {
        const automatic = ['configureOnOpen', 'configureWithCache', 'cmakeListsChange', 'sourceDirectoryChange', 'compilation', 'api', 'taskProvider', 'workflow', 'runTests', 'package', 'badHomeDir'];
        const userInitiated = ['commandConfigure', 'commandCleanConfigure', 'commandConfigureWithDebugger', 'selectKit', 'selectConfigurePreset', 'quickStart', 'launch', 'setVariant', 'commandEditCacheUI'];

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

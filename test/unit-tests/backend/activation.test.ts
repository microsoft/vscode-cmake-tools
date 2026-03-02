import { expect } from 'chai';
import { shouldShowInitializingView, isDefinitivelyAbsentError } from '@cmt/activation';

/**
 * Unit tests for the pure activation-visibility policy that decides whether the
 * transient "initializing" placeholder view is shown in the CMake activity bar.
 *
 * `src/activation.ts` has no `vscode` dependency, so it is imported directly here
 * and runs under `yarn backendTests`.
 */
suite('[activation] initializing placeholder visibility policy', () => {
    test('shows the placeholder when a CMake project exists and not in language-server-only mode', () => {
        expect(shouldShowInitializingView(true, false)).to.equal(true);
    });

    test('does not show the placeholder when there is no CMake project', () => {
        expect(shouldShowInitializingView(false, false)).to.equal(false);
    });

    test('does not show the placeholder in language-server-only mode even with a CMake project', () => {
        expect(shouldShowInitializingView(true, true)).to.equal(false);
    });

    test('does not show the placeholder when there is no project and in language-server-only mode', () => {
        expect(shouldShowInitializingView(false, true)).to.equal(false);
    });
});

/**
 * The activation preflight (`workspaceHasCMakeProjectForInitialization`) probes for a
 * project's `CMakeLists.txt`. It must fail OPEN on transient filesystem errors so the
 * placeholder still appears in the resource-starved environments (e.g. EMFILE
 * file-handle exhaustion) this reveal targets — treating those as "no project" would
 * re-hide the sidebar in exactly the scenario the fix is meant to help.
 */
suite('[activation] preflight filesystem-error classification', () => {
    test('ENOENT means the file is definitively absent', () => {
        expect(isDefinitivelyAbsentError('ENOENT')).to.equal(true);
    });

    test('ENOTDIR means the file is definitively absent', () => {
        expect(isDefinitivelyAbsentError('ENOTDIR')).to.equal(true);
    });

    test('EMFILE (handle exhaustion) is transient and must NOT be treated as absent (fail open)', () => {
        expect(isDefinitivelyAbsentError('EMFILE')).to.equal(false);
    });

    test('ENFILE (system-wide handle exhaustion) is transient and must NOT be treated as absent', () => {
        expect(isDefinitivelyAbsentError('ENFILE')).to.equal(false);
    });

    test('EACCES (permission) is transient and must NOT be treated as absent', () => {
        expect(isDefinitivelyAbsentError('EACCES')).to.equal(false);
    });

    test('an unknown/undefined error code is treated as transient (fail open)', () => {
        expect(isDefinitivelyAbsentError(undefined)).to.equal(false);
        expect(isDefinitivelyAbsentError('EBUSY')).to.equal(false);
    });
});

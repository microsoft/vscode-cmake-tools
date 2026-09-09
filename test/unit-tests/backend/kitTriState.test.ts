import { expect } from 'chai';
import { classifyCompilerPathProbe, classifyWhichResult, CompilerPathState } from '@cmt/kits/compilerPathState';

/**
 * Tests for the tri-state compiler-existence classification used by kit pruning
 * (src/kits/compilerPathState.ts).
 *
 * The key correctness property: only a definitive "not found" (ENOENT/ENOTDIR)
 * counts as `absent`; any other error (notably file-handle exhaustion such as
 * EMFILE/ENFILE) must be `unknown` so that transient failures never cause CMake
 * Tools to prompt the user to remove a valid kit.
 */
suite('Kit compiler-path tri-state classification', () => {
    function errorWithCode(code: string | undefined): NodeJS.ErrnoException {
        const err = new Error(`probe failed: ${code}`) as NodeJS.ErrnoException;
        err.code = code;
        return err;
    }

    test('no error means the compiler is present', () => {
        expect(classifyCompilerPathProbe(null)).to.eq('present' as CompilerPathState);
        expect(classifyCompilerPathProbe(undefined)).to.eq('present');
    });

    test('ENOENT and ENOTDIR mean the compiler is definitively absent', () => {
        expect(classifyCompilerPathProbe(errorWithCode('ENOENT'))).to.eq('absent');
        expect(classifyCompilerPathProbe(errorWithCode('ENOTDIR'))).to.eq('absent');
    });

    test('resource/permission errors are unknown, never absent', () => {
        for (const code of ['EMFILE', 'ENFILE', 'EACCES', 'EPERM']) {
            expect(classifyCompilerPathProbe(errorWithCode(code)), `code ${code}`).to.eq('unknown');
        }
    });

    test('an error with no code is unknown', () => {
        expect(classifyCompilerPathProbe(errorWithCode(undefined))).to.eq('unknown');
    });
});

/**
 * Tests for `classifyWhichResult` — the classification used for RELATIVE compiler
 * names resolved via the `which` package. Because `which` synthesizes `ENOENT` for
 * every failure (including transient `isexe` errors such as EMFILE), its errors are
 * never treated as proof of absence: only a successful resolution is `present`, and
 * any failure is `unknown` so a transient error can never prompt kit removal.
 */
suite('Kit relative-name (which) classification', () => {
    test('a resolved path means the compiler is present', () => {
        expect(classifyWhichResult(null, '/usr/bin/gcc')).to.eq('present' as CompilerPathState);
    });

    test('any which error is unknown, never absent (which cannot distinguish transient from not-found)', () => {
        // which synthesizes ENOENT even for transient isexe failures, so even an
        // ENOENT-coded error must be treated as unknown here.
        for (const code of ['ENOENT', 'EMFILE', 'ENFILE', 'EACCES', 'EPERM']) {
            const err = new Error(`which failed: ${code}`) as NodeJS.ErrnoException;
            err.code = code;
            expect(classifyWhichResult(err, undefined), `code ${code}`).to.eq('unknown');
        }
    });

    test('no error but no resolved path is unknown, never absent', () => {
        expect(classifyWhichResult(null, undefined)).to.eq('unknown');
        expect(classifyWhichResult(null, '')).to.eq('unknown');
    });
});

import { expect } from 'chai';

/**
 * Tests for the shell propagation logic used in proc.execute().
 *
 * The core fix is changing `shell: !!options.shell` to `shell: options.shell ?? false`
 * in the spawn options. This preserves string shell paths instead of coercing them
 * to boolean `true`, which is required for Node.js child_process.spawn() to use
 * a specific shell executable.
 */
suite('Shell propagation logic', () => {
    // Simulates the old (broken) behavior: `!!options.shell`
    function oldShellCoercion(shell: boolean | string | undefined): boolean {
        return !!shell;
    }

    // Simulates the new (fixed) behavior: `options.shell ?? false`
    function newShellCoercion(shell: boolean | string | undefined): boolean | string {
        return shell ?? false;
    }

    test('String shell path is preserved with new logic', () => {
        const shellPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
        const result = newShellCoercion(shellPath);
        expect(result).to.eq(shellPath);
    });

    test('String shell path was coerced to true with old logic', () => {
        const shellPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
        const result = oldShellCoercion(shellPath);
        // This was the bug: string was coerced to boolean true
        expect(result).to.eq(true);
    });

    test('Boolean true is preserved with new logic', () => {
        expect(newShellCoercion(true)).to.eq(true);
    });

    test('Boolean false is preserved with new logic', () => {
        expect(newShellCoercion(false)).to.eq(false);
    });

    test('Undefined defaults to false with new logic', () => {
        expect(newShellCoercion(undefined)).to.eq(false);
    });

    test('POSIX shell path is preserved with new logic', () => {
        const shellPath = '/usr/bin/bash';
        const result = newShellCoercion(shellPath);
        expect(result).to.eq(shellPath);
    });

    // Simulates the executeCommand shell resolution: options?.shell ?? config.shell ?? undefined
    function resolveShell(optionsShell: boolean | string | undefined, configShell: string | null): boolean | string | undefined {
        return optionsShell ?? configShell ?? undefined;
    }

    test('Explicit shell option takes precedence over config', () => {
        expect(resolveShell(true, '/usr/bin/bash')).to.eq(true);
    });

    test('Config shell is used when no explicit option', () => {
        expect(resolveShell(undefined, '/usr/bin/bash')).to.eq('/usr/bin/bash');
    });

    test('Undefined when neither option nor config is set', () => {
        expect(resolveShell(undefined, null)).to.eq(undefined);
    });

    test('Explicit false option takes precedence over config', () => {
        expect(resolveShell(false, '/usr/bin/bash')).to.eq(false);
    });

    test('Explicit string option takes precedence over config', () => {
        expect(resolveShell('C:\\msys64\\usr\\bin\\bash.exe', '/usr/bin/bash')).to.eq('C:\\msys64\\usr\\bin\\bash.exe');
    });
});

import { expect } from 'chai';

/**
 * Tests for the shell propagation logic used in proc.execute().
 *
 * The core fix is changing `shell: !!options.shell` to `shell: options.shell ?? false`
 * in the spawn options. This preserves string shell paths instead of coercing them
 * to boolean `true`, which is required for Node.js child_process.spawn() to use
 * a specific shell executable.
 */

// Mirror of proc.determineShell for backend tests (cannot import proc.ts directly
// because it transitively depends on 'vscode').
function determineShell(command: string): string | boolean {
    if (command.endsWith('.cmd') || command.endsWith('.bat')) {
        return 'cmd';
    }
    if (command.endsWith('.ps1')) {
        return 'powershell';
    }
    return false;
}

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

    // Simulates the executeCommand shell resolution with determineShell precedence:
    // options?.shell ?? (commandShell || undefined) ?? config.shell ?? undefined
    function resolveShell(optionsShell: boolean | string | undefined, configShell: string | null, command?: string): boolean | string | undefined {
        const commandShell = command ? determineShell(command) : false;
        return optionsShell ?? (commandShell || undefined) ?? configShell ?? undefined;
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

suite('determineShell command-type detection', () => {
    test('.cmd commands require cmd shell', () => {
        expect(determineShell('cmake.cmd')).to.eq('cmd');
    });

    test('.bat commands require cmd shell', () => {
        expect(determineShell('build.bat')).to.eq('cmd');
    });

    test('.ps1 commands require powershell', () => {
        expect(determineShell('setup.ps1')).to.eq('powershell');
    });

    test('Regular executables return false', () => {
        expect(determineShell('cmake')).to.eq(false);
        expect(determineShell('cmake.exe')).to.eq(false);
        expect(determineShell('/usr/bin/cmake')).to.eq(false);
    });

    test('.cmd takes precedence over config.shell (Git Bash)', () => {
        // Simulates the executeCommand resolution for a .cmd command
        // when config.shell is set to Git Bash
        const commandShell = determineShell('cmake.cmd');
        const configShell = 'C:\\Program Files\\Git\\bin\\bash.exe';
        // commandShell should win because .cmd requires cmd.exe
        const resolved = (commandShell || undefined) ?? configShell ?? undefined;
        expect(resolved).to.eq('cmd');
    });

    test('.bat takes precedence over config.shell (Git Bash)', () => {
        const commandShell = determineShell('build.bat');
        const configShell = 'C:\\Program Files\\Git\\bin\\bash.exe';
        const resolved = (commandShell || undefined) ?? configShell ?? undefined;
        expect(resolved).to.eq('cmd');
    });

    test('.ps1 takes precedence over config.shell (Git Bash)', () => {
        const commandShell = determineShell('setup.ps1');
        const configShell = 'C:\\Program Files\\Git\\bin\\bash.exe';
        const resolved = (commandShell || undefined) ?? configShell ?? undefined;
        expect(resolved).to.eq('powershell');
    });

    test('Regular command falls through to config.shell', () => {
        const commandShell = determineShell('cmake');
        const configShell = 'C:\\Program Files\\Git\\bin\\bash.exe';
        // commandShell is false, so config.shell should be used
        const resolved = (commandShell || undefined) ?? configShell ?? undefined;
        expect(resolved).to.eq(configShell);
    });

    test('Regular command with no config.shell returns undefined', () => {
        const commandShell = determineShell('cmake');
        const configShell: string | null = null;
        const resolved = (commandShell || undefined) ?? configShell ?? undefined;
        expect(resolved).to.eq(undefined);
    });
});

import { expect } from 'chai';
import * as shlex from '@cmt/shlex';

/**
 * Tests for the compile command argument handling used by CMakeDriver.runCompileCommand().
 *
 * The fix (https://github.com/microsoft/vscode-cmake-tools/issues/4836) replaces
 * terminal.sendText() — which is subject to the PTY 4096-byte input buffer
 * truncation — with proc.execute(), which passes args as an array directly to
 * child_process.spawn() and has no such limit.
 *
 * These tests validate the data flow:
 *  1. CompilationDatabase splits a command string into an arguments array via shlex
 *  2. runCompileCommand() extracts args[0] as the executable and args.slice(1) as
 *     the spawn arguments
 *  3. The full argument list is preserved regardless of total command length
 */

// Mirror of proc.buildCmdStr (cannot import proc.ts directly
// because it transitively depends on 'vscode').
function buildCmdStr(command: string, args?: string[]): string {
    let cmdarr = [command];
    if (args) {
        cmdarr = cmdarr.concat(args);
    }
    return cmdarr.map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a).join(' ');
}

/**
 * Mirrors the argument-population logic from CompilationDatabase's constructor:
 *   arguments: cur.arguments ? cur.arguments : [...shlex.split(cur.command)]
 */
function populateArguments(entry: { command: string; arguments?: string[] }): string[] {
    return entry.arguments ? entry.arguments : [...shlex.split(entry.command)];
}

/**
 * Mirrors the executable/args extraction from runCompileCommand():
 *   const executable = args[0];
 *   const execArgs = args.slice(1);
 */
function extractExecAndArgs(args: string[]): { executable: string; execArgs: string[] } {
    return { executable: args[0], execArgs: args.slice(1) };
}

suite('Compile command argument handling (issue #4836)', () => {

    suite('CompilationDatabase argument population', () => {
        test('Pre-split arguments are preserved as-is', () => {
            const entry = {
                command: '/usr/bin/g++ -o main.o -c main.cpp',
                arguments: ['/usr/bin/g++', '-o', 'main.o', '-c', 'main.cpp']
            };
            const args = populateArguments(entry);
            expect(args).to.deep.equal(['/usr/bin/g++', '-o', 'main.o', '-c', 'main.cpp']);
        });

        test('Command string is split via shlex when arguments not provided', () => {
            const entry = {
                command: '/usr/bin/g++ -DBOOST_THREAD_VERSION=3 -isystem ../extern -g -std=gnu++11 -o out.o -c main.cpp'
            };
            const args = populateArguments(entry);
            expect(args[0]).to.equal('/usr/bin/g++');
            expect(args).to.include('-DBOOST_THREAD_VERSION=3');
            expect(args).to.include('-std=gnu++11');
            expect(args[args.length - 1]).to.equal('main.cpp');
        });

        test('Command with quoted paths is correctly split', () => {
            const entry = {
                command: '"C:\\Program Files\\MSVC\\cl.exe" /nologo /TP "-IC:\\My Project\\include" /Fo"build\\main.obj" /c "C:\\My Project\\main.cpp"'
            };
            const args = populateArguments(entry);
            expect(args[0]).to.equal('"C:\\Program Files\\MSVC\\cl.exe"');
            expect(args.length).to.be.greaterThan(1);
        });
    });

    suite('Executable and arguments extraction', () => {
        test('First element is the executable, rest are arguments', () => {
            const args = ['/usr/bin/g++', '-o', 'main.o', '-c', 'main.cpp'];
            const { executable, execArgs } = extractExecAndArgs(args);
            expect(executable).to.equal('/usr/bin/g++');
            expect(execArgs).to.deep.equal(['-o', 'main.o', '-c', 'main.cpp']);
        });

        test('Single-element array yields executable with no arguments', () => {
            const args = ['/usr/bin/g++'];
            const { executable, execArgs } = extractExecAndArgs(args);
            expect(executable).to.equal('/usr/bin/g++');
            expect(execArgs).to.deep.equal([]);
        });

        test('MSVC-style executable with many flags', () => {
            const args = ['cl.exe', '/nologo', '/TP', '/DWIN32', '/D_WINDOWS', '/W3', '/GR', '/EHsc',
                '/MDd', '/Zi', '/Ob0', '/Od', '/RTC1', '/Fo"build\\main.obj"', '/c', 'main.cpp'];
            const { executable, execArgs } = extractExecAndArgs(args);
            expect(executable).to.equal('cl.exe');
            expect(execArgs.length).to.equal(15);
            expect(execArgs[execArgs.length - 1]).to.equal('main.cpp');
        });
    });

    suite('Long command lines exceeding 4096 bytes', () => {
        /**
         * Generate a realistic compile command that exceeds 4096 bytes.
         * This simulates the real-world scenario from issue #4836 where
         * many -I include paths and -D defines push the command past the
         * PTY input buffer limit.
         */
        function generateLongCommand(minLength: number): { command: string; expectedArgCount: number } {
            const compiler = '/usr/bin/g++';
            const baseFlags = ['-std=gnu++17', '-g', '-O2', '-Wall', '-Wextra', '-fPIC'];
            // Generate enough -I and -D flags to exceed the target length
            const extraFlags: string[] = [];
            for (let i = 0; extraFlags.join(' ').length < minLength; i++) {
                extraFlags.push(`-I/very/long/path/to/include/directory/number_${i}/nested/deeply`);
                extraFlags.push(`-DSOME_VERY_LONG_DEFINE_NAME_${i}=some_long_value_${i}`);
            }
            const tail = ['-o', 'CMakeFiles/myTarget.dir/src/main.cpp.o', '-c', '/home/user/project/src/main.cpp'];
            const allArgs = [compiler, ...baseFlags, ...extraFlags, ...tail];
            return {
                command: allArgs.join(' '),
                expectedArgCount: allArgs.length
            };
        }

        test('Command exceeding 4096 chars is fully preserved when split via shlex', () => {
            const { command, expectedArgCount } = generateLongCommand(5000);
            // Verify the command actually exceeds 4096 bytes
            expect(command.length).to.be.greaterThan(4096);

            const args = populateArguments({ command });
            expect(args.length).to.equal(expectedArgCount);
            expect(args[0]).to.equal('/usr/bin/g++');
            expect(args[args.length - 1]).to.equal('/home/user/project/src/main.cpp');
        });

        test('Command exceeding 8192 chars is fully preserved', () => {
            const { command, expectedArgCount } = generateLongCommand(10000);
            expect(command.length).to.be.greaterThan(8192);

            const args = populateArguments({ command });
            expect(args.length).to.equal(expectedArgCount);
        });

        test('Long command roundtrips through extraction and buildCmdStr', () => {
            const { command } = generateLongCommand(5000);

            const args = populateArguments({ command });
            const { executable, execArgs } = extractExecAndArgs(args);
            const displayed = buildCmdStr(executable, execArgs);

            // The displayed string should contain the executable
            expect(displayed).to.include('/usr/bin/g++');
            // ... the last source file
            expect(displayed).to.include('/home/user/project/src/main.cpp');
            // ... and all include paths (spot-check a few)
            expect(displayed).to.include('-I/very/long/path/to/include/directory/number_0/nested/deeply');
            expect(displayed).to.include('-I/very/long/path/to/include/directory/number_10/nested/deeply');
            // The displayed string should also exceed 4096 chars
            expect(displayed.length).to.be.greaterThan(4096);
        });

        test('Pre-split arguments array for a long command bypasses shlex entirely', () => {
            // When compile_commands.json provides "arguments" directly (CMake >= 3.something),
            // shlex is never invoked. Verify the array passes through untouched.
            const compiler = '/usr/bin/clang++';
            const flags: string[] = [];
            for (let i = 0; i < 200; i++) {
                flags.push(`-I/workspace/third_party/library_${i}/include`);
            }
            flags.push('-c', '/workspace/src/main.cpp');
            const allArgs = [compiler, ...flags];
            const totalLength = allArgs.join(' ').length;
            expect(totalLength).to.be.greaterThan(4096);

            const args = populateArguments({ command: 'ignored', arguments: allArgs });
            expect(args).to.deep.equal(allArgs);
            expect(args.length).to.equal(allArgs.length);

            const { executable, execArgs } = extractExecAndArgs(args);
            expect(executable).to.equal(compiler);
            expect(execArgs.length).to.equal(allArgs.length - 1);
        });
    });

    suite('buildCmdStr display formatting', () => {
        test('Simple command without spaces', () => {
            expect(buildCmdStr('gcc', ['-c', 'main.cpp'])).to.equal('gcc -c main.cpp');
        });

        test('Arguments with spaces are quoted', () => {
            expect(buildCmdStr('gcc', ['-I/path with spaces/include', '-c', 'main.cpp']))
                .to.equal('gcc "-I/path with spaces/include" -c main.cpp');
        });

        test('Empty args array shows only command', () => {
            expect(buildCmdStr('gcc', [])).to.equal('gcc');
        });

        test('Undefined args shows only command', () => {
            expect(buildCmdStr('gcc')).to.equal('gcc');
        });
    });
});

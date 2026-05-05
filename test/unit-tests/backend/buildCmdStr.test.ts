import { expect } from 'chai';

/**
 * Tests for the buildCmdStr() function from src/proc.ts.
 *
 * This function constructs a human-readable command string from a command and
 * its arguments, quoting any arguments that contain whitespace or special characters.
 * It is used for logging executed commands to the output panel.
 *
 * The function is mirrored here because proc.ts transitively depends on 'vscode',
 * which cannot be imported in backend tests.
 */

// --- Mirror of proc.buildCmdStr ---
function buildCmdStr(command: string, args?: string[]): string {
    let cmdarr = [command];
    if (args) {
        cmdarr = cmdarr.concat(args);
    }
    return cmdarr.map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a).join(' ');
}

suite('[buildCmdStr]', () => {

    test('Command with no arguments', () => {
        const result = buildCmdStr('cmake');
        expect(result).to.equal('cmake');
    });

    test('Command with simple arguments', () => {
        const result = buildCmdStr('cmake', ['--build', '.', '--target', 'all']);
        expect(result).to.equal('cmake --build . --target all');
    });

    test('Argument with spaces is quoted', () => {
        const result = buildCmdStr('cmake', ['-S', '/path with spaces/src']);
        expect(result).to.equal('cmake -S "/path with spaces/src"');
    });

    test('Command itself with spaces is quoted', () => {
        const result = buildCmdStr('/Program Files/CMake/bin/cmake', ['--version']);
        expect(result).to.equal('"/Program Files/CMake/bin/cmake" --version');
    });

    test('Argument with tab is quoted', () => {
        const result = buildCmdStr('cmake', ['-DVAR=value\twith\ttabs']);
        expect(result).to.equal('cmake "-DVAR=value\twith\ttabs"');
    });

    test('Argument with newline is quoted', () => {
        const result = buildCmdStr('cmake', ['-DVAR=line1\nline2']);
        expect(result).to.equal('cmake "-DVAR=line1\nline2"');
    });

    test('Argument with carriage return is quoted', () => {
        const result = buildCmdStr('cmake', ['-DVAR=line1\rline2']);
        expect(result).to.equal('cmake "-DVAR=line1\rline2"');
    });

    test('Argument with form feed is quoted', () => {
        const result = buildCmdStr('cmake', ['-DVAR=value\fmore']);
        expect(result).to.equal('cmake "-DVAR=value\fmore"');
    });

    test('Argument with semicolon is quoted', () => {
        const result = buildCmdStr('cmake', ['-DCMAKE_PREFIX_PATH=/a;/b;/c']);
        expect(result).to.equal('cmake "-DCMAKE_PREFIX_PATH=/a;/b;/c"');
    });

    test('Mixed quoted and unquoted arguments', () => {
        const result = buildCmdStr('cmake', ['--build', '/path with space', '--config', 'Release']);
        expect(result).to.equal('cmake --build "/path with space" --config Release');
    });

    test('Empty arguments list', () => {
        const result = buildCmdStr('cmake', []);
        expect(result).to.equal('cmake');
    });

    test('Undefined arguments', () => {
        const result = buildCmdStr('cmake', undefined);
        expect(result).to.equal('cmake');
    });

    test('Multiple CMake-style define arguments', () => {
        const result = buildCmdStr('cmake', [
            '-DCMAKE_BUILD_TYPE=Debug',
            '-DCMAKE_INSTALL_PREFIX=/usr/local',
            '-DBUILD_SHARED_LIBS=ON'
        ]);
        expect(result).to.equal('cmake -DCMAKE_BUILD_TYPE=Debug -DCMAKE_INSTALL_PREFIX=/usr/local -DBUILD_SHARED_LIBS=ON');
    });

    test('Windows path with backslashes is not quoted (no special chars)', () => {
        const result = buildCmdStr('C:\\CMake\\bin\\cmake.exe', ['--version']);
        expect(result).to.equal('C:\\CMake\\bin\\cmake.exe --version');
    });

    test('Argument that is just a space is quoted', () => {
        const result = buildCmdStr('echo', [' ']);
        expect(result).to.equal('echo " "');
    });

    test('Arguments preserving cmake --install pattern', () => {
        const result = buildCmdStr('cmake', ['--install', '/build/dir', '--config', 'Release', '--prefix', '/opt/install path']);
        expect(result).to.equal('cmake --install /build/dir --config Release --prefix "/opt/install path"');
    });
});

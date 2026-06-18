import { expect } from 'chai';
import { classifyBuildLine, colorizeBuildLine, BuildLineSeverity } from '@cmt/colorize';

/**
 * Tests for the pure build-output colorizer in src/colorize.ts.
 *
 * colorize.ts has no transitive dependency on 'vscode', so it is imported
 * directly via the @cmt alias (per the backend-test import strategy).
 */

const ESC = '\u001b';
const RESET = `${ESC}[0m`;

suite('[colorize] classifyBuildLine', () => {
    test('GCC/Clang error line', () => {
        expect(classifyBuildLine('/src/main.cpp:10:5: error: expected \';\'')).to.equal(BuildLineSeverity.Error);
    });
    test('GCC/Clang fatal error line', () => {
        expect(classifyBuildLine('/src/main.cpp:1:10: fatal error: foo.h: No such file or directory')).to.equal(BuildLineSeverity.Error);
    });
    test('MSVC error code line', () => {
        expect(classifyBuildLine('main.cpp(12): error C2065: \'x\': undeclared identifier')).to.equal(BuildLineSeverity.Error);
    });
    test('Linker error (LNK) line', () => {
        expect(classifyBuildLine('main.obj : error LNK2019: unresolved external symbol')).to.equal(BuildLineSeverity.Error);
    });
    test('Ninja FAILED line', () => {
        expect(classifyBuildLine('FAILED: CMakeFiles/app.dir/main.cpp.o')).to.equal(BuildLineSeverity.Error);
    });
    test('MSBuild MSB error code line', () => {
        expect(classifyBuildLine('Project.vcxproj : error MSB8066: Custom build exited with code 1')).to.equal(BuildLineSeverity.Error);
    });
    test('GNU make error summary line', () => {
        expect(classifyBuildLine('make: *** [Makefile:23: all] Error 2')).to.equal(BuildLineSeverity.Error);
    });
    test('GNU make[1] error summary line', () => {
        expect(classifyBuildLine('make[1]: *** [CMakeFiles/Makefile2:83: all] Error 2')).to.equal(BuildLineSeverity.Error);
    });
    test('GCC/Clang warning line', () => {
        expect(classifyBuildLine('/src/main.cpp:7:9: warning: unused variable \'y\'')).to.equal(BuildLineSeverity.Warning);
    });
    test('MSVC warning code line', () => {
        expect(classifyBuildLine('main.cpp(7): warning C4101: \'y\': unreferenced local variable')).to.equal(BuildLineSeverity.Warning);
    });
    test('GCC/Clang note line', () => {
        expect(classifyBuildLine('/src/main.cpp:9:3: note: in expansion of macro')).to.equal(BuildLineSeverity.Note);
    });
    test('Built target success line', () => {
        expect(classifyBuildLine('[100%] Built target app')).to.equal(BuildLineSeverity.Success);
    });
    test('Plain progress line is not classified', () => {
        expect(classifyBuildLine('[ 50%] Building CXX object CMakeFiles/app.dir/main.cpp.o')).to.equal(BuildLineSeverity.None);
    });
    test('Warning line is not misread as error', () => {
        // Contains the word "error" only as part of -Werror, must stay a warning.
        expect(classifyBuildLine('/src/a.cpp:3:1: warning: -Werror is enabled')).to.equal(BuildLineSeverity.Warning);
    });
});

suite('[colorize] colorizeBuildLine', () => {
    test('off mode returns the line unchanged', () => {
        const line = '/src/main.cpp:10:5: error: boom';
        expect(colorizeBuildLine(line, 'off')).to.equal(line);
    });
    test('severity mode wraps an error in bold red with a trailing reset', () => {
        const line = '/src/main.cpp:10:5: error: boom';
        const out = colorizeBuildLine(line, 'severity');
        expect(out).to.equal(`${ESC}[1;31m${line}${RESET}`);
    });
    test('severity mode wraps a warning in yellow', () => {
        const line = '/src/main.cpp:7:9: warning: meh';
        expect(colorizeBuildLine(line, 'severity')).to.equal(`${ESC}[33m${line}${RESET}`);
    });
    test('severity mode wraps a note in cyan', () => {
        const line = '/src/main.cpp:9:3: note: here';
        expect(colorizeBuildLine(line, 'severity')).to.equal(`${ESC}[36m${line}${RESET}`);
    });
    test('severity mode wraps a success line in green', () => {
        const line = '[100%] Built target app';
        expect(colorizeBuildLine(line, 'severity')).to.equal(`${ESC}[32m${line}${RESET}`);
    });
    test('unclassified line is returned unchanged in severity mode', () => {
        const line = '[ 50%] Building CXX object CMakeFiles/app.dir/main.cpp.o';
        expect(colorizeBuildLine(line, 'severity')).to.equal(line);
    });
    test('line that already contains ANSI is passed through unchanged', () => {
        const line = `${ESC}[31m/src/main.cpp:10:5: error: already colored${RESET}`;
        expect(colorizeBuildLine(line, 'severity')).to.equal(line);
    });
    test('every colorized line ends with a reset', () => {
        const line = 'main.obj : error LNK2019: unresolved external symbol';
        expect(colorizeBuildLine(line, 'severity').endsWith(RESET)).to.equal(true);
    });
});

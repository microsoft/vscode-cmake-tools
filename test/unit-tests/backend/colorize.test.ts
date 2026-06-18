import { expect } from 'chai';
import { classifyBuildLine, colorizeBuildLine, decorateBuildLine, isProgressNoise, renderBuildBanner, renderBuildSummary, BuildLineSeverity } from '@cmt/colorize';

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

suite('[colorize] decorateBuildLine (rich)', () => {
    test('off mode returns the line unchanged', () => {
        const line = '/src/main.cpp:10:5: error: boom';
        expect(decorateBuildLine(line, 'off', 'unicode')).to.equal(line);
    });
    test('severity mode is identical to colorizeBuildLine (no glyph)', () => {
        const line = '/src/main.cpp:10:5: error: boom';
        expect(decorateBuildLine(line, 'severity', 'unicode')).to.equal(colorizeBuildLine(line, 'severity'));
    });
    test('rich error: bold red + unicode glyph + trailing reset', () => {
        const line = '/src/main.cpp:10:5: error: boom';
        expect(decorateBuildLine(line, 'rich', 'unicode')).to.equal(`${ESC}[1;31m\u2717 ${line}${RESET}`);
    });
    test('rich warning: yellow + ascii glyph', () => {
        const line = '/src/main.cpp:7:9: warning: meh';
        expect(decorateBuildLine(line, 'rich', 'ascii')).to.equal(`${ESC}[33m! ${line}${RESET}`);
    });
    test('rich note: cyan + unicode glyph with text-presentation selector', () => {
        const line = '/src/main.cpp:9:3: note: here';
        expect(decorateBuildLine(line, 'rich', 'unicode')).to.equal(`${ESC}[36m\u2139\uFE0E ${line}${RESET}`);
    });
    test('rich success (Built target) is green with a glyph, not dimmed', () => {
        const line = '[100%] Built target app';
        expect(decorateBuildLine(line, 'rich', 'unicode')).to.equal(`${ESC}[32m\u2713 ${line}${RESET}`);
    });
    test('rich dims build-progress noise', () => {
        const line = '[ 50%] Building CXX object foo.o';
        expect(decorateBuildLine(line, 'rich', 'unicode')).to.equal(`${ESC}[2m${line}${RESET}`);
    });
    test('rich leaves plain non-progress lines unchanged', () => {
        const line = 'Scanning dependencies of target app';
        expect(decorateBuildLine(line, 'rich', 'unicode')).to.equal(line);
    });
    test('rich passes through lines already containing ANSI', () => {
        const line = `${ESC}[31malready colored${RESET}`;
        expect(decorateBuildLine(line, 'rich', 'unicode')).to.equal(line);
    });
});

suite('[colorize] isProgressNoise', () => {
    test('percent progress matches', () => {
        expect(isProgressNoise('[ 50%] Building CXX object')).to.equal(true);
    });
    test('ratio progress matches', () => {
        expect(isProgressNoise('[12/34] Linking')).to.equal(true);
    });
    test('a plain diagnostic line does not match', () => {
        expect(isProgressNoise('/src/x.cpp:1:1: error: x')).to.equal(false);
    });
});

suite('[colorize] renderBuildBanner', () => {
    test('bold, contains the (already-localized) header text, unicode rule, trailing reset', () => {
        const out = renderBuildBanner('Building: app', 'unicode');
        expect(out.startsWith(`${ESC}[1m`)).to.equal(true);
        expect(out).to.contain('Building: app');
        expect(out).to.contain('\u2500');
        expect(out.endsWith(RESET)).to.equal(true);
    });
    test('ascii style uses dashes', () => {
        expect(renderBuildBanner('Building: app', 'ascii')).to.contain('-------- Building: app --------');
    });
});

suite('[colorize] renderBuildSummary', () => {
    test('succeeded: green rule + success glyph + verbatim status text + trailing reset', () => {
        const [rule, status] = renderBuildSummary('succeeded', 'Build succeeded — 0 error(s), 0 warning(s)  (3.4s)', 'unicode');
        expect(rule.startsWith(`${ESC}[1;32m`)).to.equal(true);
        expect(status).to.contain('\u2713');
        expect(status).to.contain('Build succeeded — 0 error(s), 0 warning(s)  (3.4s)');
        expect(status.endsWith(RESET)).to.equal(true);
    });
    test('failed: red rule + error glyph (ascii)', () => {
        const [rule, status] = renderBuildSummary('failed', 'Build failed - 2 error(s), 1 warning(s)  (1.0s)', 'ascii');
        expect(rule.startsWith(`${ESC}[1;31m`)).to.equal(true);
        expect(status).to.contain('Build failed');
        expect(status.startsWith(`${ESC}[1;31mx `)).to.equal(true);
    });
    test('cancelled: yellow rule + warning glyph', () => {
        const [rule, status] = renderBuildSummary('cancelled', 'Build cancelled', 'unicode');
        expect(rule.startsWith(`${ESC}[1;33m`)).to.equal(true);
        expect(status).to.contain('\u26A0');
        expect(status).to.contain('Build cancelled');
    });
});

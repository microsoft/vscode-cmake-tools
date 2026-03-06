import { expect } from 'chai';
import { resolveTestVariables, TestInfo } from '@cmt/debugTestVars';

suite('resolveTestVariables', () => {
    const testInfo: TestInfo = {
        program: '/path/to/test_executable',
        args: ['--arg1', '--arg2', 'value'],
        workingDirectory: '/path/to/workdir'
    };

    test('resolves ${cmake.testProgram} in strings', () => {
        const config = { program: '${cmake.testProgram}' };
        const result = resolveTestVariables(config, testInfo);
        expect(result.program).to.equal('/path/to/test_executable');
    });

    test('resolves ${cmake.testWorkingDirectory} in strings', () => {
        const config = { cwd: '${cmake.testWorkingDirectory}' };
        const result = resolveTestVariables(config, testInfo);
        expect(result.cwd).to.equal('/path/to/workdir');
    });

    test('expands ${cmake.testArgs} in arrays', () => {
        const config = { args: ['${cmake.testArgs}'] };
        const result = resolveTestVariables(config, testInfo);
        expect(result.args).to.deep.equal(['--arg1', '--arg2', 'value']);
    });

    test('resolves multiple variables in the same config', () => {
        const config = {
            name: '(ctest) Launch',
            type: 'cppdbg',
            request: 'launch',
            program: '${cmake.testProgram}',
            args: ['${cmake.testArgs}'],
            cwd: '${cmake.testWorkingDirectory}'
        };
        const result = resolveTestVariables(config, testInfo);
        expect(result.program).to.equal('/path/to/test_executable');
        expect(result.args).to.deep.equal(['--arg1', '--arg2', 'value']);
        expect(result.cwd).to.equal('/path/to/workdir');
        expect(result.name).to.equal('(ctest) Launch');
        expect(result.type).to.equal('cppdbg');
    });

    test('handles nested objects', () => {
        const config = {
            env: {
                CWD: '${cmake.testWorkingDirectory}'
            }
        };
        const result = resolveTestVariables(config, testInfo);
        expect(result.env.CWD).to.equal('/path/to/workdir');
    });

    test('preserves non-string, non-object, non-array values', () => {
        const config = {
            stopAtEntry: false,
            port: 1234,
            program: '${cmake.testProgram}'
        };
        const result = resolveTestVariables(config, testInfo);
        expect(result.stopAtEntry).to.equal(false);
        expect(result.port).to.equal(1234);
        expect(result.program).to.equal('/path/to/test_executable');
    });

    test('handles null values', () => {
        const config = { program: null };
        const result = resolveTestVariables(config, testInfo);
        expect(result.program).to.be.null;
    });

    test('handles mixed array items with ${cmake.testArgs}', () => {
        const config = { args: ['--fixed', '${cmake.testArgs}', '--other'] };
        const result = resolveTestVariables(config, testInfo);
        expect(result.args).to.deep.equal(['--fixed', '--arg1', '--arg2', 'value', '--other']);
    });

    test('resolves variables embedded in strings', () => {
        const config = { description: 'Testing ${cmake.testProgram} in ${cmake.testWorkingDirectory}' };
        const result = resolveTestVariables(config, testInfo);
        expect(result.description).to.equal('Testing /path/to/test_executable in /path/to/workdir');
    });
});

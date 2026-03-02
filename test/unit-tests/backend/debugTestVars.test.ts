import { resolveTestVariables, TestInfo } from '@cmt/debugTestVars';
import { expect } from 'chai';

suite('resolveTestVariables', () => {
    const testInfo: TestInfo = {
        program: '/path/to/test_executable',
        args: ['--gtest_filter=TestSuite.TestCase', '--verbose'],
        workingDirectory: '/path/to/build'
    };

    test('replaces ${cmake.testProgram} in a string', () => {
        const result = resolveTestVariables('${cmake.testProgram}', testInfo);
        expect(result).to.equal('/path/to/test_executable');
    });

    test('replaces ${cmake.testWorkingDirectory} in a string', () => {
        const result = resolveTestVariables('${cmake.testWorkingDirectory}', testInfo);
        expect(result).to.equal('/path/to/build');
    });

    test('replaces multiple variables in one string', () => {
        const result = resolveTestVariables('run ${cmake.testProgram} in ${cmake.testWorkingDirectory}', testInfo);
        expect(result).to.equal('run /path/to/test_executable in /path/to/build');
    });

    test('expands ${cmake.testArgs} in an array to individual elements', () => {
        const result = resolveTestVariables(['${cmake.testArgs}'], testInfo);
        expect(result).to.deep.equal(['--gtest_filter=TestSuite.TestCase', '--verbose']);
    });

    test('expands ${cmake.testArgs} with whitespace in an array', () => {
        const result = resolveTestVariables([' ${cmake.testArgs} '], testInfo);
        expect(result).to.deep.equal(['--gtest_filter=TestSuite.TestCase', '--verbose']);
    });

    test('preserves other array elements alongside ${cmake.testArgs}', () => {
        const result = resolveTestVariables(['--extra', '${cmake.testArgs}', '--end'], testInfo);
        expect(result).to.deep.equal(['--extra', '--gtest_filter=TestSuite.TestCase', '--verbose', '--end']);
    });

    test('resolves variables in a full debug configuration object', () => {
        const config = {
            name: '(ctest) Launch',
            type: 'cppdbg',
            request: 'launch',
            program: '${cmake.testProgram}',
            args: ['${cmake.testArgs}'],
            cwd: '${cmake.testWorkingDirectory}'
        };

        const result = resolveTestVariables(config, testInfo);
        expect(result).to.deep.equal({
            name: '(ctest) Launch',
            type: 'cppdbg',
            request: 'launch',
            program: '/path/to/test_executable',
            args: ['--gtest_filter=TestSuite.TestCase', '--verbose'],
            cwd: '/path/to/build'
        });
    });

    test('resolves nested objects', () => {
        const config = {
            name: 'test',
            environment: [
                { name: 'PATH', value: '/usr/bin:${cmake.testWorkingDirectory}' }
            ]
        };

        const result = resolveTestVariables(config, testInfo);
        expect(result.environment[0].value).to.equal('/usr/bin:/path/to/build');
    });

    test('passes through non-string, non-object, non-array values', () => {
        expect(resolveTestVariables(42, testInfo)).to.equal(42);
        expect(resolveTestVariables(true, testInfo)).to.equal(true);
        expect(resolveTestVariables(null, testInfo)).to.equal(null);
    });

    test('handles string without any variables', () => {
        const result = resolveTestVariables('no variables here', testInfo);
        expect(result).to.equal('no variables here');
    });

    test('handles empty args', () => {
        const emptyInfo: TestInfo = {
            program: '/test',
            args: [],
            workingDirectory: '/wd'
        };

        const result = resolveTestVariables(['${cmake.testArgs}'], emptyInfo);
        expect(result).to.deep.equal([]);
    });

    test('handles empty working directory', () => {
        const noWdInfo: TestInfo = {
            program: '/test',
            args: ['arg1'],
            workingDirectory: ''
        };

        const result = resolveTestVariables({ cwd: '${cmake.testWorkingDirectory}' }, noWdInfo);
        expect(result.cwd).to.equal('');
    });
});

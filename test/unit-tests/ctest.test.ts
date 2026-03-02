import { readTestResultsFile, searchOutputForFailures } from "@cmt/ctest";
import { expect, getTestResourceFilePath } from "@test/util";
import { TestMessage } from "vscode";

suite('CTest test', () => {
    test('Parse XML test results', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestResults.xml'));
        expect(result!.site.testing.testList.length).to.eq(2);
        expect(result!.site.testing.test[0].name).to.eq('test1');
        expect(result!.site.testing.test[0].status).to.eq('passed');
        expect(result!.site.testing.test[1].name).to.eq('test2');
        expect(result!.site.testing.test[1].status).to.eq('failed');
    });

    test('CTest enabled, but no tests', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestResults2.xml'));
        expect(result!.site.testing.testList.length).to.eq(0);
        expect(result!.site.testing.test.length).to.eq(0);
    });

    test('Bad test results file', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestCMakeCache.txt'));
        expect(result).to.eq(undefined);
    });

    test('Find failure patterns in output', () => {
        const DEFAULT_MESSAGE = 'Test Failed';
        const output =
            '/path/to/file:47: the message\r\n'
            + 'expected wanted this\r\n'
            + 'actual got this\r\n'
            + '/only/required/field::\r\n'
            + '(42) other message: /path/to/other/file\r\n'
            + 'actually got one thing\r\n'
            + 'but wanted another\r\n';
        const results = searchOutputForFailures([
            {
                regexp: /(.*):(\d*): ?(.*)(?:\nexpected (.*))?(?:\nactual (.*))?/.source,
                expected: 4,
                actual: 5
            },
            {
                regexp: /\((\d*)\) ([^:]*):\s(.*)\nactually got (.*)\nbut wanted (.*)/.source,
                file: 3,
                message: 2,
                line: 1,
                actual: 4,
                expected: 5
            }
        ], output);
        expect(results.length).to.eq(3);
        const [result1, result2, result3] = results;
        assertMessageFields(result1, '/path/to/file', 46, 0, 'the message', 'wanted this', 'got this');
        assertMessageFields(result2, '/only/required/field', 0, 0, DEFAULT_MESSAGE, undefined, undefined);
        assertMessageFields(result3, '/path/to/other/file', 41, 0, 'other message', 'another', 'one thing');

        const result4 = searchOutputForFailures(/(.*):(\d+):/.source, output)[0];
        assertMessageFields(result4, '/path/to/file', 46, 0, DEFAULT_MESSAGE, undefined, undefined);

        const results2 = searchOutputForFailures([
            /\/only(.*)::/.source,
            /(.*):(\d+): (.*)/.source
        ], output);
        expect(results2.length).to.eq(2);
        const [result5, result6] = results2;
        assertMessageFields(result5, '/required/field', 0, 0, DEFAULT_MESSAGE, undefined, undefined);
        assertMessageFields(result6, '/path/to/file', 46, 0, 'the message', undefined, undefined);
    });

    test('Find GoogleTest failure patterns in output', () => {
        // Default patterns from package.json
        const defaultPatterns = [
            { regexp: '(.*?):(\\d+): *(?:error: *)(.*)' },
            { regexp: '(.*?)\\((\\d+)\\): *(?:error: *)(.*)' },
            { regexp: '(.*?):(\\d+): *(Failure.*)' }
        ];

        // GoogleTest failure format
        const gtestOutput = '/path/to/TestFile.cpp:135: Failure\nValue of: expr\n  Actual: true\nExpected: false\n';
        const gtestResults = searchOutputForFailures(defaultPatterns, gtestOutput);
        expect(gtestResults.length).to.eq(1);
        assertMessageFields(gtestResults[0], '/path/to/TestFile.cpp', 134, 0, 'Failure', undefined, undefined);

        // GCC/Clang error format still works (no regression)
        const gccOutput = '/path/to/file.cpp:10: error: undefined reference\n';
        const gccResults = searchOutputForFailures(defaultPatterns, gccOutput);
        expect(gccResults.length).to.eq(1);
        assertMessageFields(gccResults[0], '/path/to/file.cpp', 9, 0, 'undefined reference', undefined, undefined);

        // MSVC error format still works (no regression)
        const msvcOutput = '/project/file.cpp(20): error: something went wrong\n';
        const msvcResults = searchOutputForFailures(defaultPatterns, msvcOutput);
        expect(msvcResults.length).to.eq(1);
        assertMessageFields(msvcResults[0], '/project/file.cpp', 19, 0, 'something went wrong', undefined, undefined);

        // Lines without "Failure" or "error:" should not match
        const noMatchOutput = '[ RUN      ] MyTest.TestCase\n[  PASSED  ] 1 test.\n';
        const noMatchResults = searchOutputForFailures(defaultPatterns, noMatchOutput);
        expect(noMatchResults.length).to.eq(0);
    });

    function assertMessageFields(
        tm: TestMessage,
        file: string, line: number, column: number, message: string,
        expected: string | undefined, actual: string | undefined
    ): void {
        expect(tm.message).to.eq(message);
        expect(tm.location?.uri.path).to.eq(file);
        expect(tm.location?.range.start.line).to.eq(line);
        expect(tm.location?.range.start.character).to.eq(column);
        expect(tm.expectedOutput).to.eq(expected);
        expect(tm.actualOutput).to.eq(actual);
    }
});

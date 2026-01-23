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
        const output =
            'D:/dev/Synaptive/ModusV/embeddedfirmware/test/projects/pwrcon/src/TestLedMgr.cpp:135: Failure\r\n'
            + 'Value of: led_mgr->is_initialized(led_mgr)\r\n'
            + '  Actual: true\r\n'
            + 'Expected: false\r\n';
        const results = searchOutputForFailures([
            {
                regexp: '(.*?):(\\d+): *(?:error: *)(.*)'
            },
            {
                regexp: '(.*?)\\((\\d+)\\): *(?:error: *)(.*)'
            },
            {
                regexp: '(.*?):(\\d+): *(.*)'
            }
        ], output);
        expect(results.length).to.eq(1);
        const [result1] = results;
        assertMessageFields(result1, 'D:/dev/Synaptive/ModusV/embeddedfirmware/test/projects/pwrcon/src/TestLedMgr.cpp', 134, 0, 'Failure', undefined, undefined);
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

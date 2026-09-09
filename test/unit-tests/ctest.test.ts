import { CTestDriver, readTestResultsFile, searchOutputForFailures, getMinimalRegexFragments, getTestFailureMessage } from "@cmt/ctest";
import { expect, getTestResourceFilePath } from "@test/util";
import { TestMessage } from "vscode";

suite('CTest test', () => {
    test('CTest discovery uses the selected test preset environment', async () => {
        const presetEnvironment = { CMAKE_TOOLS_TEST_ENV: 'preset-value' };
        let executionOptions: { environment?: Record<string, string | undefined>; cwd?: string; silent?: boolean } | undefined;
        let testsUpdated = false;
        const driver = {
            binaryDir: 'build',
            async getCTestCommandEnvironment() {
                return presetEnvironment;
            },
            executeCommand(_command: string, _args: string[], _consumer: unknown, options: typeof executionOptions) {
                executionOptions = options;
                return { result: Promise.resolve({ retc: 0, stdout: '', stderr: '' }) };
            }
        };
        const ctestDriver = new CTestDriver({} as any);

        const result = await ctestDriver.extractTestsCommand(
            driver as any,
            'ctest',
            ['--show-only=json-v1'],
            async () => {
                testsUpdated = true;
            }
        );

        expect(result).to.eq(0);
        expect(testsUpdated).to.eq(true);
        expect(executionOptions?.environment).to.equal(presetEnvironment);
    });

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

    test('Parse results with compressed output and missing/empty measurements (robustness)', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestResults3.xml'));
        // A single test lacking a <Measurement> must not throw and wipe ALL results.
        expect(result).to.not.eq(undefined);
        expect(result!.site.testing.test.length).to.eq(3);

        const byName = (name: string) => result!.site.testing.test.find(t => t.name === name)!;

        // base64 + (gzip-labelled) zlib-compressed output decodes correctly (e.g. fmt's large gtest output).
        expect(byName('compressed-test').output).to.eq('Compressed gtest output line 1\nCompressed line 2\n');

        // A "Not Run" test with no <Measurement> yields empty output rather than throwing.
        expect(byName('notrun-test').status).to.eq('notrun');
        expect(byName('notrun-test').output).to.eq('');

        // An empty <Value/> yields empty output.
        expect(byName('empty-output-test').output).to.eq('');
    });

    test('Parse results for a test killed by a signal and name the signal in the failure message', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestResults4.xml'));
        expect(result).to.not.eq(undefined);
        expect(result!.site.testing.test.length).to.eq(2);

        const byName = (name: string) => result!.site.testing.test.find(t => t.name === name)!;

        // CTest records the signal in "Exit Code" and leaves "Exit Value" at 0 for a crashed test.
        const crashed = byName('crashing_test');
        expect(crashed.status).to.eq('failed');
        expect(crashed.measurements.get('Exit Code')?.value).to.eq('SEGFAULT');
        expect(crashed.measurements.get('Exit Value')?.value).to.eq('0');
        expect(crashed.measurements.get('Completion Status')?.value).to.eq('Completed');

        // The message must name the signal instead of claiming the test "failed with exit code 0".
        const crashedMessage = getTestFailureMessage(crashed.name, crashed.output, crashed.measurements.get('Exit Value')!.value, crashed.measurements.get('Exit Code')?.value);
        expect(crashedMessage).to.contain('Test crashing_test failed with SEGFAULT');
        expect(crashedMessage).to.not.contain('exit code 0');

        // An ordinary failure ("Exit Code" is "Failed") keeps reporting the exit value.
        const failed = byName('failing_test');
        expect(failed.measurements.get('Exit Code')?.value).to.eq('Failed');
        const failedMessage = getTestFailureMessage(failed.name, failed.output, failed.measurements.get('Exit Value')!.value, failed.measurements.get('Exit Code')?.value);
        expect(failedMessage).to.contain('Test failing_test failed with exit code 1.');
    });

    test('Failure message falls back to the exit value without a descriptive Exit Code', () => {
        // Older CTest results (and ordinary failures) only carry a numeric exit value.
        expect(getTestFailureMessage('t', '', '2', undefined)).to.contain('Test t failed with exit code 2.');
        expect(getTestFailureMessage('t', '', '2', 'Failed')).to.contain('Test t failed with exit code 2.');
        expect(getTestFailureMessage('t', '', '2', 'Completed')).to.contain('Test t failed with exit code 2.');
        expect(getTestFailureMessage('t', '', '2', '2')).to.contain('Test t failed with exit code 2.');
        expect(getTestFailureMessage('t', '', '0', 'Timeout')).to.contain('Test t failed with Timeout');
        expect(getTestFailureMessage('t', '', '0', 'SEGFAULT')).to.contain('Test t failed with SEGFAULT');
    });

    suite('disabled tests are skipped, not failed (#4267)', () => {
        // A minimal fake vscode.TestItem: no children, no uri/range.
        const makeTestItem = (id: string) => ({ id, uri: undefined, range: undefined, children: { size: 0 } });

        // A fake vscode.TestRun that records which outcome was reported for each test.
        const makeRun = () => {
            const calls = { skipped: [] as string[], passed: [] as string[], errored: [] as string[], failed: [] as string[] };
            const run = {
                appendOutput: () => {},
                skipped: (t: any) => calls.skipped.push(t.id),
                passed: (t: any) => calls.passed.push(t.id),
                errored: (t: any) => calls.errored.push(t.id),
                failed: (t: any) => calls.failed.push(t.id)
            };
            return { run, calls };
        };

        test('CTest reports a disabled test as notrun with completion status "Disabled"', async () => {
            const result = await readTestResultsFile(getTestResourceFilePath('TestResults5.xml'));
            const disabled = result!.site.testing.test.find(t => t.name === 'Suite2.DoesntRun')!;
            expect(disabled.status).to.eq('notrun');
            expect(disabled.measurements.get('Completion Status')?.value).to.eq('Disabled');
        });

        test('A disabled test is marked skipped and does not fail the run', async () => {
            const result = await readTestResultsFile(getTestResourceFilePath('TestResults5.xml'));
            const disabled = result!.site.testing.test.find(t => t.name === 'Suite2.DoesntRun')!;
            const driver = new CTestDriver({} as any);
            const { run, calls } = makeRun();

            const returnCode = (driver as any).testResultsAnalysis(disabled, makeTestItem('Suite2.DoesntRun'), 0, run);

            expect(calls.skipped).to.deep.eq(['Suite2.DoesntRun']);
            expect(calls.errored).to.be.empty;
            expect(calls.failed).to.be.empty;
            expect(calls.passed).to.be.empty;
            // A disabled test must not taint the overall run result.
            expect(returnCode).to.eq(0);
        });

        test('An ordinary passing test is still reported as passed', async () => {
            const result = await readTestResultsFile(getTestResourceFilePath('TestResults5.xml'));
            const passing = result!.site.testing.test.find(t => t.name === 'Suite1.Test1')!;
            const driver = new CTestDriver({} as any);
            const { run, calls } = makeRun();

            const returnCode = (driver as any).testResultsAnalysis(passing, makeTestItem('Suite1.Test1'), 0, run);

            expect(calls.passed).to.deep.eq(['Suite1.Test1']);
            expect(calls.skipped).to.be.empty;
            expect(calls.errored).to.be.empty;
            expect(calls.failed).to.be.empty;
            expect(returnCode).to.eq(0);
        });
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

    suite('getMinimalRegexFragments', () => {
        test('no targets', () => {
            const result = getMinimalRegexFragments(['A', 'B', 'C'], []);
            expect(result).to.deep.eq([]);
        });

        test('no forbidden strings', () => {
            const result = getMinimalRegexFragments(['A', 'B', 'C'], ['A', 'B', 'C']);
            expect(result).to.deep.eq(['^.']);
        });

        test('unique prefixes map correctly', () => {
            const superset = ['Test1', 'Test2', 'OtherTest'];
            // Target is a unique subset
            const result = getMinimalRegexFragments(superset, ['Test1', 'OtherTest']);
            // Test1 -> T e s t 1 (at '1', no other forbidden string shares this prefix since Test2 diverges at 1)
            // OtherTest -> O (matches nothing forbidden immediately)
            // wait, forbidden is ['Test2']
            // For 'Test1': prefix 'Test1' -> forbidden count 0. Wait, 'T' matches 'Test2', 'e', 's', 't', '1'. 'Test1' is the prefix!
            expect(result.length).to.eq(2);
            expect(result).to.include('^Test1');
            expect(result).to.include('^O');
        });

        test('swallowed target case (prefix of forbidden string)', () => {
            const superset = ['Test', 'Test.1', 'Test.2'];
            const targets = ['Test'];
            // Since 'Test' is a prefix of 'Test.1', it never finds a prefix that has forbiddenCount 0.
            // It parses all characters of 'Test' and then uses an end anchor.
            const result = getMinimalRegexFragments(superset, targets);
            expect(result).to.deep.eq(['^Test$']);
        });

        test('handles regex special characters properly', () => {
            const superset = ['Test[A]', 'Test[B]'];
            const targets = ['Test[A]'];
            // Forbidden is ['Test[B]']
            // 'Test[' is shared. 'Test[A' is unique.
            const result = getMinimalRegexFragments(superset, targets);
            expect(result).to.deep.eq(['^Test\\[A']);
        });

        test('removes redundant fragments', () => {
            // Targets: ['A', 'AB']
            // Forbidden: ['B']
            // 'A' -> 'A', AB -> 'A'
            // "A" covers "AB", so "AB" is redundant.
            const result = getMinimalRegexFragments(['A', 'AB', 'B'], ['A', 'AB']);
            // forbidden: 'B'. root has 'B'.
            // 'A' char 'A' -> forbidden 0 -> 'A'
            // 'AB' char 'A' -> forbidden 0 -> 'A'
            // result ['^A']
            expect(result).to.deep.eq(['^A']);
        });

        test('complex edge cases: nested suites, swallowed prefixes, special characters', () => {
            const superset = [
                'Suite',            // Target: gets swallowed by prefix sharing with forbidden
                'Suite.Test1',      // Target: logically nested
                'Suite.Test2',      // Target: logically nested
                'Suite.Test3',      // Forbidden
                'OtherSuite.Test1', // Target
                'OtherSuite.Test2', // Target
                'O[ther]',          // Forbidden: share 'O' prefix
                'A+B.Test',         // Target: gets swallowed + special chars
                'A+B.Test2'         // Forbidden
            ];

            const targets = [
                'Suite',
                'Suite.Test1',
                'Suite.Test2',
                'OtherSuite.Test1',
                'OtherSuite.Test2',
                'A+B.Test'
            ];

            const result = getMinimalRegexFragments(superset, targets);

            expect(result).to.have.members([
                '^Suite$',
                '^Suite\\.Test1',
                '^Suite\\.Test2',
                '^Ot',
                '^A\\+B\\.Test$'
            ]);
            expect(result.length).to.eq(5);
        });

        test('empty superset falls back to exact anchored matches (does not run all tests)', () => {
            // When the full set of tests is unknown (empty superset), a specific target must
            // not collapse to a match-everything regex; otherwise a single-test run (e.g. from
            // the inline CodeLens) would execute the entire suite.
            const result = getMinimalRegexFragments([], ['alpha']);
            expect(result).to.deep.eq(['^alpha$']);
        });

        test('empty superset exact-matches each of multiple targets', () => {
            const result = getMinimalRegexFragments([], ['alpha', 'beta']);
            expect(result).to.have.members(['^alpha$', '^beta$']);
        });

        test('empty superset escapes regex special characters', () => {
            const result = getMinimalRegexFragments([], ['A+B.Test']);
            expect(result).to.deep.eq(['^A\\+B\\.Test$']);
        });
    });
});

import { expect } from 'chai';
import * as gcc from '@cmt/diagnostics/gcc';
import * as msvc from '@cmt/diagnostics/msvc';
import * as ghs from '@cmt/diagnostics/ghs';
import * as diab from '@cmt/diagnostics/diab';
import { CompileOutputConsumer } from '@cmt/diagnostics/build';
import { ConfigurationReader } from '@cmt/config';

/**
 * Build output reaches the diagnostic parsers one line at a time on the extension host thread, and some build tools
 * print lines of many kilobytes (xcodebuild with the Xcode generator, `ninja -v`) or caret lines with hundreds of
 * leading spaces. Such lines were expensive for two reasons: the GCC, GHS and Diab patterns are not anchored, so on a
 * line that did not match they were retried from every offset (quadratic in the length of the line), and the MSVC
 * linker pattern backtracks very heavily on a line that starts with a lot of whitespace (issues #4828 and #4229 show
 * profiles dominated by the GCC parser).
 *
 * The "does not retry" and "does not backtrack" tests feed lines that are long enough for the unfixed patterns to need
 * more than a second and check that the parsers get through them within a budget that is far larger than what they
 * need now. The other tests check that the literal checks and anchors added to avoid the extra work do not change what
 * the parsers recognize.
 */
suite('Diagnostic parsers - long lines', () => {
    // The parsers now need about a millisecond or less for each of these lines, so the budget leaves ample room for a
    // slow or busy machine.
    const budgetMs = 100;

    // Time `run` three times and return the median, so that a single pause on a busy machine cannot fail a test.
    function medianElapsedMs(run: () => void): number {
        const samples: number[] = [];
        for (let i = 0; i < 3; ++i) {
            const start = process.hrtime.bigint();
            run();
            samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
        return samples.sort((a, b) => a - b)[1];
    }

    function expectWithinBudget(label: string, run: () => void) {
        expect(medianElapsedMs(run), label).to.be.lessThan(budgetMs);
    }

    function feed(parser: { handleLine(line: string): boolean }, line: string): () => void {
        return () => {
            parser.handleLine(line);
        };
    }

    // A compile command such as `ninja -v` prints, with many quoted -D values.
    const quotedDefines = (length: number) => '/usr/bin/clang++ ' + '-DNAME=\\"value\\" '.repeat(Math.ceil(length / 17));
    // The same command with a valid string-list macro, which contains the `",` that the GHS and Diab patterns look for.
    const quotedList = (length: number) => quotedDefines(length) + ' -DMODULE_NAMES=\\"first\\",\\"second\\"';
    const includeFlags = (length: number) => '/usr/bin/clang++ ' + '-I/some/include/dir '.repeat(Math.ceil(length / 20));

    function gccParserWithPendingTemplateError() {
        const parser = new gcc.Parser();
        expect(parser.handleLine('a.cpp: In instantiation of F<T>:')).to.be.true;
        return parser;
    }

    suite('GCC parser', () => {
        test('still reads an ordinary diagnostic after a long line', () => {
            const parser = new gcc.Parser();
            expect(parser.handleLine(includeFlags(70000))).to.be.false;
            expect(parser.handleLine('/src/a.cpp:3:7: warning: unused variable ‘x’ [-Wunused-variable]')).to.be.true;

            expect(parser.diagnostics).to.have.length(1);
            expect(parser.diagnostics[0].severity).to.eq('warning');
        });

        test('still reads a template instantiation error', () => {
            const parser = new gcc.Parser();
            expect(parser.handleLine('/src/a.cpp: In instantiation of ‘void f(T) [with T = int]’:')).to.be.true;
            expect(parser.handleLine('/src/a.cpp:10:5:   required from here')).to.be.true;
            expect(parser.handleLine('/src/a.cpp:3:7: error: no matching function for call to ‘g(int)’')).to.be.true;

            expect(parser.diagnostics).to.have.length(1);
            const diag = parser.diagnostics[0];
            expect(diag.file).to.eq('/src/a.cpp');
            expect(diag.severity).to.eq('error');
            expect(diag.related.map(r => r.message)).to.deep.eq([
                'In instantiation of ‘void f(T) [with T = int]’:',
                '   required from here'
            ]);
        });

        test('keeps reading a template error after an unrelated long line', () => {
            const parser = new gcc.Parser();
            expect(parser.handleLine('/src/a.cpp: In instantiation of ‘void f(T) [with T = int]’:')).to.be.true;
            expect(parser.handleLine(includeFlags(70000))).to.be.false;
            expect(parser.handleLine('/src/a.cpp:10:5:   required from here')).to.be.true;
            expect(parser.handleLine('/src/a.cpp:3:7: error: no matching function for call to ‘g(int)’')).to.be.true;

            expect(parser.diagnostics[0].related.map(r => r.message)).to.deep.eq([
                'In instantiation of ‘void f(T) [with T = int]’:',
                '   required from here'
            ]);
        });

        test('uses the last instantiation marker of a line', () => {
            const parser = new gcc.Parser();
            const line = 'x'.repeat(100000) + ': In instantiation of ‘first’: : In instantiation of ‘second’:';
            expect(parser.handleLine(line)).to.be.true;
            expect(parser.handleLine('/src/a.cpp:3:7: error: boom')).to.be.true;

            expect(parser.diagnostics[0].related[0].message).to.eq('In instantiation of ‘second’:');
        });

        test('reads an instantiation marker that starts after a line terminator', () => {
            // `.` does not match these characters, so the match starts on the line that holds the marker.
            for (const terminator of ['\r', '\n', '\u2028', '\u2029']) {
                const parser = new gcc.Parser();
                const line = `no marker here${terminator}a.cpp: In instantiation of ‘f’:${terminator}b.cpp: In instantiation of ‘g’:`;
                expect(parser.handleLine(line)).to.be.true;
                expect(parser.handleLine('/src/a.cpp:3:7: error: boom')).to.be.true;

                expect(parser.diagnostics[0].related[0].message, JSON.stringify(terminator)).to.eq('In instantiation of ‘f’:');
            }
        });

        test('reads a required-from location that starts after a line terminator', () => {
            for (const terminator of ['\r', '\n', '\u2028', '\u2029']) {
                const parser = gccParserWithPendingTemplateError();
                expect(parser.handleLine(`ignored${terminator}/src/dependency.hpp:10:5:   required from here`)).to.be.true;
                parser.handleLine('/src/a.cpp:3:7: error: boom');

                expect(parser.diagnostics[0].related.map(r => [r.file, r.message]), JSON.stringify(terminator)).to.deep.eq([
                    ['/src/a.cpp', 'In instantiation of F<T>:'],
                    ['/src/dependency.hpp', '   required from here']
                ]);
            }
        });

        test('does not read a marker that nothing follows', () => {
            const parser = new gcc.Parser();
            expect(parser.handleLine('/src/a.cpp: In instantiation of')).to.be.false;
        });

        test('does not retry a long line without a marker', () => {
            expectWithinBudget('gcc', feed(new gcc.Parser(), quotedDefines(65536)));
        });

        test('does not retry a long line that ends with the marker', () => {
            expectWithinBudget('gcc marker at the end', feed(new gcc.Parser(), 'x'.repeat(65536) + ': In instantiation of'));
        });

        test('does not retry a long line while a template error is pending', () => {
            expectWithinBudget('gcc pending', feed(gccParserWithPendingTemplateError(), 'x'.repeat(65536)));
        });

        test('does not retry a long line with "required from" but no location while a template error is pending', () => {
            expectWithinBudget('gcc pending required from',
                feed(gccParserWithPendingTemplateError(), 'x'.repeat(65536) + '   required from'));
        });
    });

    suite('MSVC parser', () => {
        test('still reads linker errors', () => {
            const parser = new msvc.Parser();
            const lines = [
                '[build] LINK : error LNK2001: unresolved external symbol foo',
                '[build] foo.obj : error LNK2019: unresolved external symbol bar referenced in function main',
                'fatal error LNK1104: cannot open file \'x.lib\'',
                '   LINK : warning LNK4098: defaultlib \'LIBCMT\' conflicts with use of other libs'
            ];
            for (const line of lines) {
                expect(parser.handleLine(line), line).to.be.true;
            }
            expect(parser.diagnostics.map(d => [d.severity, d.code, d.file])).to.deep.eq([
                ['error', 'LNK2001', 'linkerrors.txt'],
                ['error', 'LNK2019', 'linkerrors.txt'],
                ['fatal error', 'LNK1104', 'linkerrors.txt'],
                ['warning', 'LNK4098', 'linkerrors.txt']
            ]);
        });

        test('still reads compiler diagnostics', () => {
            const parser = new msvc.Parser();
            expect(parser.handleLine('C:\\src\\a.cpp(10,5): error C2065: \'x\': undeclared identifier')).to.be.true;

            expect(parser.diagnostics).to.have.length(1);
            expect(parser.diagnostics[0].code).to.eq('C2065');
            expect(parser.diagnostics[0].severity).to.eq('error');
        });

        for (const [name, whitespace] of [['spaces', ' '], ['tabs', '\t']]) {
            test(`does not backtrack over a caret line with many leading ${name}`, () => {
                expectWithinBudget(`msvc ${name}`, feed(new msvc.Parser(), whitespace.repeat(400) + '^'));
            });
        }
    });

    suite('GHS and Diab parsers', () => {
        test('GHS still reads diagnostics', () => {
            const parser = new ghs.Parser();
            expect(parser.handleLine('"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): warning #68-D: integer conversion resulted in a change of sign')).to.be.true;
            expect(parser.handleLine('"C:\\path\\source\\debug\\debug.c", At end of source: remark #96-D: a translation unit must contain at least one declaration')).to.be.true;

            expect(parser.diagnostics.map(d => [d.file, d.severity, d.message])).to.deep.eq([
                ['C:\\path\\source\\debug\\debug.c', 'warning', '#68-D: integer conversion resulted in a change of sign'],
                ['C:\\path\\source\\debug\\debug.c', 'remark', '#96-D: a translation unit must contain at least one declaration']
            ]);
        });

        test('Diab still reads diagnostics', () => {
            const parser = new diab.Parser();
            expect(parser.handleLine('"C:\\path\\source\\debug\\debug.c", line 631: warning (dcc:1518): variable i is never used')).to.be.true;

            expect(parser.diagnostics.map(d => [d.file, d.severity, d.code, d.message])).to.deep.eq([
                ['C:\\path\\source\\debug\\debug.c', 'warning', 'dcc:1518', 'variable i is never used']
            ]);
        });

        test('GHS and Diab still read diagnostics whose fields are separated by tabs', () => {
            const ghsParser = new ghs.Parser();
            expect(ghsParser.handleLine('"f.cpp",\tline\t7\t(col.\t3):\twarning\t#68-D: message')).to.be.true;
            expect(ghsParser.diagnostics.map(d => [d.file, d.severity, d.message])).to.deep.eq([
                ['f.cpp', 'warning', '#68-D: message']
            ]);

            const diabParser = new diab.Parser();
            expect(diabParser.handleLine('"f.cpp",\tline 7:\twarning\t(dcc:1518):\tmessage')).to.be.true;
            expect(diabParser.diagnostics.map(d => [d.file, d.severity, d.code, d.message])).to.deep.eq([
                ['f.cpp', 'warning', 'dcc:1518', 'message']
            ]);
        });

        for (const [name, newParser] of [['GHS', () => new ghs.Parser()], ['Diab', () => new diab.Parser()]] as const) {
            test(`${name} does not take a quoted list in a command line for a diagnostic`, () => {
                expect(newParser().handleLine(quotedList(1000))).to.be.false;
            });

            test(`${name} does not retry a long command line with many quotes`, () => {
                expectWithinBudget(name, feed(newParser(), quotedDefines(200000)));
            });

            test(`${name} does not retry a long command line with a quoted list`, () => {
                expectWithinBudget(`${name} quoted list`, feed(newParser(), quotedList(200000)));
            });
        }
    });

    suite('Build output consumer', () => {
        function newConsumer() {
            return new CompileOutputConsumer({ additionalBuildProblemMatchers: [] } as unknown as ConfigurationReader);
        }

        test('gets through long lines of build output without reporting diagnostics', () => {
            const consumer = newConsumer();
            const lines = [
                includeFlags(50000),
                quotedDefines(50000),
                quotedList(50000),
                'x'.repeat(50000) + ': In instantiation of',
                ' '.repeat(300) + '^',
                '\t'.repeat(300) + '^'
            ];
            expectWithinBudget('consumer', () => {
                for (const line of lines) {
                    consumer.output(line);
                }
            });
            for (const name of Object.keys(consumer.compilers)) {
                expect(consumer.compilers[name].diagnostics, name).to.have.length(0);
            }
        });
    });
});

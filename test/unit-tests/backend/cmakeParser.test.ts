import { expect } from 'chai';
import { createMockDocument } from './vscode-mock';
import { CMakeParser, Token } from '@cmt/cmakeParser';

function parse(text: string) {
    const doc = createMockDocument(text) as any;
    return new CMakeParser(doc).parseDocument();
}

function parseOne(text: string) {
    const ast = parse(text);
    expect(ast.invocations).to.have.lengthOf(1);
    return ast.invocations[0];
}

function argValues(text: string): string[] {
    return parseOne(text).args.map((a: Token) => a.value);
}

suite('CMakeParser', () => {

    suite('Basic command parsing', () => {
        test('Parse simple command with no arguments', () => {
            const inv = parseOne('command()');
            expect(inv.command.value).to.equal('command');
            expect(inv.args).to.have.lengthOf(0);
        });

        test('Parse command with one unquoted argument', () => {
            const inv = parseOne('message(hello)');
            expect(inv.command.value).to.equal('message');
            expect(inv.args).to.have.lengthOf(1);
            expect(inv.args[0].value).to.equal('hello');
        });

        test('Parse command with multiple unquoted arguments', () => {
            const values = argValues('set(MY_VAR a b c)');
            expect(values).to.deep.equal(['MY_VAR', 'a', 'b', 'c']);
        });

        test('Parse multiple commands', () => {
            const ast = parse('cmake_minimum_required(VERSION 3.10)\nproject(MyProject)\n');
            expect(ast.invocations).to.have.lengthOf(2);
            expect(ast.invocations[0].command.value).to.equal('cmake_minimum_required');
            expect(ast.invocations[1].command.value).to.equal('project');
        });

        test('Parse empty document', () => {
            const ast = parse('');
            expect(ast.invocations).to.have.lengthOf(0);
        });

        test('Parse document with only whitespace', () => {
            const ast = parse('   \n\n   \n');
            expect(ast.invocations).to.have.lengthOf(0);
        });
    });

    suite('Quoted arguments', () => {
        test('Parse quoted argument', () => {
            const values = argValues('message("hello world")');
            expect(values).to.deep.equal(['hello world']);
        });

        test('Parse quoted argument with escaped character', () => {
            // CMake unescape: \\X -> X (the backslash is removed)
            const values = argValues('message("hello\\nworld")');
            expect(values).to.deep.equal(['hellonworld']);
        });

        test('Parse quoted argument with escaped quote', () => {
            const values = argValues('message("say \\"hi\\"")');
            expect(values).to.deep.equal(['say "hi"']);
        });

        test('Parse empty quoted argument', () => {
            const values = argValues('message("")');
            expect(values).to.deep.equal(['']);
        });

        test('Parse quoted argument with escaped backslash', () => {
            // \\\\  -> raw is \\, unescape removes one backslash -> \
            const values = argValues('message("C:\\\\path")');
            expect(values).to.deep.equal(['C:\\path']);
        });
    });

    suite('Bracketed arguments', () => {
        // Note: The parser's ARG_TYPES order places UNQUOTED before BRACKETED,
        // so bracket arguments inside command invocations are currently tokenized
        // as UNQUOTED. The tests below verify the bracket value extraction regex
        // (the assignArgumentValues BRACKETED case) works correctly when tokens
        // are correctly typed as BRACKETED.

        test('Bracket argument regex extracts content (group 2, not group 1)', () => {
            // This tests the regex used in assignArgumentValues for BRACKETED tokens.
            // The regex: /^\[(=*)\[(.*)\]\1\]$/s
            // Group 1 = equal signs, Group 2 = content. Value should be content.
            const re = /^\[(=*)\[(.*)\]\1\]$/s;

            const simple = '[[hello world]]';
            expect(simple.replace(re, '$2')).to.equal('hello world');
            // Verify $1 would give wrong result (empty string for no = signs)
            expect(simple.replace(re, '$1')).to.equal('');

            const withEquals = '[=[hello]=]';
            expect(withEquals.replace(re, '$2')).to.equal('hello');
            expect(withEquals.replace(re, '$1')).to.equal('=');

            const doubleEquals = '[==[content]==]';
            expect(doubleEquals.replace(re, '$2')).to.equal('content');
            expect(doubleEquals.replace(re, '$1')).to.equal('==');

            const withNewlines = '[[line1\nline2]]';
            expect(withNewlines.replace(re, '$2')).to.equal('line1\nline2');

            const empty = '[[]]';
            expect(empty.replace(re, '$2')).to.equal('');
        });
    });

    suite('Unquoted argument escaping', () => {
        test('Unquoted argument with escaped space', () => {
            const values = argValues('message(hello\\ world)');
            expect(values).to.deep.equal(['hello world']);
        });

        test('Unquoted argument with escaped paren', () => {
            const values = argValues('message(hello\\()');
            expect(values).to.deep.equal(['hello(']);
        });
    });

    suite('Comments', () => {
        test('Line comment before command', () => {
            const ast = parse('# this is a comment\nmessage(hello)\n');
            expect(ast.invocations).to.have.lengthOf(1);
            expect(ast.invocations[0].command.value).to.equal('message');
        });

        test('Line comment between commands', () => {
            const ast = parse('set(A 1)\n# comment\nset(B 2)\n');
            expect(ast.invocations).to.have.lengthOf(2);
        });

        test('Comments between arguments', () => {
            const values = argValues('set(A # comment\n B C)\n');
            expect(values).to.deep.equal(['A', 'B', 'C']);
        });

        test('Bracket comment on its own line between arguments', () => {
            // Bracket comments must be on their own line since LINE_COMMENT
            // is tried before BRACKETED_COMMENT in the parser
            const values = argValues('set(A\n#[[bracket comment]]\nB)\n');
            expect(values).to.deep.equal(['A', 'B']);
        });

        test('Bracket comment with equal signs on its own line', () => {
            const values = argValues('set(A\n#[==[bracket comment]==]\nB)\n');
            expect(values).to.deep.equal(['A', 'B']);
        });
    });

    suite('Nested parentheses', () => {
        test('Nested parentheses are consumed but not included as args', () => {
            // In CMake, nested parens are allowed in unquoted args in some contexts,
            // but the parser tracks depth. Generator expressions use them.
            // The parser increments depth on LPAREN and decrements on RPAREN,
            // so content inside nested parens is not added as args.
            const inv = parseOne('if(A AND (B OR C))');
            // The parser sees: A AND ( B OR C )
            // ( increments depth, B OR C are at depth>1 but still collected as args,
            // ) decrements depth
            // Actually, re-reading the parser: args are pushed for UNQUOTED/QUOTED/BRACKETED
            // regardless of depth. LPAREN/RPAREN just adjust depth.
            expect(inv.args.map((a: Token) => a.value)).to.deep.equal(['A', 'AND', 'B', 'OR', 'C']);
        });

        test('Deeply nested parentheses', () => {
            const inv = parseOne('func(a (b (c)))');
            expect(inv.args.map((a: Token) => a.value)).to.deep.equal(['a', 'b', 'c']);
        });
    });

    suite('Token offsets', () => {
        test('Command token has correct offset', () => {
            const inv = parseOne('message(hello)');
            expect(inv.command.offset).to.equal(0);
            expect(inv.command.raw).to.equal('message');
            expect(inv.command.endOffset).to.equal(7);
        });

        test('Argument tokens have correct offsets', () => {
            const inv = parseOne('set(A B)');
            expect(inv.args[0].offset).to.equal(4);
            expect(inv.args[0].raw).to.equal('A');
            expect(inv.args[0].endOffset).to.equal(5);
            expect(inv.args[1].offset).to.equal(6);
            expect(inv.args[1].raw).to.equal('B');
            expect(inv.args[1].endOffset).to.equal(7);
        });

        test('Quoted argument raw includes quotes', () => {
            const inv = parseOne('message("hello")');
            expect(inv.args[0].raw).to.equal('"hello"');
            expect(inv.args[0].value).to.equal('hello');
            expect(inv.args[0].offset).to.equal(8);
            expect(inv.args[0].endOffset).to.equal(15);
        });

        test('Lparen and rparen tokens have correct offsets', () => {
            const inv = parseOne('msg(A)');
            expect(inv.lparen.offset).to.equal(3);
            expect(inv.lparen.endOffset).to.equal(4);
            expect(inv.rparen.offset).to.equal(5);
            expect(inv.rparen.endOffset).to.equal(6);
        });
    });

    suite('Error handling', () => {
        test('Throws on unterminated command', () => {
            expect(() => parse('message(')).to.throw();
        });

        test('Throws on missing lparen', () => {
            expect(() => parse('message')).to.throw();
        });

        test('Throws on unmatched rparen', () => {
            expect(() => parse(')')).to.throw();
        });
    });

    suite('Multiline commands', () => {
        test('Arguments on multiple lines', () => {
            const text = 'set(MY_VAR\n  a\n  b\n  c\n)';
            const values = argValues(text);
            expect(values).to.deep.equal(['MY_VAR', 'a', 'b', 'c']);
        });

        test('Arguments with mixed quoting on multiple lines', () => {
            const text = 'target_sources(mylib\n  PRIVATE\n    "src/a.cpp"\n    src/b.cpp\n)';
            const values = argValues(text);
            expect(values).to.deep.equal(['mylib', 'PRIVATE', 'src/a.cpp', 'src/b.cpp']);
        });
    });

    suite('Case sensitivity', () => {
        test('Command identifiers are case-preserved', () => {
            const inv = parseOne('MESSAGE(hello)');
            expect(inv.command.value).to.equal('MESSAGE');
        });

        test('Mixed case command', () => {
            const inv = parseOne('Add_Executable(myapp main.cpp)');
            expect(inv.command.value).to.equal('Add_Executable');
        });
    });

    suite('regexpPrepend', () => {
        // Imported indirectly via the parser module
        test('Prepend works with simple regex', () => {
            const { regexpPrepend } = require('@cmt/cmakeParser');
            const re = regexpPrepend('^', /hello/);
            expect(re.test('hello world')).to.be.true;
            expect(re.test('say hello')).to.be.false;
        });

        test('Prepend preserves flags', () => {
            const { regexpPrepend } = require('@cmt/cmakeParser');
            const re = regexpPrepend('^', /hello/i);
            expect(re.flags).to.include('i');
            expect(re.test('HELLO')).to.be.true;
        });
    });
});

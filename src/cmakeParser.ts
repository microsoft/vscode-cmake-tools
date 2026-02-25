import * as vscode from "vscode";

class ParserError extends Error {}

export interface CMakeAST {
    document: vscode.TextDocument;
    invocations: CommandInvocationAST[];
}

export interface CommandInvocationAST {
    command: Token;
    lparen: Token;
    args: Token[];
    rparen: Token;
}

export class Token {
    constructor(
        public type: TokenType,
        public raw: string,
        public document: vscode.TextDocument,
        public offset: number,
        public value: string
    ) { }

    public get endOffset(): number {
        return this.offset + this.raw.length;
    }
}

interface TokenType {
    name: string;
    re: RegExp;
}

const BRACKETED_RE = /\[(=*)\[.*\]\1\]/s;
const SPACE: TokenType = { name: 'SPACE', re: /[ \t]+/ };
const NEWLINE: TokenType = { name: 'NEWLINE', re: /\n/ };
const IDENT: TokenType = { name: 'IDENT', re: /[A-Za-z_][A-Za-z0-9_]*/ };
const LPAREN: TokenType = { name: 'LPAREN', re: /\(/ };
const RPAREN: TokenType = { name: 'RPAREN', re: /\)/ };
const BRACKETED: TokenType = { name: 'BRACKETED', re: BRACKETED_RE };
const QUOTED: TokenType = { name: 'QUOTED', re: /"(?:\\.|[^"])*"/s };
const UNQUOTED: TokenType = { name: 'UNQUOTED', re: /(?:\\.|[^\s()#"\\'])+/s };
// TODO: "legacy" identifiers with quotes in them
const LINE_COMMENT: TokenType = { name: 'LINE_COMMENT', re: /#[^\n]*/ };
const BRACKETED_COMMENT: TokenType = { name: 'BRACKETED_COMMENT', re: regexpPrepend('#', BRACKETED_RE) };
const EOF: TokenType = { name: 'EOF', re: /$/ };
const SPACE_TYPES: TokenType[] = [SPACE, NEWLINE];
const COMMENT_TYPES: TokenType[] = [LINE_COMMENT, BRACKETED_COMMENT];
const ARG_TYPES: TokenType[] = [
    LPAREN, RPAREN, BRACKETED, QUOTED, UNQUOTED
];

export class CMakeParser {
    private text: string;
    private offset: number;
    private pushbackBuffer: Token[] = [];

    constructor(private document: vscode.TextDocument, offset?: number) {
        this.offset = offset ?? 0;
        this.text = document.getText();
    }

    public parseDocument(): CMakeAST {
        return {
            document: this.document,
            invocations: Array.from(this.parseCommandInvocations())
        };
    }

    private *parseCommandInvocations(): Generator<CommandInvocationAST> {
        // Slightly more permissive in terms of comment placement than the
        // official grammar.
        while (true) {
            const next = this.skipSpaceAndComments(IDENT, EOF);
            if (next.type === EOF) {
                return;
            }
            this.pushbackBuffer.push(next);
            yield this.parseCommandInvocation();
        }
    }

    /**
     * Parse one Command Invocation. Call in a loop to parse an entire file
     */
    public parseCommandInvocation(): CommandInvocationAST {
        const command = this.skipSpace(IDENT);
        const lparen = this.skipSpace(LPAREN);
        const args: Token[] = [];
        let depth = 1;
        let token;
        while (depth) {
            token = this.skipSpaceAndComments(...ARG_TYPES);
            switch (token.type) {
                case LPAREN:
                    depth++; break;
                case RPAREN:
                    depth--; break;
                case UNQUOTED: case QUOTED: case BRACKETED:
                    args.push(token); break;
                default:
                    this.error(`unexpected ${token.type.name} ${token.raw}`);
            }
        }
        const rparen = token as Token;
        this.assignArgumentValues(args);

        return { command, args, lparen, rparen };
    }

    private assignArgumentValues(args: Token[]) {
        for (const arg of args) {
            switch (arg.type) {
                case QUOTED:
                    arg.value = unescape(arg.raw.slice(1, -1)); break;
                case BRACKETED:
                    arg.value = arg.raw.replace(/^\[(=*)\[(.*)\]\1\]$/, '$2'); break;
                case UNQUOTED: default:
                    arg.value = unescape(arg.raw); break;
            }
        }
    }

    private skipSpace(...expect: TokenType[]): Token {
        return this.skipTokens(SPACE_TYPES, expect);
    }

    private skipSpaceAndComments(...expect: TokenType[]): Token {
        return this.skipTokens([...SPACE_TYPES, ...COMMENT_TYPES], expect);
    }

    private skipTokens(skip: TokenType[], expect: TokenType[]): Token {
        expect = [...expect, ...skip];
        let token;
        do {
            token = this.nextToken(...expect);
        } while (skip.includes(token.type));

        return token;
    }

    private nextToken(...expect: TokenType[]): Token {
        let token: Token | null | undefined = this.pushbackBuffer.pop();
        if (token) {
            if (expect.includes(token.type)) {
                return token;
            }
        } else {
            token = this.scanToken(...expect);
            if (token) {
                return token;
            }
        }
        if (this.offset === this.text.length) {
            this.error(`unexpected EOF`);
        }
        this.error(`unexpected ${this.text[this.offset]}`);
    }

    private scanToken(...expect: TokenType[]): Token | null {
        for (const matcher of expect) {
            const token = this.tryMatch(matcher);
            if (token !== null) {
                return token;
            }
        }
        return null;
    }

    private tryMatch(matcher: TokenType): Token | null {
        const re = regexpPrepend('^', matcher.re);
        const match = re.exec(this.text.slice(this.offset));
        if (!match) {
            return null;
        }
        const token = new Token(
            matcher,
            match[0],
            this.document,
            this.offset,
            match[0] // may be overwritten later with a post-processed value
        );
        this.offset += match[0].length;
        return token;
    }

    private error(msg: string): never {
        const pos = this.document.positionAt(this.offset);
        throw new ParserError(
            `${this.document.fileName}:${pos.line + 1}:${pos.character + 1}: ${msg}`);
    }
}

export function regexpPrepend(prefix: string, re: RegExp): RegExp {
    return RegExp(prefix + re.source, re.flags);
}

function unescape(s: string): string {
    return s.replace(/\\(.)/g, '$1');
}

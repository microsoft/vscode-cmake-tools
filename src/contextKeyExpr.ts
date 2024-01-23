/* eslint-disable @typescript-eslint/array-type */
/* Code recycled and modified from vscode repo: https://github.com/microsoft/vscode/blob/main/src/vs/platform/contextkey/common/contextkey.ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nls from 'vscode-nls';
import { Exception } from 'handlebars';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const CONSTANT_VALUES = new Map<string, boolean>();
CONSTANT_VALUES.set('false', false);
CONSTANT_VALUES.set('true', true);

export const enum TokenType {
    LParen,
    RParen,
    Neg,
    Eq,
    NotEq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    RegexOp,
    RegexStr,
    True,
    False,
    In,
    Not,
    And,
    Or,
    Str,
    QuotedStr,
    Error,
    EOF,
}

export type Token =
	| { type: TokenType.LParen; offset: number }
	| { type: TokenType.RParen; offset: number }
	| { type: TokenType.Neg; offset: number }
	| { type: TokenType.Eq; offset: number; isTripleEq: boolean }
	| { type: TokenType.NotEq; offset: number; isTripleEq: boolean }
	| { type: TokenType.Lt; offset: number }
	| { type: TokenType.LtEq; offset: number }
	| { type: TokenType.Gt; offset: number }
	| { type: TokenType.GtEq; offset: number }
	| { type: TokenType.RegexOp; offset: number }
	| { type: TokenType.RegexStr; offset: number; lexeme: string }
	| { type: TokenType.True; offset: number }
	| { type: TokenType.False; offset: number }
	| { type: TokenType.In; offset: number }
	| { type: TokenType.Not; offset: number }
	| { type: TokenType.And; offset: number }
	| { type: TokenType.Or; offset: number }
	| { type: TokenType.Str; offset: number; lexeme: string }
	| { type: TokenType.QuotedStr; offset: number; lexeme: string }
	| { type: TokenType.Error; offset: number; lexeme: string }
	| { type: TokenType.EOF; offset: number };

type KeywordTokenType = TokenType.Not | TokenType.In | TokenType.False | TokenType.True;
type TokenTypeWithoutLexeme =
	TokenType.LParen |
	TokenType.RParen |
	TokenType.Neg |
	TokenType.Lt |
	TokenType.LtEq |
	TokenType.Gt |
	TokenType.GtEq |
	TokenType.RegexOp |
	TokenType.True |
	TokenType.False |
	TokenType.In |
	TokenType.Not |
	TokenType.And |
	TokenType.Or |
	TokenType.EOF;

/**
 * Example:
 * `foo == bar'` - note how single quote doesn't have a corresponding closing quote,
 * so it's reported as unexpected
 */
export type LexingError = {
    offset: number; /** note that this doesn't take into account escape characters from the original encoding of the string, e.g., within an extension manifest file's JSON encoding  */
    lexeme: string;
    additionalInfo?: string;
};

function hintDidYouMean(...meant: string[]) {
    switch (meant.length) {
        case 1:
            return localize('contextkey.scanner.hint.didYouMean1', "Did you mean {0}?", meant[0]);
        case 2:
            return localize('contextkey.scanner.hint.didYouMean2', "Did you mean {0} or {1}?", meant[0], meant[1]);
        case 3:
            return localize('contextkey.scanner.hint.didYouMean3', "Did you mean {0}, {1} or {2}?", meant[0], meant[1], meant[2]);
        default: // we just don't expect that many
            return undefined;
    }
}

const hintDidYouForgetToOpenOrCloseQuote = localize('contextkey.scanner.hint.didYouForgetToOpenOrCloseQuote', "Did you forget to open or close the quote?");
const hintDidYouForgetToEscapeSlash = localize('contextkey.scanner.hint.didYouForgetToEscapeSlash', "Did you forget to escape the '/' (slash) character? Put two backslashes before it to escape, e.g., '\\\\/\'.");

/**
 * A simple scanner for context keys.
 *
 * Example:
 *
 * ```ts
 * const scanner = new Scanner().reset('resourceFileName =~ /docker/ && !config.docker.enabled');
 * const tokens = [...scanner];
 * if (scanner.errorTokens.length > 0) {
 *     scanner.errorTokens.forEach(err => console.error(`Unexpected token at ${err.offset}: ${err.lexeme}\nHint: ${err.additional}`));
 * } else {
 *     // process tokens
 * }
 * ```
 */
export class Scanner {

    static getLexeme(token: Token): string {
        switch (token.type) {
            case TokenType.LParen:
                return '(';
            case TokenType.RParen:
                return ')';
            case TokenType.Neg:
                return '!';
            case TokenType.Eq:
                return token.isTripleEq ? '===' : '==';
            case TokenType.NotEq:
                return token.isTripleEq ? '!==' : '!=';
            case TokenType.Lt:
                return '<';
            case TokenType.LtEq:
                return '<=';
            case TokenType.Gt:
                return '>=';
            case TokenType.GtEq:
                return '>=';
            case TokenType.RegexOp:
                return '=~';
            case TokenType.RegexStr:
                return token.lexeme;
            case TokenType.True:
                return 'true';
            case TokenType.False:
                return 'false';
            case TokenType.In:
                return 'in';
            case TokenType.Not:
                return 'not';
            case TokenType.And:
                return '&&';
            case TokenType.Or:
                return '||';
            case TokenType.Str:
                return token.lexeme;
            case TokenType.QuotedStr:
                return token.lexeme;
            case TokenType.Error:
                return token.lexeme;
            case TokenType.EOF:
                return 'EOF';
            default:
                throw new Exception(`unhandled token type: ${JSON.stringify(token)}; have you forgotten to add a case?`);
        }
    }

    private static _regexFlags = new Set(['i', 'g', 's', 'm', 'y', 'u'].map(ch => ch.charCodeAt(0)));

    private static _keywords = new Map<string, KeywordTokenType>([
        ['not', TokenType.Not],
        ['in', TokenType.In],
        ['false', TokenType.False],
        ['true', TokenType.True]
    ]);

    private _input: string = '';
    private _start: number = 0;
    private _current: number = 0;
    private _tokens: Token[] = [];
    private _errors: LexingError[] = [];

    get errors(): Readonly<LexingError[]> {
        return this._errors;
    }

    reset(value: string) {
        this._input = value;

        this._start = 0;
        this._current = 0;
        this._tokens = [];
        this._errors = [];

        return this;
    }

    scan() {
        while (!this._isAtEnd()) {

            this._start = this._current;

            const ch = this._advance();
            switch (ch) {
                case CharCode.OpenParen: this._addToken(TokenType.LParen); break;
                case CharCode.CloseParen: this._addToken(TokenType.RParen); break;

                case CharCode.ExclamationMark:
                    if (this._match(CharCode.Equals)) {
                        const isTripleEq = this._match(CharCode.Equals); // eat last `=` if `!==`
                        this._tokens.push({ type: TokenType.NotEq, offset: this._start, isTripleEq });
                    } else {
                        this._addToken(TokenType.Neg);
                    }
                    break;

                case CharCode.SingleQuote: this._quotedString(); break;
                case CharCode.Slash: this._regex(); break;

                case CharCode.Equals:
                    if (this._match(CharCode.Equals)) { // support `==`
                        const isTripleEq = this._match(CharCode.Equals); // eat last `=` if `===`
                        this._tokens.push({ type: TokenType.Eq, offset: this._start, isTripleEq });
                    } else if (this._match(CharCode.Tilde)) {
                        this._addToken(TokenType.RegexOp);
                    } else {
                        this._error(hintDidYouMean('==', '=~'));
                    }
                    break;

                case CharCode.LessThan: this._addToken(this._match(CharCode.Equals) ? TokenType.LtEq : TokenType.Lt); break;

                case CharCode.GreaterThan: this._addToken(this._match(CharCode.Equals) ? TokenType.GtEq : TokenType.Gt); break;

                case CharCode.Ampersand:
                    if (this._match(CharCode.Ampersand)) {
                        this._addToken(TokenType.And);
                    } else {
                        this._error(hintDidYouMean('&&'));
                    }
                    break;

                case CharCode.Pipe:
                    if (this._match(CharCode.Pipe)) {
                        this._addToken(TokenType.Or);
                    } else {
                        this._error(hintDidYouMean('||'));
                    }
                    break;

                    // TODO@ulugbekna: 1) rewrite using a regex 2) reconsider what characters are considered whitespace, including unicode, nbsp, etc.
                case CharCode.Space:
                case CharCode.CarriageReturn:
                case CharCode.Tab:
                case CharCode.LineFeed:
                case CharCode.NoBreakSpace: // &nbsp
                    break;

                default:
                    this._string();
            }
        }

        this._start = this._current;
        this._addToken(TokenType.EOF);

        return Array.from(this._tokens);
    }

    private _match(expected: number): boolean {
        if (this._isAtEnd()) {
            return false;
        }
        if (this._input.charCodeAt(this._current) !== expected) {
            return false;
        }
        this._current++;
        return true;
    }

    private _advance(): number {
        return this._input.charCodeAt(this._current++);
    }

    private _peek(): number {
        return this._isAtEnd() ? CharCode.Null : this._input.charCodeAt(this._current);
    }

    private _addToken(type: TokenTypeWithoutLexeme) {
        this._tokens.push({ type, offset: this._start });
    }

    private _error(additional?: string) {
        const offset = this._start;
        const lexeme = this._input.substring(this._start, this._current);
        const errToken: Token = { type: TokenType.Error, offset: this._start, lexeme };
        this._errors.push({ offset, lexeme, additionalInfo: additional });
        this._tokens.push(errToken);
    }

    // u - unicode, y - sticky // TODO@ulugbekna: we accept double quotes as part of the string rather than as a delimiter (to preserve old parser's behavior)
    private stringRe = /[a-zA-Z0-9_<>\-\./\\:\*\?\+\[\]\^,#@;"%\$\p{L}-]+/uy;
    private _string() {
        this.stringRe.lastIndex = this._start;
        const match = this.stringRe.exec(this._input);
        if (match) {
            this._current = this._start + match[0].length;
            const lexeme = this._input.substring(this._start, this._current);
            const keyword = Scanner._keywords.get(lexeme);
            if (keyword) {
                this._addToken(keyword);
            } else {
                this._tokens.push({ type: TokenType.Str, lexeme, offset: this._start });
            }
        }
    }

    // captures the lexeme without the leading and trailing '
    private _quotedString() {
        while (this._peek() !== CharCode.SingleQuote && !this._isAtEnd()) { // TODO@ulugbekna: add support for escaping ' ?
            this._advance();
        }

        if (this._isAtEnd()) {
            this._error(hintDidYouForgetToOpenOrCloseQuote);
            return;
        }

        // consume the closing '
        this._advance();

        this._tokens.push({ type: TokenType.QuotedStr, lexeme: this._input.substring(this._start + 1, this._current - 1), offset: this._start + 1 });
    }

    /*
	 * Lexing a regex expression: /.../[igsmyu]*
	 * Based on https://github.com/microsoft/TypeScript/blob/9247ef115e617805983740ba795d7a8164babf89/src/compiler/scanner.ts#L2129-L2181
	 *
	 * Note that we want slashes within a regex to be escaped, e.g., /file:\\/\\/\\// should match `file:///`
	 */
    private _regex() {
        let p = this._current;

        let inEscape = false;
        let inCharacterClass = false;
        while (true) {
            if (p >= this._input.length) {
                this._current = p;
                this._error(hintDidYouForgetToEscapeSlash);
                return;
            }

            const ch = this._input.charCodeAt(p);

            if (inEscape) { // parsing an escape character
                inEscape = false;
            } else if (ch === CharCode.Slash && !inCharacterClass) { // end of regex
                p++;
                break;
            } else if (ch === CharCode.OpenSquareBracket) {
                inCharacterClass = true;
            } else if (ch === CharCode.Backslash) {
                inEscape = true;
            } else if (ch === CharCode.CloseSquareBracket) {
                inCharacterClass = false;
            }
            p++;
        }

        // Consume flags // TODO@ulugbekna: use regex instead
        while (p < this._input.length && Scanner._regexFlags.has(this._input.charCodeAt(p))) {
            p++;
        }

        this._current = p;

        const lexeme = this._input.substring(this._start, this._current);
        this._tokens.push({ type: TokenType.RegexStr, lexeme, offset: this._start });
    }

    private _isAtEnd() {
        return this._current >= this._input.length;
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Names from https://blog.codinghorror.com/ascii-pronunciation-rules-for-programmers/

/**
 * An inlined enum containing useful character codes (to be used with String.charCodeAt).
 * Please leave the const keyword such that it gets inlined when compiled to JavaScript!
 */
export const enum CharCode {
    Null = 0,
    /**
	 * The `\b` character.
	 */
    Backspace = 8,
    /**
	 * The `\t` character.
	 */
    Tab = 9,
    /**
	 * The `\n` character.
	 */
    LineFeed = 10,
    /**
	 * The `\r` character.
	 */
    CarriageReturn = 13,
    Space = 32,
    /**
	 * The `!` character.
	 */
    ExclamationMark = 33,
    /**
	 * The `"` character.
	 */
    DoubleQuote = 34,
    /**
	 * The `#` character.
	 */
    Hash = 35,
    /**
	 * The `$` character.
	 */
    DollarSign = 36,
    /**
	 * The `%` character.
	 */
    PercentSign = 37,
    /**
	 * The `&` character.
	 */
    Ampersand = 38,
    /**
	 * The `'` character.
	 */
    SingleQuote = 39,
    /**
	 * The `(` character.
	 */
    OpenParen = 40,
    /**
	 * The `)` character.
	 */
    CloseParen = 41,
    /**
	 * The `*` character.
	 */
    Asterisk = 42,
    /**
	 * The `+` character.
	 */
    Plus = 43,
    /**
	 * The `,` character.
	 */
    Comma = 44,
    /**
	 * The `-` character.
	 */
    Dash = 45,
    /**
	 * The `.` character.
	 */
    Period = 46,
    /**
	 * The `/` character.
	 */
    Slash = 47,

    Digit0 = 48,
    Digit1 = 49,
    Digit2 = 50,
    Digit3 = 51,
    Digit4 = 52,
    Digit5 = 53,
    Digit6 = 54,
    Digit7 = 55,
    Digit8 = 56,
    Digit9 = 57,

    /**
	 * The `:` character.
	 */
    Colon = 58,
    /**
	 * The `;` character.
	 */
    Semicolon = 59,
    /**
	 * The `<` character.
	 */
    LessThan = 60,
    /**
	 * The `=` character.
	 */
    Equals = 61,
    /**
	 * The `>` character.
	 */
    GreaterThan = 62,
    /**
	 * The `?` character.
	 */
    QuestionMark = 63,
    /**
	 * The `@` character.
	 */
    AtSign = 64,

    A = 65,
    B = 66,
    C = 67,
    D = 68,
    E = 69,
    F = 70,
    G = 71,
    H = 72,
    I = 73,
    J = 74,
    K = 75,
    L = 76,
    M = 77,
    N = 78,
    O = 79,
    P = 80,
    Q = 81,
    R = 82,
    S = 83,
    T = 84,
    U = 85,
    V = 86,
    W = 87,
    X = 88,
    Y = 89,
    Z = 90,

    /**
	 * The `[` character.
	 */
    OpenSquareBracket = 91,
    /**
	 * The `\` character.
	 */
    Backslash = 92,
    /**
	 * The `]` character.
	 */
    CloseSquareBracket = 93,
    /**
	 * The `^` character.
	 */
    Caret = 94,
    /**
	 * The `_` character.
	 */
    Underline = 95,
    /**
	 * The ``(`)`` character.
	 */
    BackTick = 96,

    a = 97,
    b = 98,
    c = 99,
    d = 100,
    e = 101,
    f = 102,
    g = 103,
    h = 104,
    i = 105,
    j = 106,
    k = 107,
    l = 108,
    m = 109,
    n = 110,
    o = 111,
    p = 112,
    q = 113,
    r = 114,
    s = 115,
    t = 116,
    u = 117,
    v = 118,
    w = 119,
    x = 120,
    y = 121,
    z = 122,

    /**
	 * The `{` character.
	 */
    OpenCurlyBrace = 123,
    /**
	 * The `|` character.
	 */
    Pipe = 124,
    /**
	 * The `}` character.
	 */
    CloseCurlyBrace = 125,
    /**
	 * The `~` character.
	 */
    Tilde = 126,

    /**
	 * The &nbsp; (no-break space) character.
	 * Unicode Character 'NO-BREAK SPACE' (U+00A0)
	 */
    NoBreakSpace = 160,

    U_Combining_Grave_Accent = 0x0300,								//	U+0300	Combining Grave Accent
    U_Combining_Acute_Accent = 0x0301,								//	U+0301	Combining Acute Accent
    U_Combining_Circumflex_Accent = 0x0302,							//	U+0302	Combining Circumflex Accent
    U_Combining_Tilde = 0x0303,										//	U+0303	Combining Tilde
    U_Combining_Macron = 0x0304,									//	U+0304	Combining Macron
    U_Combining_Overline = 0x0305,									//	U+0305	Combining Overline
    U_Combining_Breve = 0x0306,										//	U+0306	Combining Breve
    U_Combining_Dot_Above = 0x0307,									//	U+0307	Combining Dot Above
    U_Combining_Diaeresis = 0x0308,									//	U+0308	Combining Diaeresis
    U_Combining_Hook_Above = 0x0309,								//	U+0309	Combining Hook Above
    U_Combining_Ring_Above = 0x030A,								//	U+030A	Combining Ring Above
    U_Combining_Double_Acute_Accent = 0x030B,						//	U+030B	Combining Double Acute Accent
    U_Combining_Caron = 0x030C,										//	U+030C	Combining Caron
    U_Combining_Vertical_Line_Above = 0x030D,						//	U+030D	Combining Vertical Line Above
    U_Combining_Double_Vertical_Line_Above = 0x030E,				//	U+030E	Combining Double Vertical Line Above
    U_Combining_Double_Grave_Accent = 0x030F,						//	U+030F	Combining Double Grave Accent
    U_Combining_Candrabindu = 0x0310,								//	U+0310	Combining Candrabindu
    U_Combining_Inverted_Breve = 0x0311,							//	U+0311	Combining Inverted Breve
    U_Combining_Turned_Comma_Above = 0x0312,						//	U+0312	Combining Turned Comma Above
    U_Combining_Comma_Above = 0x0313,								//	U+0313	Combining Comma Above
    U_Combining_Reversed_Comma_Above = 0x0314,						//	U+0314	Combining Reversed Comma Above
    U_Combining_Comma_Above_Right = 0x0315,							//	U+0315	Combining Comma Above Right
    U_Combining_Grave_Accent_Below = 0x0316,						//	U+0316	Combining Grave Accent Below
    U_Combining_Acute_Accent_Below = 0x0317,						//	U+0317	Combining Acute Accent Below
    U_Combining_Left_Tack_Below = 0x0318,							//	U+0318	Combining Left Tack Below
    U_Combining_Right_Tack_Below = 0x0319,							//	U+0319	Combining Right Tack Below
    U_Combining_Left_Angle_Above = 0x031A,							//	U+031A	Combining Left Angle Above
    U_Combining_Horn = 0x031B,										//	U+031B	Combining Horn
    U_Combining_Left_Half_Ring_Below = 0x031C,						//	U+031C	Combining Left Half Ring Below
    U_Combining_Up_Tack_Below = 0x031D,								//	U+031D	Combining Up Tack Below
    U_Combining_Down_Tack_Below = 0x031E,							//	U+031E	Combining Down Tack Below
    U_Combining_Plus_Sign_Below = 0x031F,							//	U+031F	Combining Plus Sign Below
    U_Combining_Minus_Sign_Below = 0x0320,							//	U+0320	Combining Minus Sign Below
    U_Combining_Palatalized_Hook_Below = 0x0321,					//	U+0321	Combining Palatalized Hook Below
    U_Combining_Retroflex_Hook_Below = 0x0322,						//	U+0322	Combining Retroflex Hook Below
    U_Combining_Dot_Below = 0x0323,									//	U+0323	Combining Dot Below
    U_Combining_Diaeresis_Below = 0x0324,							//	U+0324	Combining Diaeresis Below
    U_Combining_Ring_Below = 0x0325,								//	U+0325	Combining Ring Below
    U_Combining_Comma_Below = 0x0326,								//	U+0326	Combining Comma Below
    U_Combining_Cedilla = 0x0327,									//	U+0327	Combining Cedilla
    U_Combining_Ogonek = 0x0328,									//	U+0328	Combining Ogonek
    U_Combining_Vertical_Line_Below = 0x0329,						//	U+0329	Combining Vertical Line Below
    U_Combining_Bridge_Below = 0x032A,								//	U+032A	Combining Bridge Below
    U_Combining_Inverted_Double_Arch_Below = 0x032B,				//	U+032B	Combining Inverted Double Arch Below
    U_Combining_Caron_Below = 0x032C,								//	U+032C	Combining Caron Below
    U_Combining_Circumflex_Accent_Below = 0x032D,					//	U+032D	Combining Circumflex Accent Below
    U_Combining_Breve_Below = 0x032E,								//	U+032E	Combining Breve Below
    U_Combining_Inverted_Breve_Below = 0x032F,						//	U+032F	Combining Inverted Breve Below
    U_Combining_Tilde_Below = 0x0330,								//	U+0330	Combining Tilde Below
    U_Combining_Macron_Below = 0x0331,								//	U+0331	Combining Macron Below
    U_Combining_Low_Line = 0x0332,									//	U+0332	Combining Low Line
    U_Combining_Double_Low_Line = 0x0333,							//	U+0333	Combining Double Low Line
    U_Combining_Tilde_Overlay = 0x0334,								//	U+0334	Combining Tilde Overlay
    U_Combining_Short_Stroke_Overlay = 0x0335,						//	U+0335	Combining Short Stroke Overlay
    U_Combining_Long_Stroke_Overlay = 0x0336,						//	U+0336	Combining Long Stroke Overlay
    U_Combining_Short_Solidus_Overlay = 0x0337,						//	U+0337	Combining Short Solidus Overlay
    U_Combining_Long_Solidus_Overlay = 0x0338,						//	U+0338	Combining Long Solidus Overlay
    U_Combining_Right_Half_Ring_Below = 0x0339,						//	U+0339	Combining Right Half Ring Below
    U_Combining_Inverted_Bridge_Below = 0x033A,						//	U+033A	Combining Inverted Bridge Below
    U_Combining_Square_Below = 0x033B,								//	U+033B	Combining Square Below
    U_Combining_Seagull_Below = 0x033C,								//	U+033C	Combining Seagull Below
    U_Combining_X_Above = 0x033D,									//	U+033D	Combining X Above
    U_Combining_Vertical_Tilde = 0x033E,							//	U+033E	Combining Vertical Tilde
    U_Combining_Double_Overline = 0x033F,							//	U+033F	Combining Double Overline
    U_Combining_Grave_Tone_Mark = 0x0340,							//	U+0340	Combining Grave Tone Mark
    U_Combining_Acute_Tone_Mark = 0x0341,							//	U+0341	Combining Acute Tone Mark
    U_Combining_Greek_Perispomeni = 0x0342,							//	U+0342	Combining Greek Perispomeni
    U_Combining_Greek_Koronis = 0x0343,								//	U+0343	Combining Greek Koronis
    U_Combining_Greek_Dialytika_Tonos = 0x0344,						//	U+0344	Combining Greek Dialytika Tonos
    U_Combining_Greek_Ypogegrammeni = 0x0345,						//	U+0345	Combining Greek Ypogegrammeni
    U_Combining_Bridge_Above = 0x0346,								//	U+0346	Combining Bridge Above
    U_Combining_Equals_Sign_Below = 0x0347,							//	U+0347	Combining Equals Sign Below
    U_Combining_Double_Vertical_Line_Below = 0x0348,				//	U+0348	Combining Double Vertical Line Below
    U_Combining_Left_Angle_Below = 0x0349,							//	U+0349	Combining Left Angle Below
    U_Combining_Not_Tilde_Above = 0x034A,							//	U+034A	Combining Not Tilde Above
    U_Combining_Homothetic_Above = 0x034B,							//	U+034B	Combining Homothetic Above
    U_Combining_Almost_Equal_To_Above = 0x034C,						//	U+034C	Combining Almost Equal To Above
    U_Combining_Left_Right_Arrow_Below = 0x034D,					//	U+034D	Combining Left Right Arrow Below
    U_Combining_Upwards_Arrow_Below = 0x034E,						//	U+034E	Combining Upwards Arrow Below
    U_Combining_Grapheme_Joiner = 0x034F,							//	U+034F	Combining Grapheme Joiner
    U_Combining_Right_Arrowhead_Above = 0x0350,						//	U+0350	Combining Right Arrowhead Above
    U_Combining_Left_Half_Ring_Above = 0x0351,						//	U+0351	Combining Left Half Ring Above
    U_Combining_Fermata = 0x0352,									//	U+0352	Combining Fermata
    U_Combining_X_Below = 0x0353,									//	U+0353	Combining X Below
    U_Combining_Left_Arrowhead_Below = 0x0354,						//	U+0354	Combining Left Arrowhead Below
    U_Combining_Right_Arrowhead_Below = 0x0355,						//	U+0355	Combining Right Arrowhead Below
    U_Combining_Right_Arrowhead_And_Up_Arrowhead_Below = 0x0356,	//	U+0356	Combining Right Arrowhead And Up Arrowhead Below
    U_Combining_Right_Half_Ring_Above = 0x0357,						//	U+0357	Combining Right Half Ring Above
    U_Combining_Dot_Above_Right = 0x0358,							//	U+0358	Combining Dot Above Right
    U_Combining_Asterisk_Below = 0x0359,							//	U+0359	Combining Asterisk Below
    U_Combining_Double_Ring_Below = 0x035A,							//	U+035A	Combining Double Ring Below
    U_Combining_Zigzag_Above = 0x035B,								//	U+035B	Combining Zigzag Above
    U_Combining_Double_Breve_Below = 0x035C,						//	U+035C	Combining Double Breve Below
    U_Combining_Double_Breve = 0x035D,								//	U+035D	Combining Double Breve
    U_Combining_Double_Macron = 0x035E,								//	U+035E	Combining Double Macron
    U_Combining_Double_Macron_Below = 0x035F,						//	U+035F	Combining Double Macron Below
    U_Combining_Double_Tilde = 0x0360,								//	U+0360	Combining Double Tilde
    U_Combining_Double_Inverted_Breve = 0x0361,						//	U+0361	Combining Double Inverted Breve
    U_Combining_Double_Rightwards_Arrow_Below = 0x0362,				//	U+0362	Combining Double Rightwards Arrow Below
    U_Combining_Latin_Small_Letter_A = 0x0363, 						//	U+0363	Combining Latin Small Letter A
    U_Combining_Latin_Small_Letter_E = 0x0364, 						//	U+0364	Combining Latin Small Letter E
    U_Combining_Latin_Small_Letter_I = 0x0365, 						//	U+0365	Combining Latin Small Letter I
    U_Combining_Latin_Small_Letter_O = 0x0366, 						//	U+0366	Combining Latin Small Letter O
    U_Combining_Latin_Small_Letter_U = 0x0367, 						//	U+0367	Combining Latin Small Letter U
    U_Combining_Latin_Small_Letter_C = 0x0368, 						//	U+0368	Combining Latin Small Letter C
    U_Combining_Latin_Small_Letter_D = 0x0369, 						//	U+0369	Combining Latin Small Letter D
    U_Combining_Latin_Small_Letter_H = 0x036A, 						//	U+036A	Combining Latin Small Letter H
    U_Combining_Latin_Small_Letter_M = 0x036B, 						//	U+036B	Combining Latin Small Letter M
    U_Combining_Latin_Small_Letter_R = 0x036C, 						//	U+036C	Combining Latin Small Letter R
    U_Combining_Latin_Small_Letter_T = 0x036D, 						//	U+036D	Combining Latin Small Letter T
    U_Combining_Latin_Small_Letter_V = 0x036E, 						//	U+036E	Combining Latin Small Letter V
    U_Combining_Latin_Small_Letter_X = 0x036F, 						//	U+036F	Combining Latin Small Letter X

    /**
	 * Unicode Character 'LINE SEPARATOR' (U+2028)
	 * http://www.fileformat.info/info/unicode/char/2028/index.htm
	 */
    LINE_SEPARATOR = 0x2028,
    /**
	 * Unicode Character 'PARAGRAPH SEPARATOR' (U+2029)
	 * http://www.fileformat.info/info/unicode/char/2029/index.htm
	 */
    PARAGRAPH_SEPARATOR = 0x2029,
    /**
	 * Unicode Character 'NEXT LINE' (U+0085)
	 * http://www.fileformat.info/info/unicode/char/0085/index.htm
	 */
    NEXT_LINE = 0x0085,

    // http://www.fileformat.info/info/unicode/category/Sk/list.htm
    U_CIRCUMFLEX = 0x005E,									// U+005E	CIRCUMFLEX
    U_GRAVE_ACCENT = 0x0060,								// U+0060	GRAVE ACCENT
    U_DIAERESIS = 0x00A8,									// U+00A8	DIAERESIS
    U_MACRON = 0x00AF,										// U+00AF	MACRON
    U_ACUTE_ACCENT = 0x00B4,								// U+00B4	ACUTE ACCENT
    U_CEDILLA = 0x00B8,										// U+00B8	CEDILLA
    U_MODIFIER_LETTER_LEFT_ARROWHEAD = 0x02C2,				// U+02C2	MODIFIER LETTER LEFT ARROWHEAD
    U_MODIFIER_LETTER_RIGHT_ARROWHEAD = 0x02C3,				// U+02C3	MODIFIER LETTER RIGHT ARROWHEAD
    U_MODIFIER_LETTER_UP_ARROWHEAD = 0x02C4,				// U+02C4	MODIFIER LETTER UP ARROWHEAD
    U_MODIFIER_LETTER_DOWN_ARROWHEAD = 0x02C5,				// U+02C5	MODIFIER LETTER DOWN ARROWHEAD
    U_MODIFIER_LETTER_CENTRED_RIGHT_HALF_RING = 0x02D2,		// U+02D2	MODIFIER LETTER CENTRED RIGHT HALF RING
    U_MODIFIER_LETTER_CENTRED_LEFT_HALF_RING = 0x02D3,		// U+02D3	MODIFIER LETTER CENTRED LEFT HALF RING
    U_MODIFIER_LETTER_UP_TACK = 0x02D4,						// U+02D4	MODIFIER LETTER UP TACK
    U_MODIFIER_LETTER_DOWN_TACK = 0x02D5,					// U+02D5	MODIFIER LETTER DOWN TACK
    U_MODIFIER_LETTER_PLUS_SIGN = 0x02D6,					// U+02D6	MODIFIER LETTER PLUS SIGN
    U_MODIFIER_LETTER_MINUS_SIGN = 0x02D7,					// U+02D7	MODIFIER LETTER MINUS SIGN
    U_BREVE = 0x02D8,										// U+02D8	BREVE
    U_DOT_ABOVE = 0x02D9,									// U+02D9	DOT ABOVE
    U_RING_ABOVE = 0x02DA,									// U+02DA	RING ABOVE
    U_OGONEK = 0x02DB,										// U+02DB	OGONEK
    U_SMALL_TILDE = 0x02DC,									// U+02DC	SMALL TILDE
    U_DOUBLE_ACUTE_ACCENT = 0x02DD,							// U+02DD	DOUBLE ACUTE ACCENT
    U_MODIFIER_LETTER_RHOTIC_HOOK = 0x02DE,					// U+02DE	MODIFIER LETTER RHOTIC HOOK
    U_MODIFIER_LETTER_CROSS_ACCENT = 0x02DF,				// U+02DF	MODIFIER LETTER CROSS ACCENT
    U_MODIFIER_LETTER_EXTRA_HIGH_TONE_BAR = 0x02E5,			// U+02E5	MODIFIER LETTER EXTRA-HIGH TONE BAR
    U_MODIFIER_LETTER_HIGH_TONE_BAR = 0x02E6,				// U+02E6	MODIFIER LETTER HIGH TONE BAR
    U_MODIFIER_LETTER_MID_TONE_BAR = 0x02E7,				// U+02E7	MODIFIER LETTER MID TONE BAR
    U_MODIFIER_LETTER_LOW_TONE_BAR = 0x02E8,				// U+02E8	MODIFIER LETTER LOW TONE BAR
    U_MODIFIER_LETTER_EXTRA_LOW_TONE_BAR = 0x02E9,			// U+02E9	MODIFIER LETTER EXTRA-LOW TONE BAR
    U_MODIFIER_LETTER_YIN_DEPARTING_TONE_MARK = 0x02EA,		// U+02EA	MODIFIER LETTER YIN DEPARTING TONE MARK
    U_MODIFIER_LETTER_YANG_DEPARTING_TONE_MARK = 0x02EB,	// U+02EB	MODIFIER LETTER YANG DEPARTING TONE MARK
    U_MODIFIER_LETTER_UNASPIRATED = 0x02ED,					// U+02ED	MODIFIER LETTER UNASPIRATED
    U_MODIFIER_LETTER_LOW_DOWN_ARROWHEAD = 0x02EF,			// U+02EF	MODIFIER LETTER LOW DOWN ARROWHEAD
    U_MODIFIER_LETTER_LOW_UP_ARROWHEAD = 0x02F0,			// U+02F0	MODIFIER LETTER LOW UP ARROWHEAD
    U_MODIFIER_LETTER_LOW_LEFT_ARROWHEAD = 0x02F1,			// U+02F1	MODIFIER LETTER LOW LEFT ARROWHEAD
    U_MODIFIER_LETTER_LOW_RIGHT_ARROWHEAD = 0x02F2,			// U+02F2	MODIFIER LETTER LOW RIGHT ARROWHEAD
    U_MODIFIER_LETTER_LOW_RING = 0x02F3,					// U+02F3	MODIFIER LETTER LOW RING
    U_MODIFIER_LETTER_MIDDLE_GRAVE_ACCENT = 0x02F4,			// U+02F4	MODIFIER LETTER MIDDLE GRAVE ACCENT
    U_MODIFIER_LETTER_MIDDLE_DOUBLE_GRAVE_ACCENT = 0x02F5,	// U+02F5	MODIFIER LETTER MIDDLE DOUBLE GRAVE ACCENT
    U_MODIFIER_LETTER_MIDDLE_DOUBLE_ACUTE_ACCENT = 0x02F6,	// U+02F6	MODIFIER LETTER MIDDLE DOUBLE ACUTE ACCENT
    U_MODIFIER_LETTER_LOW_TILDE = 0x02F7,					// U+02F7	MODIFIER LETTER LOW TILDE
    U_MODIFIER_LETTER_RAISED_COLON = 0x02F8,				// U+02F8	MODIFIER LETTER RAISED COLON
    U_MODIFIER_LETTER_BEGIN_HIGH_TONE = 0x02F9,				// U+02F9	MODIFIER LETTER BEGIN HIGH TONE
    U_MODIFIER_LETTER_END_HIGH_TONE = 0x02FA,				// U+02FA	MODIFIER LETTER END HIGH TONE
    U_MODIFIER_LETTER_BEGIN_LOW_TONE = 0x02FB,				// U+02FB	MODIFIER LETTER BEGIN LOW TONE
    U_MODIFIER_LETTER_END_LOW_TONE = 0x02FC,				// U+02FC	MODIFIER LETTER END LOW TONE
    U_MODIFIER_LETTER_SHELF = 0x02FD,						// U+02FD	MODIFIER LETTER SHELF
    U_MODIFIER_LETTER_OPEN_SHELF = 0x02FE,					// U+02FE	MODIFIER LETTER OPEN SHELF
    U_MODIFIER_LETTER_LOW_LEFT_ARROW = 0x02FF,				// U+02FF	MODIFIER LETTER LOW LEFT ARROW
    U_GREEK_LOWER_NUMERAL_SIGN = 0x0375,					// U+0375	GREEK LOWER NUMERAL SIGN
    U_GREEK_TONOS = 0x0384,									// U+0384	GREEK TONOS
    U_GREEK_DIALYTIKA_TONOS = 0x0385,						// U+0385	GREEK DIALYTIKA TONOS
    U_GREEK_KORONIS = 0x1FBD,								// U+1FBD	GREEK KORONIS
    U_GREEK_PSILI = 0x1FBF,									// U+1FBF	GREEK PSILI
    U_GREEK_PERISPOMENI = 0x1FC0,							// U+1FC0	GREEK PERISPOMENI
    U_GREEK_DIALYTIKA_AND_PERISPOMENI = 0x1FC1,				// U+1FC1	GREEK DIALYTIKA AND PERISPOMENI
    U_GREEK_PSILI_AND_VARIA = 0x1FCD,						// U+1FCD	GREEK PSILI AND VARIA
    U_GREEK_PSILI_AND_OXIA = 0x1FCE,						// U+1FCE	GREEK PSILI AND OXIA
    U_GREEK_PSILI_AND_PERISPOMENI = 0x1FCF,					// U+1FCF	GREEK PSILI AND PERISPOMENI
    U_GREEK_DASIA_AND_VARIA = 0x1FDD,						// U+1FDD	GREEK DASIA AND VARIA
    U_GREEK_DASIA_AND_OXIA = 0x1FDE,						// U+1FDE	GREEK DASIA AND OXIA
    U_GREEK_DASIA_AND_PERISPOMENI = 0x1FDF,					// U+1FDF	GREEK DASIA AND PERISPOMENI
    U_GREEK_DIALYTIKA_AND_VARIA = 0x1FED,					// U+1FED	GREEK DIALYTIKA AND VARIA
    U_GREEK_DIALYTIKA_AND_OXIA = 0x1FEE,					// U+1FEE	GREEK DIALYTIKA AND OXIA
    U_GREEK_VARIA = 0x1FEF,									// U+1FEF	GREEK VARIA
    U_GREEK_OXIA = 0x1FFD,									// U+1FFD	GREEK OXIA
    U_GREEK_DASIA = 0x1FFE,									// U+1FFE	GREEK DASIA

    U_IDEOGRAPHIC_FULL_STOP = 0x3002,						// U+3002	IDEOGRAPHIC FULL STOP
    U_LEFT_CORNER_BRACKET = 0x300C,							// U+300C	LEFT CORNER BRACKET
    U_RIGHT_CORNER_BRACKET = 0x300D,						// U+300D	RIGHT CORNER BRACKET
    U_LEFT_BLACK_LENTICULAR_BRACKET = 0x3010,				// U+3010	LEFT BLACK LENTICULAR BRACKET
    U_RIGHT_BLACK_LENTICULAR_BRACKET = 0x3011,				// U+3011	RIGHT BLACK LENTICULAR BRACKET

    U_OVERLINE = 0x203E, // Unicode Character 'OVERLINE'

    /**
	 * UTF-8 BOM
	 * Unicode Character 'ZERO WIDTH NO-BREAK SPACE' (U+FEFF)
	 * http://www.fileformat.info/info/unicode/char/feff/index.htm
	 */
    UTF8_BOM = 65279,

    U_FULLWIDTH_SEMICOLON = 0xFF1B,							// U+FF1B	FULLWIDTH SEMICOLON
    U_FULLWIDTH_COMMA = 0xFF0C,								// U+FF0C	FULLWIDTH COMMA
}

/** allow register constant context keys that are known only after startup; requires running `substituteConstants` on the context key - https://github.com/microsoft/vscode/issues/174218#issuecomment-1437972127 */
export function setConstant(key: string, value: boolean) {
    // if (CONSTANT_VALUES.get(key) !== undefined) { throw Exception('contextkey.setConstant(k, v) invoked with already set constant `k`'); }

    CONSTANT_VALUES.set(key, value);
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

export function isFalsyOrWhitespace(str: string | undefined): boolean {
    if (!str || typeof str !== 'string') {
        return true;
    }
    return str.trim().length === 0;
}

export const enum ContextKeyExprType {
    False = 0,
    True = 1,
    Defined = 2,
    Not = 3,
    Equals = 4,
    NotEquals = 5,
    And = 6,
    Regex = 7,
    NotRegex = 8,
    Or = 9,
    In = 10,
    NotIn = 11,
    Greater = 12,
    GreaterEquals = 13,
    Smaller = 14,
    SmallerEquals = 15,
}

export interface IContextKeyExprMapper {
    mapDefined(key: string): ContextKeyExpression;
    mapNot(key: string): ContextKeyExpression;
    mapEquals(key: string, value: any): ContextKeyExpression;
    mapNotEquals(key: string, value: any): ContextKeyExpression;
    mapGreater(key: string, value: any): ContextKeyExpression;
    mapGreaterEquals(key: string, value: any): ContextKeyExpression;
    mapSmaller(key: string, value: any): ContextKeyExpression;
    mapSmallerEquals(key: string, value: any): ContextKeyExpression;
    mapRegex(key: string, regexp: RegExp | null): ContextKeyRegexExpr;
    mapIn(key: string, valueKey: string): ContextKeyInExpr;
    mapNotIn(key: string, valueKey: string): ContextKeyNotInExpr;
}

export interface IContextKeyExpression {
    cmp(other: ContextKeyExpression): number;
    equals(other: ContextKeyExpression): boolean;
    substituteConstants(): ContextKeyExpression | undefined;
    evaluate(context: IContext): boolean;
    serialize(): string;
    keys(): string[];
    map(mapFnc: IContextKeyExprMapper): ContextKeyExpression;
    negate(): ContextKeyExpression;

}

export type ContextKeyExpression = (
	ContextKeyFalseExpr | ContextKeyTrueExpr | ContextKeyDefinedExpr | ContextKeyNotExpr
	| ContextKeyEqualsExpr | ContextKeyNotEqualsExpr | ContextKeyRegexExpr
	| ContextKeyNotRegexExpr | ContextKeyAndExpr | ContextKeyOrExpr | ContextKeyInExpr
	| ContextKeyNotInExpr | ContextKeyGreaterExpr | ContextKeyGreaterEqualsExpr
	| ContextKeySmallerExpr | ContextKeySmallerEqualsExpr
);

/*

Syntax grammar:

```ebnf

expression ::= or

or ::= and { '||' and }*

and ::= term { '&&' term }*

term ::=
	| '!' (KEY | true | false | parenthesized)
	| primary

primary ::=
	| 'true'
	| 'false'
	| parenthesized
	| KEY '=~' REGEX
	| KEY [ ('==' | '!=' | '<' | '<=' | '>' | '>=' | 'not' 'in' | 'in') value ]

parenthesized ::=
	| '(' expression ')'

value ::=
	| 'true'
	| 'false'
	| 'in'      	// we support `in` as a value because there's an extension that uses it, ie "when": "languageId == in"
	| VALUE 		// matched by the same regex as KEY; consider putting the value in single quotes if it's a string (e.g., with spaces)
	| SINGLE_QUOTED_STR
	| EMPTY_STR  	// this allows "when": "foo == " which's used by existing extensions

```
*/

export type ParserConfig = {
    /**
	 * with this option enabled, the parser can recover from regex parsing errors, e.g., unescaped slashes: `/src//` is accepted as `/src\//` would be
	 */
    regexParsingWithErrorRecovery: boolean;
};

const defaultConfig: ParserConfig = {
    regexParsingWithErrorRecovery: true
};

export type ParsingError = {
    message: string;
    offset: number;
    lexeme: string;
    additionalInfo?: string;
};

const errorEmptyString = localize('contextkey.parser.error.emptyString', "Empty context key expression");
const hintEmptyString = localize('contextkey.parser.error.emptyString.hint', "Did you forget to write an expression? You can also put 'false' or 'true' to always evaluate to false or true, respectively.");
const errorNoInAfterNot = localize('contextkey.parser.error.noInAfterNot', "'in' after 'not'.");
const errorClosingParenthesis = localize('contextkey.parser.error.closingParenthesis', "closing parenthesis ')'");
const errorUnexpectedToken = localize('contextkey.parser.error.unexpectedToken', "Unexpected token");
const hintUnexpectedToken = localize('contextkey.parser.error.unexpectedToken.hint', "Did you forget to put && or || before the token?");
const errorUnexpectedEOF = localize('contextkey.parser.error.unexpectedEOF', "Unexpected end of expression");
const hintUnexpectedEOF = localize('contextkey.parser.error.unexpectedEOF.hint', "Did you forget to put a context key?");

/**
 * A parser for context key expressions.
 *
 * Example:
 * ```ts
 * const parser = new Parser();
 * const expr = parser.parse('foo == "bar" && baz == true');
 *
 * if (expr === undefined) {
 * 	// there were lexing or parsing errors
 * 	// process lexing errors with `parser.lexingErrors`
 *  // process parsing errors with `parser.parsingErrors`
 * } else {
 * 	// expr is a valid expression
 * }
 * ```
 */
export class Parser {
    // Note: this doesn't produce an exact syntax tree but a normalized one
    // ContextKeyExpression's that we use as AST nodes do not expose constructors that do not normalize

    private static _parseError = new Error();

    // lifetime note: `_scanner` lives as long as the parser does, i.e., is not reset between calls to `parse`
    private readonly _scanner = new Scanner();

    // lifetime note: `_tokens`, `_current`, and `_parsingErrors` must be reset between calls to `parse`
    private _tokens: Token[] = [];
    private _current = 0; 					// invariant: 0 <= this._current < this._tokens.length ; any incrementation of this value must first call `_isAtEnd`
    private _parsingErrors: ParsingError[] = [];

    get lexingErrors(): Readonly<LexingError[]> {
        return this._scanner.errors;
    }

    get parsingErrors(): Readonly<ParsingError[]> {
        return this._parsingErrors;
    }

    constructor(private readonly _config: ParserConfig = defaultConfig) {
    }

    /**
	 * Parse a context key expression.
	 *
	 * @param input the expression to parse
	 * @returns the parsed expression or `undefined` if there's an error - call `lexingErrors` and `parsingErrors` to see the errors
	 */
    parse(input: string): ContextKeyExpression | undefined {

        if (input === '') {
            this._parsingErrors.push({ message: errorEmptyString, offset: 0, lexeme: '', additionalInfo: hintEmptyString });
            return undefined;
        }

        this._tokens = this._scanner.reset(input).scan();
        // @ulugbekna: we do not stop parsing if there are lexing errors to be able to reconstruct regexes with unescaped slashes; TODO@ulugbekna: make this respect config option for recovery

        this._current = 0;
        this._parsingErrors = [];

        try {
            const expr = this._expr();
            if (!this._isAtEnd()) {
                const peek = this._peek();
                const additionalInfo = peek.type === TokenType.Str ? hintUnexpectedToken : undefined;
                this._parsingErrors.push({ message: errorUnexpectedToken, offset: peek.offset, lexeme: Scanner.getLexeme(peek), additionalInfo });
                throw Parser._parseError;
            }
            return expr;
        } catch (e) {
            if (!(e === Parser._parseError)) {
                throw e;
            }
            return undefined;
        }
    }

    private _expr(): ContextKeyExpression | undefined {
        return this._or();
    }

    private _or(): ContextKeyExpression | undefined {
        const expr = [this._and()];

        while (this._matchOne(TokenType.Or)) {
            const right = this._and();
            expr.push(right);
        }

        return expr.length === 1 ? expr[0] : ContextKeyExpr.or(...expr);
    }

    private _and(): ContextKeyExpression | undefined {
        const expr = [this._term()];

        while (this._matchOne(TokenType.And)) {
            const right = this._term();
            expr.push(right);
        }

        return expr.length === 1 ? expr[0] : ContextKeyExpr.and(...expr);
    }

    private _term(): ContextKeyExpression | undefined {
        if (this._matchOne(TokenType.Neg)) {
            const peek = this._peek();
            switch (peek.type) {
                case TokenType.True:
                    this._advance();
                    return ContextKeyFalseExpr.INSTANCE;
                case TokenType.False:
                    this._advance();
                    return ContextKeyTrueExpr.INSTANCE;
                case TokenType.LParen: {
                    this._advance();
                    const expr = this._expr();
                    this._consume(TokenType.RParen, errorClosingParenthesis);
                    return expr?.negate();
                }
                case TokenType.Str:
                    this._advance();
                    return ContextKeyNotExpr.create(peek.lexeme);
                default:
                    throw this._errExpectedButGot(`KEY | true | false | '(' expression ')'`, peek);
            }
        }
        return this._primary();
    }

    private _primary(): ContextKeyExpression | undefined {

        const peek = this._peek();
        switch (peek.type) {
            case TokenType.True:
                this._advance();
                return ContextKeyExpr.true();

            case TokenType.False:
                this._advance();
                return ContextKeyExpr.false();

            case TokenType.LParen: {
                this._advance();
                const expr = this._expr();
                this._consume(TokenType.RParen, errorClosingParenthesis);
                return expr;
            }

            case TokenType.Str: {
                // KEY
                const key = peek.lexeme;
                this._advance();

                // =~ regex
                if (this._matchOne(TokenType.RegexOp)) {

                    // @ulugbekna: we need to reconstruct the regex from the tokens because some extensions use unescaped slashes in regexes
                    const expr = this._peek();

                    if (!this._config.regexParsingWithErrorRecovery) {
                        this._advance();
                        if (expr.type !== TokenType.RegexStr) {
                            throw this._errExpectedButGot(`REGEX`, expr);
                        }
                        const regexLexeme = expr.lexeme;
                        const closingSlashIndex = regexLexeme.lastIndexOf('/');
                        const flags = closingSlashIndex === regexLexeme.length - 1 ? undefined : this._removeFlagsGY(regexLexeme.substring(closingSlashIndex + 1));
                        let regexp: RegExp | null;
                        try {
                            regexp = new RegExp(regexLexeme.substring(1, closingSlashIndex), flags);
                        } catch (e) {
                            throw this._errExpectedButGot(`REGEX`, expr);
                        }
                        return ContextKeyRegexExpr.create(key, regexp);
                    }

                    switch (expr.type) {
                        case TokenType.RegexStr:
                        case TokenType.Error: { // also handle an ErrorToken in case of smth such as /(/file)/
                            const lexemeReconstruction = [expr.lexeme]; // /REGEX/ or /REGEX/FLAGS
                            this._advance();

                            let followingToken = this._peek();
                            let parenBalance = 0;
                            for (let i = 0; i < expr.lexeme.length; i++) {
                                if (expr.lexeme.charCodeAt(i) === CharCode.OpenParen) {
                                    parenBalance++;
                                } else if (expr.lexeme.charCodeAt(i) === CharCode.CloseParen) {
                                    parenBalance--;
                                }
                            }

                            while (!this._isAtEnd() && followingToken.type !== TokenType.And && followingToken.type !== TokenType.Or) {
                                switch (followingToken.type) {
                                    case TokenType.LParen:
                                        parenBalance++;
                                        break;
                                    case TokenType.RParen:
                                        parenBalance--;
                                        break;
                                    case TokenType.RegexStr:
                                    case TokenType.QuotedStr:
                                        for (let i = 0; i < followingToken.lexeme.length; i++) {
                                            if (followingToken.lexeme.charCodeAt(i) === CharCode.OpenParen) {
                                                parenBalance++;
                                            } else if (expr.lexeme.charCodeAt(i) === CharCode.CloseParen) {
                                                parenBalance--;
                                            }
                                        }
                                }
                                if (parenBalance < 0) {
                                    break;
                                }
                                lexemeReconstruction.push(Scanner.getLexeme(followingToken));
                                this._advance();
                                followingToken = this._peek();
                            }

                            const regexLexeme = lexemeReconstruction.join('');
                            const closingSlashIndex = regexLexeme.lastIndexOf('/');
                            const flags = closingSlashIndex === regexLexeme.length - 1 ? undefined : this._removeFlagsGY(regexLexeme.substring(closingSlashIndex + 1));
                            let regexp: RegExp | null;
                            try {
                                regexp = new RegExp(regexLexeme.substring(1, closingSlashIndex), flags);
                            } catch (e) {
                                throw this._errExpectedButGot(`REGEX`, expr);
                            }
                            return ContextKeyExpr.regex(key, regexp);
                        }

                        case TokenType.QuotedStr: {
                            const serializedValue = expr.lexeme;
                            this._advance();
                            // replicate old regex parsing behavior

                            let regex: RegExp | null = null;

                            if (!isFalsyOrWhitespace(serializedValue)) {
                                const start = serializedValue.indexOf('/');
                                const end = serializedValue.lastIndexOf('/');
                                if (start !== end && start >= 0) {

                                    const value = serializedValue.slice(start + 1, end);
                                    const caseIgnoreFlag = serializedValue[end + 1] === 'i' ? 'i' : '';
                                    try {
                                        regex = new RegExp(value, caseIgnoreFlag);
                                    } catch (_e) {
                                        throw this._errExpectedButGot(`REGEX`, expr);
                                    }
                                }
                            }

                            if (regex === null) {
                                throw this._errExpectedButGot('REGEX', expr);
                            }

                            return ContextKeyRegexExpr.create(key, regex);
                        }

                        default:
                            throw this._errExpectedButGot('REGEX', this._peek());
                    }
                }

                // [ 'not' 'in' value ]
                if (this._matchOne(TokenType.Not)) {
                    this._consume(TokenType.In, errorNoInAfterNot);
                    const right = this._value();
                    return ContextKeyExpr.notIn(key, right);
                }

                // [ ('==' | '!=' | '<' | '<=' | '>' | '>=' | 'in') value ]
                const maybeOp = this._peek().type;
                switch (maybeOp) {
                    case TokenType.Eq: {
                        this._advance();

                        const right = this._value();
                        if (this._previous().type === TokenType.QuotedStr) { // to preserve old parser behavior: "foo == 'true'" is preserved as "foo == 'true'", but "foo == true" is optimized as "foo"
                            return ContextKeyExpr.equals(key, right);
                        }
                        switch (right) {
                            case 'true':
                                return ContextKeyExpr.has(key);
                            case 'false':
                                return ContextKeyExpr.not(key);
                            default:
                                return ContextKeyExpr.equals(key, right);
                        }
                    }

                    case TokenType.NotEq: {
                        this._advance();

                        const right = this._value();
                        if (this._previous().type === TokenType.QuotedStr) { // same as above with "foo != 'true'"
                            return ContextKeyExpr.notEquals(key, right);
                        }
                        switch (right) {
                            case 'true':
                                return ContextKeyExpr.not(key);
                            case 'false':
                                return ContextKeyExpr.has(key);
                            default:
                                return ContextKeyExpr.notEquals(key, right);
                        }
                    }
                    // TODO: ContextKeyExpr.smaller(key, right) accepts only `number` as `right` AND during eval of this node, we just eval to `false` if `right` is not a number
                    // consequently, package.json linter should _warn_ the user if they're passing undesired things to ops
                    case TokenType.Lt:
                        this._advance();
                        return ContextKeySmallerExpr.create(key, this._value());

                    case TokenType.LtEq:
                        this._advance();
                        return ContextKeySmallerEqualsExpr.create(key, this._value());

                    case TokenType.Gt:
                        this._advance();
                        return ContextKeyGreaterExpr.create(key, this._value());

                    case TokenType.GtEq:
                        this._advance();
                        return ContextKeyGreaterEqualsExpr.create(key, this._value());

                    case TokenType.In:
                        this._advance();
                        return ContextKeyExpr.in(key, this._value());

                    default:
                        return ContextKeyExpr.has(key);
                }
            }

            case TokenType.EOF:
                this._parsingErrors.push({ message: errorUnexpectedEOF, offset: peek.offset, lexeme: '', additionalInfo: hintUnexpectedEOF });
                throw Parser._parseError;

            default:
                throw this._errExpectedButGot(`true | false | KEY \n\t| KEY '=~' REGEX \n\t| KEY ('==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not' 'in') value`, this._peek());

        }
    }

    private _value(): string {
        const token = this._peek();
        switch (token.type) {
            case TokenType.Str:
            case TokenType.QuotedStr:
                this._advance();
                return token.lexeme;
            case TokenType.True:
                this._advance();
                return 'true';
            case TokenType.False:
                this._advance();
                return 'false';
            case TokenType.In: // we support `in` as a value, e.g., "when": "languageId == in" - exists in existing extensions
                this._advance();
                return 'in';
            default:
                // this allows "when": "foo == " which's used by existing extensions
                // we do not call `_advance` on purpose - we don't want to eat unintended tokens
                return '';
        }
    }

    private _flagsGYRe = /g|y/g;
    private _removeFlagsGY(flags: string): string {
        return flags.replace(this._flagsGYRe, '');
    }

    // careful: this can throw if current token is the initial one (ie index = 0)
    private _previous() {
        return this._tokens[this._current - 1];
    }

    private _matchOne(token: TokenType) {
        if (this._check(token)) {
            this._advance();
            return true;
        }

        return false;
    }

    private _advance() {
        if (!this._isAtEnd()) {
            this._current++;
        }
        return this._previous();
    }

    private _consume(type: TokenType, message: string) {
        if (this._check(type)) {
            return this._advance();
        }

        throw this._errExpectedButGot(message, this._peek());
    }

    private _errExpectedButGot(expected: string, got: Token, additionalInfo?: string) {
        const message = localize('contextkey.parser.error.expectedButGot', "Expected: {0}\nReceived: '{1}'.", expected, Scanner.getLexeme(got));
        const offset = got.offset;
        const lexeme = Scanner.getLexeme(got);
        this._parsingErrors.push({ message, offset, lexeme, additionalInfo });
        return Parser._parseError;
    }

    private _check(type: TokenType) {
        return this._peek().type === type;
    }

    private _peek() {
        return this._tokens[this._current];
    }

    private _isAtEnd() {
        return this._peek().type === TokenType.EOF;
    }
}

export abstract class ContextKeyExpr {

    public static false(): ContextKeyExpression {
        return ContextKeyFalseExpr.INSTANCE;
    }
    public static true(): ContextKeyExpression {
        return ContextKeyTrueExpr.INSTANCE;
    }
    public static has(key: string): ContextKeyExpression {
        return ContextKeyDefinedExpr.create(key);
    }
    public static equals(key: string, value: any): ContextKeyExpression {
        return ContextKeyEqualsExpr.create(key, value);
    }
    public static notEquals(key: string, value: any): ContextKeyExpression {
        return ContextKeyNotEqualsExpr.create(key, value);
    }
    public static regex(key: string, value: RegExp): ContextKeyExpression {
        return ContextKeyRegexExpr.create(key, value);
    }
    public static in(key: string, value: string): ContextKeyExpression {
        return ContextKeyInExpr.create(key, value);
    }
    public static notIn(key: string, value: string): ContextKeyExpression {
        return ContextKeyNotInExpr.create(key, value);
    }
    public static not(key: string): ContextKeyExpression {
        return ContextKeyNotExpr.create(key);
    }
    public static and(...expr: Array<ContextKeyExpression | undefined | null>): ContextKeyExpression | undefined {
        return ContextKeyAndExpr.create(expr, null, true);
    }
    public static or(...expr: Array<ContextKeyExpression | undefined | null>): ContextKeyExpression | undefined {
        return ContextKeyOrExpr.create(expr, null, true);
    }
    public static greater(key: string, value: number): ContextKeyExpression {
        return ContextKeyGreaterExpr.create(key, value);
    }
    public static greaterEquals(key: string, value: number): ContextKeyExpression {
        return ContextKeyGreaterEqualsExpr.create(key, value);
    }
    public static smaller(key: string, value: number): ContextKeyExpression {
        return ContextKeySmallerExpr.create(key, value);
    }
    public static smallerEquals(key: string, value: number): ContextKeyExpression {
        return ContextKeySmallerEqualsExpr.create(key, value);
    }

    private static _parser = new Parser({ regexParsingWithErrorRecovery: false });
    public static deserialize(serialized: string | null | undefined): ContextKeyExpression | undefined {
        if (serialized === undefined || serialized === null) { // an empty string needs to be handled by the parser to get a corresponding parsing error reported
            return undefined;
        }

        const expr = this._parser.parse(serialized);
        return expr;
    }

}

export function validateWhenClauses(whenClauses: string[]): any {

    const parser = new Parser({ regexParsingWithErrorRecovery: false }); // we run with no recovery to guide users to use correct regexes

    return whenClauses.map(whenClause => {
        parser.parse(whenClause);

        if (parser.lexingErrors.length > 0) {
            return parser.lexingErrors.map((se: LexingError) => ({
                errorMessage: se.additionalInfo ?
                    localize('contextkey.scanner.errorForLinterWithHint', "Unexpected token. Hint: {0}", se.additionalInfo) :
                    localize('contextkey.scanner.errorForLinter', "Unexpected token."),
                offset: se.offset,
                length: se.lexeme.length
            }));
        } else if (parser.parsingErrors.length > 0) {
            return parser.parsingErrors.map((pe: ParsingError) => ({
                errorMessage: pe.additionalInfo ? `${pe.message}. ${pe.additionalInfo}` : pe.message,
                offset: pe.offset,
                length: pe.lexeme.length
            }));
        } else {
            return [];
        }
    });
}

export function expressionsAreEqualWithConstantSubstitution(a: ContextKeyExpression | null | undefined, b: ContextKeyExpression | null | undefined): boolean {
    const aExpr = a ? a.substituteConstants() : undefined;
    const bExpr = b ? b.substituteConstants() : undefined;
    if (!aExpr && !bExpr) {
        return true;
    }
    if (!aExpr || !bExpr) {
        return false;
    }
    return aExpr.equals(bExpr);
}

function cmp(a: ContextKeyExpression, b: ContextKeyExpression): number {
    return a.cmp(b);
}

export class ContextKeyFalseExpr implements IContextKeyExpression {
    public static INSTANCE = new ContextKeyFalseExpr();

    public readonly type = ContextKeyExprType.False;

    protected constructor() {
    }

    public cmp(other: ContextKeyExpression): number {
        return this.type - other.type;
    }

    public equals(other: ContextKeyExpression): boolean {
        return (other.type === this.type);
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(_context: IContext): boolean {
        return false;
    }

    public serialize(): string {
        return 'false';
    }

    public keys(): string[] {
        return [];
    }

    public map(_mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return this;
    }

    public negate(): ContextKeyExpression {
        return ContextKeyTrueExpr.INSTANCE;
    }
}

export class ContextKeyTrueExpr implements IContextKeyExpression {
    public static INSTANCE = new ContextKeyTrueExpr();

    public readonly type = ContextKeyExprType.True;

    protected constructor() {
    }

    public cmp(other: ContextKeyExpression): number {
        return this.type - other.type;
    }

    public equals(other: ContextKeyExpression): boolean {
        return (other.type === this.type);
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(_context: IContext): boolean {
        return true;
    }

    public serialize(): string {
        return 'true';
    }

    public keys(): string[] {
        return [];
    }

    public map(_mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return this;
    }

    public negate(): ContextKeyExpression {
        return ContextKeyFalseExpr.INSTANCE;
    }
}

export class ContextKeyDefinedExpr implements IContextKeyExpression {
    public static create(key: string, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        const constantValue = CONSTANT_VALUES.get(key);
        if (typeof constantValue === 'boolean') {
            return constantValue ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE;
        }
        return new ContextKeyDefinedExpr(key, negated);
    }

    public readonly type = ContextKeyExprType.Defined;

    protected constructor(
        readonly key: string,
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp1(this.key, other.key);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        const constantValue = CONSTANT_VALUES.get(this.key);
        if (typeof constantValue === 'boolean') {
            return constantValue ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE;
        }
        return this;
    }

    public evaluate(context: IContext): boolean {
        return (!!context.getValue(this.key));
    }

    public serialize(): string {
        return this.key;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapDefined(this.key);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyNotExpr.create(this.key, this);
        }
        return this.negated;
    }
}

export class ContextKeyEqualsExpr implements IContextKeyExpression {

    public static create(key: string, value: any, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        if (typeof value === 'boolean') {
            return (value ? ContextKeyDefinedExpr.create(key, negated) : ContextKeyNotExpr.create(key, negated));
        }
        const constantValue = CONSTANT_VALUES.get(key);
        if (typeof constantValue === 'boolean') {
            const trueValue = constantValue ? 'true' : 'false';
            return (value === trueValue ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE);
        }
        return new ContextKeyEqualsExpr(key, value, negated);
    }

    public readonly type = ContextKeyExprType.Equals;

    private constructor(
        private readonly key: string,
        private readonly value: any,
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp2(this.key, this.value, other.key, other.value);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key && this.value === other.value);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        const constantValue = CONSTANT_VALUES.get(this.key);
        if (typeof constantValue === 'boolean') {
            const trueValue = constantValue ? 'true' : 'false';
            return (this.value === trueValue ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE);
        }
        return this;
    }

    public evaluate(context: IContext): boolean {
        // Intentional ==
        // eslint-disable-next-line eqeqeq
        return (context.getValue(this.key) == this.value);
    }

    public serialize(): string {
        return `${this.key} == '${this.value}'`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapEquals(this.key, this.value);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyNotEqualsExpr.create(this.key, this.value, this);
        }
        return this.negated;
    }
}

export class ContextKeyInExpr implements IContextKeyExpression {

    public static create(key: string, valueKey: string): ContextKeyInExpr {
        return new ContextKeyInExpr(key, valueKey);
    }

    public readonly type = ContextKeyExprType.In;
    private negated: ContextKeyExpression | null = null;

    private constructor(
        private readonly key: string,
        private readonly valueKey: string
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp2(this.key, this.valueKey, other.key, other.valueKey);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key && this.valueKey === other.valueKey);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        const source = context.getValue(this.valueKey);

        const item = context.getValue(this.key);

        if (Array.isArray(source)) {
            return source.includes(item as any);
        }

        if (typeof item === 'string' && typeof source === 'object' && source !== null) {
            return hasOwnProperty.call(source, item);
        }
        return false;
    }

    public serialize(): string {
        return `${this.key} in '${this.valueKey}'`;
    }

    public keys(): string[] {
        return [this.key, this.valueKey];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyInExpr {
        return mapFnc.mapIn(this.key, this.valueKey);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyNotInExpr.create(this.key, this.valueKey);
        }
        return this.negated;
    }
}

export class ContextKeyNotInExpr implements IContextKeyExpression {

    public static create(key: string, valueKey: string): ContextKeyNotInExpr {
        return new ContextKeyNotInExpr(key, valueKey);
    }

    public readonly type = ContextKeyExprType.NotIn;

    private readonly _negated: ContextKeyInExpr;

    private constructor(
        private readonly key: string,
        private readonly valueKey: string
    ) {
        this._negated = ContextKeyInExpr.create(key, valueKey);
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return this._negated.cmp(other._negated);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return this._negated.equals(other._negated);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        return !this._negated.evaluate(context);
    }

    public serialize(): string {
        return `${this.key} not in '${this.valueKey}'`;
    }

    public keys(): string[] {
        return this._negated.keys();
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapNotIn(this.key, this.valueKey);
    }

    public negate(): ContextKeyExpression {
        return this._negated;
    }
}

export class ContextKeyNotEqualsExpr implements IContextKeyExpression {

    public static create(key: string, value: any, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        if (typeof value === 'boolean') {
            if (value) {
                return ContextKeyNotExpr.create(key, negated);
            }
            return ContextKeyDefinedExpr.create(key, negated);
        }
        const constantValue = CONSTANT_VALUES.get(key);
        if (typeof constantValue === 'boolean') {
            const falseValue = constantValue ? 'true' : 'false';
            return (value === falseValue ? ContextKeyFalseExpr.INSTANCE : ContextKeyTrueExpr.INSTANCE);
        }
        return new ContextKeyNotEqualsExpr(key, value, negated);
    }

    public readonly type = ContextKeyExprType.NotEquals;

    private constructor(
        private readonly key: string,
        private readonly value: any,
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp2(this.key, this.value, other.key, other.value);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key && this.value === other.value);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        const constantValue = CONSTANT_VALUES.get(this.key);
        if (typeof constantValue === 'boolean') {
            const falseValue = constantValue ? 'true' : 'false';
            return (this.value === falseValue ? ContextKeyFalseExpr.INSTANCE : ContextKeyTrueExpr.INSTANCE);
        }
        return this;
    }

    public evaluate(context: IContext): boolean {
        // Intentional !=
        // eslint-disable-next-line eqeqeq
        return (context.getValue(this.key) != this.value);
    }

    public serialize(): string {
        return `${this.key} != '${this.value}'`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapNotEquals(this.key, this.value);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyEqualsExpr.create(this.key, this.value, this);
        }
        return this.negated;
    }
}

export class ContextKeyNotExpr implements IContextKeyExpression {

    public static create(key: string, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        const constantValue = CONSTANT_VALUES.get(key);
        if (typeof constantValue === 'boolean') {
            return (constantValue ? ContextKeyFalseExpr.INSTANCE : ContextKeyTrueExpr.INSTANCE);
        }
        return new ContextKeyNotExpr(key, negated);
    }

    public readonly type = ContextKeyExprType.Not;

    private constructor(
        private readonly key: string,
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp1(this.key, other.key);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        const constantValue = CONSTANT_VALUES.get(this.key);
        if (typeof constantValue === 'boolean') {
            return (constantValue ? ContextKeyFalseExpr.INSTANCE : ContextKeyTrueExpr.INSTANCE);
        }
        return this;
    }

    public evaluate(context: IContext): boolean {
        return (!context.getValue(this.key));
    }

    public serialize(): string {
        return `!${this.key}`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapNot(this.key);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyDefinedExpr.create(this.key, this);
        }
        return this.negated;
    }
}

function withFloatOrStr<T extends ContextKeyExpression>(value: any, callback: (value: number | string) => T): T | ContextKeyFalseExpr {
    if (typeof value === 'string') {
        const n = parseFloat(value);
        if (!isNaN(n)) {
            value = n;
        }
    }
    if (typeof value === 'string' || typeof value === 'number') {
        return callback(value);
    }
    return ContextKeyFalseExpr.INSTANCE;
}

export class ContextKeyGreaterExpr implements IContextKeyExpression {

    public static create(key: string, _value: any, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        return withFloatOrStr(_value, (value) => new ContextKeyGreaterExpr(key, value, negated));
    }

    public readonly type = ContextKeyExprType.Greater;

    private constructor(
        private readonly key: string,
        private readonly value: number | string,
        private negated: ContextKeyExpression | null
    ) { }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp2(this.key, this.value, other.key, other.value);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key && this.value === other.value);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        if (typeof this.value === 'string') {
            return false;
        }
        return (parseFloat(<any>context.getValue(this.key)) > this.value);
    }

    public serialize(): string {
        return `${this.key} > ${this.value}`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapGreater(this.key, this.value);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeySmallerEqualsExpr.create(this.key, this.value, this);
        }
        return this.negated;
    }
}

export class ContextKeyGreaterEqualsExpr implements IContextKeyExpression {

    public static create(key: string, _value: any, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        return withFloatOrStr(_value, (value) => new ContextKeyGreaterEqualsExpr(key, value, negated));
    }

    public readonly type = ContextKeyExprType.GreaterEquals;

    private constructor(
        private readonly key: string,
        private readonly value: number | string,
        private negated: ContextKeyExpression | null
    ) { }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp2(this.key, this.value, other.key, other.value);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key && this.value === other.value);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        if (typeof this.value === 'string') {
            return false;
        }
        return (parseFloat(<any>context.getValue(this.key)) >= this.value);
    }

    public serialize(): string {
        return `${this.key} >= ${this.value}`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapGreaterEquals(this.key, this.value);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeySmallerExpr.create(this.key, this.value, this);
        }
        return this.negated;
    }
}

export class ContextKeySmallerExpr implements IContextKeyExpression {

    public static create(key: string, _value: any, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        return withFloatOrStr(_value, (value) => new ContextKeySmallerExpr(key, value, negated));
    }

    public readonly type = ContextKeyExprType.Smaller;

    private constructor(
        private readonly key: string,
        private readonly value: number | string,
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp2(this.key, this.value, other.key, other.value);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key && this.value === other.value);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        if (typeof this.value === 'string') {
            return false;
        }
        return (parseFloat(<any>context.getValue(this.key)) < this.value);
    }

    public serialize(): string {
        return `${this.key} < ${this.value}`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapSmaller(this.key, this.value);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyGreaterEqualsExpr.create(this.key, this.value, this);
        }
        return this.negated;
    }
}

export class ContextKeySmallerEqualsExpr implements IContextKeyExpression {

    public static create(key: string, _value: any, negated: ContextKeyExpression | null = null): ContextKeyExpression {
        return withFloatOrStr(_value, (value) => new ContextKeySmallerEqualsExpr(key, value, negated));
    }

    public readonly type = ContextKeyExprType.SmallerEquals;

    private constructor(
        private readonly key: string,
        private readonly value: number | string,
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return cmp2(this.key, this.value, other.key, other.value);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return (this.key === other.key && this.value === other.value);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        if (typeof this.value === 'string') {
            return false;
        }
        return (parseFloat(<any>context.getValue(this.key)) <= this.value);
    }

    public serialize(): string {
        return `${this.key} <= ${this.value}`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return mapFnc.mapSmallerEquals(this.key, this.value);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyGreaterExpr.create(this.key, this.value, this);
        }
        return this.negated;
    }
}

export class ContextKeyRegexExpr implements IContextKeyExpression {

    public static create(key: string, regexp: RegExp | null): ContextKeyRegexExpr {
        return new ContextKeyRegexExpr(key, regexp);
    }

    public readonly type = ContextKeyExprType.Regex;
    private negated: ContextKeyExpression | null = null;

    private constructor(
        private readonly key: string,
        private readonly regexp: RegExp | null
    ) {
        //
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        if (this.key < other.key) {
            return -1;
        }
        if (this.key > other.key) {
            return 1;
        }
        const thisSource = this.regexp ? this.regexp.source : '';
        const otherSource = other.regexp ? other.regexp.source : '';
        if (thisSource < otherSource) {
            return -1;
        }
        if (thisSource > otherSource) {
            return 1;
        }
        return 0;
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            const thisSource = this.regexp ? this.regexp.source : '';
            const otherSource = other.regexp ? other.regexp.source : '';
            return (this.key === other.key && thisSource === otherSource);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        const value = context.getValue<any>(this.key);
        return this.regexp ? this.regexp.test(value) : false;
    }

    public serialize(): string {
        const value = this.regexp
            ? `/${this.regexp.source}/${this.regexp.flags}`
            : '/invalid/';
        return `${this.key} =~ ${value}`;
    }

    public keys(): string[] {
        return [this.key];
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyRegexExpr {
        return mapFnc.mapRegex(this.key, this.regexp);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            this.negated = ContextKeyNotRegexExpr.create(this);
        }
        return this.negated;
    }
}

export class ContextKeyNotRegexExpr implements IContextKeyExpression {

    public static create(actual: ContextKeyRegexExpr): ContextKeyExpression {
        return new ContextKeyNotRegexExpr(actual);
    }

    public readonly type = ContextKeyExprType.NotRegex;

    private constructor(private readonly _actual: ContextKeyRegexExpr) {
        //
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        return this._actual.cmp(other._actual);
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            return this._actual.equals(other._actual);
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        return this;
    }

    public evaluate(context: IContext): boolean {
        return !this._actual.evaluate(context);
    }

    public serialize(): string {
        return `!(${this._actual.serialize()})`;
    }

    public keys(): string[] {
        return this._actual.keys();
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return new ContextKeyNotRegexExpr(this._actual.map(mapFnc));
    }

    public negate(): ContextKeyExpression {
        return this._actual;
    }
}

/**
 * @returns the same instance if nothing changed.
 */
function eliminateConstantsInArray(arr: ContextKeyExpression[]): (ContextKeyExpression | undefined)[] {
    // Allocate array only if there is a difference
    let newArr: (ContextKeyExpression | undefined)[] | null = null;
    for (let i = 0, len = arr.length; i < len; i++) {
        const newExpr = arr[i].substituteConstants();

        if (arr[i] !== newExpr) {
            // something has changed!

            // allocate array on first difference
            if (newArr === null) {
                newArr = [];
                for (let j = 0; j < i; j++) {
                    newArr[j] = arr[j];
                }
            }
        }

        if (newArr !== null) {
            newArr[i] = newExpr;
        }
    }

    if (newArr === null) {
        return arr;
    }
    return newArr;
}

export class ContextKeyAndExpr implements IContextKeyExpression {

    public static create(_expr: ReadonlyArray<ContextKeyExpression | null | undefined>, negated: ContextKeyExpression | null, extraRedundantCheck: boolean): ContextKeyExpression | undefined {
        return ContextKeyAndExpr._normalizeArr(_expr, negated, extraRedundantCheck);
    }

    public readonly type = ContextKeyExprType.And;

    private constructor(
        public readonly expr: ContextKeyExpression[],
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        if (this.expr.length < other.expr.length) {
            return -1;
        }
        if (this.expr.length > other.expr.length) {
            return 1;
        }
        for (let i = 0, len = this.expr.length; i < len; i++) {
            const r = cmp(this.expr[i], other.expr[i]);
            if (r !== 0) {
                return r;
            }
        }
        return 0;
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            if (this.expr.length !== other.expr.length) {
                return false;
            }
            for (let i = 0, len = this.expr.length; i < len; i++) {
                if (!this.expr[i].equals(other.expr[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        const exprArr = eliminateConstantsInArray(this.expr);
        if (exprArr === this.expr) {
            // no change
            return this;
        }
        return ContextKeyAndExpr.create(exprArr, this.negated, false);
    }

    public evaluate(context: IContext): boolean {
        for (let i = 0, len = this.expr.length; i < len; i++) {
            if (!this.expr[i].evaluate(context)) {
                return false;
            }
        }
        return true;
    }

    private static _normalizeArr(arr: ReadonlyArray<ContextKeyExpression | null | undefined>, negated: ContextKeyExpression | null, extraRedundantCheck: boolean): ContextKeyExpression | undefined {
        const expr: ContextKeyExpression[] = [];
        let hasTrue = false;

        for (const e of arr) {
            if (!e) {
                continue;
            }

            if (e.type === ContextKeyExprType.True) {
                // anything && true ==> anything
                hasTrue = true;
                continue;
            }

            if (e.type === ContextKeyExprType.False) {
                // anything && false ==> false
                return ContextKeyFalseExpr.INSTANCE;
            }

            if (e.type === ContextKeyExprType.And) {
                expr.push(...e.expr);
                continue;
            }

            expr.push(e);
        }

        if (expr.length === 0 && hasTrue) {
            return ContextKeyTrueExpr.INSTANCE;
        }

        if (expr.length === 0) {
            return undefined;
        }

        if (expr.length === 1) {
            return expr[0];
        }

        expr.sort(cmp);

        // eliminate duplicate terms
        for (let i = 1; i < expr.length; i++) {
            if (expr[i - 1].equals(expr[i])) {
                expr.splice(i, 1);
                i--;
            }
        }

        if (expr.length === 1) {
            return expr[0];
        }

        // We must distribute any OR expression because we don't support parens
        // OR extensions will be at the end (due to sorting rules)
        while (expr.length > 1) {
            const lastElement = expr[expr.length - 1];
            if (lastElement.type !== ContextKeyExprType.Or) {
                break;
            }
            // pop the last element
            expr.pop();

            // pop the second to last element
            const secondToLastElement = expr.pop()!;

            const isFinished = (expr.length === 0);

            // distribute `lastElement` over `secondToLastElement`
            const resultElement = ContextKeyOrExpr.create(
                lastElement.expr.map(el => ContextKeyAndExpr.create([el, secondToLastElement], null, extraRedundantCheck)),
                null,
                isFinished
            );

            if (resultElement) {
                expr.push(resultElement);
                expr.sort(cmp);
            }
        }

        if (expr.length === 1) {
            return expr[0];
        }

        // resolve false AND expressions
        if (extraRedundantCheck) {
            for (let i = 0; i < expr.length; i++) {
                for (let j = i + 1; j < expr.length; j++) {
                    if (expr[i].negate().equals(expr[j])) {
                        // A && !A case
                        return ContextKeyFalseExpr.INSTANCE;
                    }
                }
            }

            if (expr.length === 1) {
                return expr[0];
            }
        }

        return new ContextKeyAndExpr(expr, negated);
    }

    public serialize(): string {
        return this.expr.map(e => e.serialize()).join(' && ');
    }

    public keys(): string[] {
        const result: string[] = [];
        for (const expr of this.expr) {
            result.push(...expr.keys());
        }
        return result;
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return new ContextKeyAndExpr(this.expr.map(expr => expr.map(mapFnc)), null);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            const result: ContextKeyExpression[] = [];
            for (const expr of this.expr) {
                result.push(expr.negate());
            }
            this.negated = ContextKeyOrExpr.create(result, this, true)!;
        }
        return this.negated;
    }
}

export class ContextKeyOrExpr implements IContextKeyExpression {

    public static create(_expr: ReadonlyArray<ContextKeyExpression | null | undefined>, negated: ContextKeyExpression | null, extraRedundantCheck: boolean): ContextKeyExpression | undefined {
        return ContextKeyOrExpr._normalizeArr(_expr, negated, extraRedundantCheck);
    }

    public readonly type = ContextKeyExprType.Or;

    private constructor(
        public readonly expr: ContextKeyExpression[],
        private negated: ContextKeyExpression | null
    ) {
    }

    public cmp(other: ContextKeyExpression): number {
        if (other.type !== this.type) {
            return this.type - other.type;
        }
        if (this.expr.length < other.expr.length) {
            return -1;
        }
        if (this.expr.length > other.expr.length) {
            return 1;
        }
        for (let i = 0, len = this.expr.length; i < len; i++) {
            const r = cmp(this.expr[i], other.expr[i]);
            if (r !== 0) {
                return r;
            }
        }
        return 0;
    }

    public equals(other: ContextKeyExpression): boolean {
        if (other.type === this.type) {
            if (this.expr.length !== other.expr.length) {
                return false;
            }
            for (let i = 0, len = this.expr.length; i < len; i++) {
                if (!this.expr[i].equals(other.expr[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    public substituteConstants(): ContextKeyExpression | undefined {
        const exprArr = eliminateConstantsInArray(this.expr);
        if (exprArr === this.expr) {
            // no change
            return this;
        }
        return ContextKeyOrExpr.create(exprArr, this.negated, false);
    }

    public evaluate(context: IContext): boolean {
        for (let i = 0, len = this.expr.length; i < len; i++) {
            if (this.expr[i].evaluate(context)) {
                return true;
            }
        }
        return false;
    }

    private static _normalizeArr(arr: ReadonlyArray<ContextKeyExpression | null | undefined>, negated: ContextKeyExpression | null, extraRedundantCheck: boolean): ContextKeyExpression | undefined {
        let expr: ContextKeyExpression[] = [];
        let hasFalse = false;

        if (arr) {
            for (let i = 0, len = arr.length; i < len; i++) {
                const e = arr[i];
                if (!e) {
                    continue;
                }

                if (e.type === ContextKeyExprType.False) {
                    // anything || false ==> anything
                    hasFalse = true;
                    continue;
                }

                if (e.type === ContextKeyExprType.True) {
                    // anything || true ==> true
                    return ContextKeyTrueExpr.INSTANCE;
                }

                if (e.type === ContextKeyExprType.Or) {
                    expr = expr.concat(e.expr);
                    continue;
                }

                expr.push(e);
            }

            if (expr.length === 0 && hasFalse) {
                return ContextKeyFalseExpr.INSTANCE;
            }

            expr.sort(cmp);
        }

        if (expr.length === 0) {
            return undefined;
        }

        if (expr.length === 1) {
            return expr[0];
        }

        // eliminate duplicate terms
        for (let i = 1; i < expr.length; i++) {
            if (expr[i - 1].equals(expr[i])) {
                expr.splice(i, 1);
                i--;
            }
        }

        if (expr.length === 1) {
            return expr[0];
        }

        // resolve true OR expressions
        if (extraRedundantCheck) {
            for (let i = 0; i < expr.length; i++) {
                for (let j = i + 1; j < expr.length; j++) {
                    if (expr[i].negate().equals(expr[j])) {
                        // A || !A case
                        return ContextKeyTrueExpr.INSTANCE;
                    }
                }
            }

            if (expr.length === 1) {
                return expr[0];
            }
        }

        return new ContextKeyOrExpr(expr, negated);
    }

    public serialize(): string {
        return this.expr.map(e => e.serialize()).join(' || ');
    }

    public keys(): string[] {
        const result: string[] = [];
        for (const expr of this.expr) {
            result.push(...expr.keys());
        }
        return result;
    }

    public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
        return new ContextKeyOrExpr(this.expr.map(expr => expr.map(mapFnc)), null);
    }

    public negate(): ContextKeyExpression {
        if (!this.negated) {
            const result: ContextKeyExpression[] = [];
            for (const expr of this.expr) {
                result.push(expr.negate());
            }

            // We don't support parens, so here we distribute the AND over the OR terminals
            // We always take the first 2 AND pairs and distribute them
            while (result.length > 1) {
                const LEFT = result.shift()!;
                const RIGHT = result.shift()!;

                const all: ContextKeyExpression[] = [];
                for (const left of getTerminals(LEFT)) {
                    for (const right of getTerminals(RIGHT)) {
                        all.push(ContextKeyAndExpr.create([left, right], null, false)!);
                    }
                }

                result.unshift(ContextKeyOrExpr.create(all, null, false)!);
            }

            this.negated = ContextKeyOrExpr.create(result, this, true)!;
        }
        return this.negated;
    }
}

export interface ContextKeyInfo {
    readonly key: string;
    readonly type?: string;
    readonly description?: string;
}

export type ContextKeyValue = null | undefined | boolean | number | string
| Array<null | undefined | boolean | number | string>
| Record<string, null | undefined | boolean | number | string>;

export interface IContext {
    getValue<T extends ContextKeyValue = ContextKeyValue>(key: string): T | undefined;
}

export interface IContextKey<T extends ContextKeyValue = ContextKeyValue> {
    set(value: T): void;
    reset(): void;
    get(): T | undefined;
}

export interface IContextKeyServiceTarget {
    parentElement: IContextKeyServiceTarget | null;
    setAttribute(attr: string, value: string): void;
    removeAttribute(attr: string): void;
    hasAttribute(attr: string): boolean;
    getAttribute(attr: string): string | null;
}

function cmp1(key1: string, key2: string): number {
    if (key1 < key2) {
        return -1;
    }
    if (key1 > key2) {
        return 1;
    }
    return 0;
}

function cmp2(key1: string, value1: any, key2: string, value2: any): number {
    if (key1 < key2) {
        return -1;
    }
    if (key1 > key2) {
        return 1;
    }
    if (value1 < value2) {
        return -1;
    }
    if (value1 > value2) {
        return 1;
    }
    return 0;
}

/**
 * Returns true if it is provable `p` implies `q`.
 */
export function implies(p: ContextKeyExpression, q: ContextKeyExpression): boolean {

    if (p.type === ContextKeyExprType.False || q.type === ContextKeyExprType.True) {
        // false implies anything
        // anything implies true
        return true;
    }

    if (p.type === ContextKeyExprType.Or) {
        if (q.type === ContextKeyExprType.Or) {
            // `a || b || c` can only imply something like `a || b || c || d`
            return allElementsIncluded(p.expr, q.expr);
        }
        return false;
    }

    if (q.type === ContextKeyExprType.Or) {
        for (const element of q.expr) {
            if (implies(p, element)) {
                return true;
            }
        }
        return false;
    }

    if (p.type === ContextKeyExprType.And) {
        if (q.type === ContextKeyExprType.And) {
            // `a && b && c` implies `a && c`
            return allElementsIncluded(q.expr, p.expr);
        }
        for (const element of p.expr) {
            if (implies(element, q)) {
                return true;
            }
        }
        return false;
    }

    return p.equals(q);
}

/**
 * Returns true if all elements in `p` are also present in `q`.
 * The two arrays are assumed to be sorted
 */
function allElementsIncluded(p: ContextKeyExpression[], q: ContextKeyExpression[]): boolean {
    let pIndex = 0;
    let qIndex = 0;
    while (pIndex < p.length && qIndex < q.length) {
        const cmp = p[pIndex].cmp(q[qIndex]);

        if (cmp < 0) {
            // an element from `p` is missing from `q`
            return false;
        } else if (cmp === 0) {
            pIndex++;
            qIndex++;
        } else {
            qIndex++;
        }
    }
    return (pIndex === p.length);
}

function getTerminals(node: ContextKeyExpression) {
    if (node.type === ContextKeyExprType.Or) {
        return node.expr;
    }
    return [node];
}

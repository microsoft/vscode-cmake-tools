/**
 * Minimal vscode mock for backend tests.
 * Provides just enough to satisfy modules like CMakeParser that only need
 * TextDocument, Position, Range, and Uri.
 */

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
    compareTo(other: Position): number {
        if (this.line !== other.line) {
            return this.line - other.line;
        }
        return this.character - other.character;
    }
    isEqual(other: Position): boolean {
        return this.line === other.line && this.character === other.character;
    }
}

export class Range {
    constructor(
        public readonly start: Position,
        public readonly end: Position
    ) {}
}

export class Uri {
    private constructor(
        public readonly scheme: string,
        public readonly fsPath: string,
        public readonly path: string
    ) {}
    static file(p: string): Uri {
        return new Uri('file', p, p);
    }
    static parse(s: string): Uri {
        return new Uri('file', s, s);
    }
    toString(): string {
        return this.fsPath;
    }
}

/**
 * Create a mock TextDocument from a string.
 */
export function createMockDocument(text: string, fileName: string = 'CMakeLists.txt') {
    const lines = text.split('\n');
    return {
        getText: () => text,
        fileName,
        uri: Uri.file(fileName),
        lineCount: lines.length,
        positionAt(offset: number): Position {
            let remaining = offset;
            for (let line = 0; line < lines.length; line++) {
                // +1 for the \n that was removed by split
                const lineLen = lines[line].length + (line < lines.length - 1 ? 1 : 0);
                if (remaining <= lines[line].length) {
                    return new Position(line, remaining);
                }
                remaining -= lineLen;
            }
            return new Position(lines.length - 1, lines[lines.length - 1].length);
        },
        offsetAt(pos: Position): number {
            let offset = 0;
            for (let i = 0; i < pos.line && i < lines.length; i++) {
                offset += lines[i].length + 1; // +1 for \n
            }
            return offset + pos.character;
        },
        lineAt(line: number) {
            const text = lines[line] || '';
            const firstNonWhitespace = text.search(/\S/);
            return {
                text,
                firstNonWhitespaceCharacterIndex: firstNonWhitespace === -1 ? text.length : firstNonWhitespace
            };
        },
        isDirty: false
    };
}

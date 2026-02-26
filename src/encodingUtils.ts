/**
 * Check whether a buffer contains valid UTF-8 byte sequences.
 * Incomplete multi-byte sequences at the end of the buffer are treated as valid
 * (they may continue in the next data chunk).
 */
export function isValidUtf8(buffer: Buffer): boolean {
    let i = 0;
    while (i < buffer.length) {
        const byte = buffer[i];
        if (byte <= 0x7F) {
            // Single-byte ASCII
            i += 1;
        } else if (byte >= 0xC2 && byte <= 0xDF) {
            // 2-byte sequence
            if (i + 1 >= buffer.length) {
                return true; // Incomplete at end — OK
            }
            if (buffer[i + 1] < 0x80 || buffer[i + 1] > 0xBF) {
                return false;
            }
            i += 2;
        } else if (byte >= 0xE0 && byte <= 0xEF) {
            // 3-byte sequence
            if (i + 1 >= buffer.length) {
                return true;
            }
            const b1 = buffer[i + 1];
            if (b1 < 0x80 || b1 > 0xBF) {
                return false;
            }
            // Reject overlong 3-byte sequences and surrogates
            if (byte === 0xE0 && b1 < 0xA0) {
                return false;
            }
            if (byte === 0xED && b1 > 0x9F) {
                return false;
            }
            if (i + 2 >= buffer.length) {
                return true;
            }
            if (buffer[i + 2] < 0x80 || buffer[i + 2] > 0xBF) {
                return false;
            }
            i += 3;
        } else if (byte >= 0xF0 && byte <= 0xF4) {
            // 4-byte sequence
            if (i + 1 >= buffer.length) {
                return true;
            }
            const b1 = buffer[i + 1];
            if (b1 < 0x80 || b1 > 0xBF) {
                return false;
            }
            // Reject overlong 4-byte sequences and code points > U+10FFFF
            if (byte === 0xF0 && b1 < 0x90) {
                return false;
            }
            if (byte === 0xF4 && b1 > 0x8F) {
                return false;
            }
            if (i + 2 >= buffer.length) {
                return true;
            }
            if (buffer[i + 2] < 0x80 || buffer[i + 2] > 0xBF) {
                return false;
            }
            if (i + 3 >= buffer.length) {
                return true;
            }
            if (buffer[i + 3] < 0x80 || buffer[i + 3] > 0xBF) {
                return false;
            }
            i += 4;
        } else {
            // Invalid leading byte (0x80-0xBF, 0xC0-0xC1, 0xF5-0xFF)
            return false;
        }
    }
    return true;
}

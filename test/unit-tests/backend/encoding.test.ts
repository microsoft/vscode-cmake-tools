import { expect } from 'chai';
import { isValidUtf8 } from '@cmt/encodingUtils';

suite('isValidUtf8', () => {
    test('ASCII-only content is valid UTF-8', () => {
        expect(isValidUtf8(Buffer.from('Hello, World!', 'ascii'))).to.be.true;
    });

    test('Empty buffer is valid UTF-8', () => {
        expect(isValidUtf8(Buffer.alloc(0))).to.be.true;
    });

    test('Valid UTF-8 with Chinese characters', () => {
        // "无法打开包括文件" in UTF-8
        const utf8Buf = Buffer.from('无法打开包括文件', 'utf8');
        expect(isValidUtf8(utf8Buf)).to.be.true;
    });

    test('Valid UTF-8 with mixed ASCII and multibyte', () => {
        // MSVC error message: "fatal error C1083: 无法打开包括文件"
        const utf8Buf = Buffer.from('fatal error C1083: 无法打开包括文件: "a.h": No such file', 'utf8');
        expect(isValidUtf8(utf8Buf)).to.be.true;
    });

    test('Valid UTF-8 with 2-byte sequences (Latin)', () => {
        // "café" contains é (U+00E9) → 0xC3 0xA9
        const utf8Buf = Buffer.from('café', 'utf8');
        expect(isValidUtf8(utf8Buf)).to.be.true;
    });

    test('Valid UTF-8 with 4-byte sequences (emoji)', () => {
        const utf8Buf = Buffer.from('Hello 🌍', 'utf8');
        expect(isValidUtf8(utf8Buf)).to.be.true;
    });

    test('GBK-encoded Chinese is NOT valid UTF-8', () => {
        // "无法打开" in GBK encoding: each Chinese character is 2 bytes in GBK
        // GBK bytes for "无法" are: 0xCE 0xDE 0xB7 0xA8
        // 0xCE 0xDE: 0xCE is a valid UTF-8 leading byte (2-byte), but 0xDE > 0xBF so invalid continuation
        const gbkBuf = Buffer.from([0xCE, 0xDE, 0xB7, 0xA8]);
        expect(isValidUtf8(gbkBuf)).to.be.false;
    });

    test('GBK-encoded MSVC error message is NOT valid UTF-8', () => {
        // Simulate GBK output from cl.exe without /utf-8
        // "无法打开包括文件" in GBK
        const iconv = require('iconv-lite');
        const gbkBuf: Buffer = iconv.encode('无法打开包括文件', 'gbk');
        expect(isValidUtf8(gbkBuf)).to.be.false;
    });

    test('Invalid: bare continuation byte', () => {
        expect(isValidUtf8(Buffer.from([0x80]))).to.be.false;
    });

    test('Invalid: overlong 2-byte sequence (0xC0 0x80)', () => {
        expect(isValidUtf8(Buffer.from([0xC0, 0x80]))).to.be.false;
    });

    test('Invalid: overlong 2-byte sequence (0xC1 0xBF)', () => {
        expect(isValidUtf8(Buffer.from([0xC1, 0xBF]))).to.be.false;
    });

    test('Invalid: overlong 3-byte sequence (0xE0 0x80 0x80)', () => {
        expect(isValidUtf8(Buffer.from([0xE0, 0x80, 0x80]))).to.be.false;
    });

    test('Invalid: surrogate pair (0xED 0xA0 0x80 = U+D800)', () => {
        expect(isValidUtf8(Buffer.from([0xED, 0xA0, 0x80]))).to.be.false;
    });

    test('Invalid: byte 0xFF', () => {
        expect(isValidUtf8(Buffer.from([0xFF]))).to.be.false;
    });

    test('Invalid: byte 0xFE', () => {
        expect(isValidUtf8(Buffer.from([0xFE]))).to.be.false;
    });

    test('Incomplete 2-byte sequence at end is valid (boundary split)', () => {
        // 0xC3 is a valid 2-byte leading byte; incomplete at end
        expect(isValidUtf8(Buffer.from([0x41, 0xC3]))).to.be.true;
    });

    test('Incomplete 3-byte sequence at end is valid (boundary split)', () => {
        // 0xE4 0xB8 is start of a 3-byte CJK character
        expect(isValidUtf8(Buffer.from([0x41, 0xE4, 0xB8]))).to.be.true;
    });

    test('Incomplete 4-byte sequence at end is valid (boundary split)', () => {
        // 0xF0 0x9F is start of an emoji 4-byte sequence
        expect(isValidUtf8(Buffer.from([0x41, 0xF0, 0x9F]))).to.be.true;
    });

    test('Invalid continuation in 2-byte sequence', () => {
        expect(isValidUtf8(Buffer.from([0xC3, 0x00]))).to.be.false;
    });

    test('Invalid continuation in 3-byte sequence', () => {
        expect(isValidUtf8(Buffer.from([0xE4, 0xB8, 0x00]))).to.be.false;
    });
});

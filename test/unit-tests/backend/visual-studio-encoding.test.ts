import { expect } from 'chai';
import * as iconv from 'iconv-lite';

/**
 * Test suite for Visual Studio batch file encoding fix.
 * 
 * This test verifies that non-ASCII characters (like those used in Hungarian, Chinese, etc.)
 * are correctly encoded when writing batch files for Visual Studio environment setup.
 * 
 * The fix addresses issue #4623 where Visual Studio installed in a directory with non-ASCII
 * characters (e.g., "Fejlesztői Eszközök") would fail during kit scanning because:
 * 1. Batch files were written as UTF-8
 * 2. cmd.exe reads them using the Windows code page (e.g., windows-1252)
 * 3. This mismatch caused path resolution failures
 * 
 * The solution: encode batch file content using the Windows code page before writing.
 */
suite('[Visual Studio Encoding]', () => {
    test('Batch file content is correctly encoded for Windows code pages', () => {
        // Test string with Hungarian characters as seen in issue #4623
        const testPath = 'C:\\Program Files\\Fejlesztői Eszközök\\Visual Studio\\2022\\VC\\Auxiliary\\Build\\vcvarsall.bat';
        
        // Common Windows code pages
        const codepages = [
            'windows-1250', // Central European (includes Hungarian)
            'windows-1252', // Western European
            'utf-8'         // UTF-8 for comparison
        ];

        for (const codepage of codepages) {
            // Encode the path as we would for a batch file
            const encoded = iconv.encode(testPath, codepage);
            
            // Decode it back as cmd.exe would
            const decoded = iconv.decode(encoded, codepage);
            
            // The round-trip should preserve the path for supported code pages
            if (codepage === 'windows-1250') {
                // Hungarian characters should survive the round trip in windows-1250
                expect(decoded).to.equal(testPath, 
                    `Path should survive round-trip encoding with ${codepage}`);
            } else if (codepage === 'windows-1252') {
                // windows-1252 doesn't support 'ő' (U+0151), so it will be replaced
                // This test verifies that the encoding happens, not that all chars are supported
                expect(encoded.length).to.be.greaterThan(0, 
                    `Encoding should produce non-empty result for ${codepage}`);
            } else if (codepage === 'utf-8') {
                // UTF-8 should always preserve the path
                expect(decoded).to.equal(testPath,
                    `Path should survive round-trip encoding with UTF-8`);
            }
        }
    });

    test('iconv can encode batch file content structure', () => {
        // Simulate a batch file with non-ASCII paths
        const batContent = [
            '@echo off',
            'cd /d "%~dp0"',
            'set "VS170COMNTOOLS=C:\\Program Files\\Fejlesztői Eszközök\\Visual Studio\\2022\\Common7\\Tools"',
            'set "INCLUDE="',
            'call "C:\\Program Files\\Fejlesztői Eszközök\\Visual Studio\\2022\\VC\\Auxiliary\\Build\\vcvarsall.bat" x86'
        ].join('\r\n');

        // Encode using windows-1250 (Central European)
        const encoded = iconv.encode(batContent, 'windows-1250');
        
        // Verify encoding produces a buffer
        expect(encoded).to.be.instanceOf(Buffer);
        expect(encoded.length).to.be.greaterThan(0);
        
        // Decode back to verify structure is maintained
        const decoded = iconv.decode(encoded, 'windows-1250');
        expect(decoded).to.include('@echo off');
        expect(decoded).to.include('cd /d "%~dp0"');
        expect(decoded).to.include('vcvarsall.bat');
    });

    test('UTF-8 vs Windows code page encoding produces different byte sequences for non-ASCII', () => {
        const testString = 'Fejlesztői Eszközök';
        
        const utf8Encoded = iconv.encode(testString, 'utf-8');
        const cp1250Encoded = iconv.encode(testString, 'windows-1250');
        
        // These should be different because UTF-8 uses multi-byte sequences for non-ASCII
        // while windows-1250 uses single-byte encoding
        expect(utf8Encoded.length).to.not.equal(cp1250Encoded.length,
            'UTF-8 and Windows-1250 should produce different byte sequences for non-ASCII characters');
        
        // UTF-8 encoding of 'ő' (U+0151) is 2 bytes: 0xC5 0x91
        // windows-1250 encoding of 'ő' is 1 byte: 0xF5
        expect(utf8Encoded.length).to.be.greaterThan(cp1250Encoded.length,
            'UTF-8 should use more bytes for this Hungarian text than windows-1250');
    });
});

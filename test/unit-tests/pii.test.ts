import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as os from 'os';

chai.use(chaiAsPromised);

import { expect } from 'chai';
import { cleanStack, cleanString } from '../../src/rollbar';

suite('Stack trace cleaning test', () => {
    if (os.platform() === 'win32') {
        test('Check PII removal - Windows', async () => {
            expect(cleanStack('at failingFunction (c:\\path\\to\\main.js)')).to.eq('at failingFunction (main.js)');
            expect(cleanStack('at failingFunction (c:\\path\\to\\main.js:12)')).to.eq('at failingFunction (main.js:12)');
            expect(cleanStack('at failingFunction (c:\\path\\to\\main.js:12:34)')).to.eq('at failingFunction (main.js:12:34)');
            expect(cleanStack('at c:\\path\\to\\main.js:12345:67')).to.eq('at main.js:12345:67');
            expect(cleanStack('at async c:\\path\\to\\main.js:12345:67')).to.eq('at async main.js:12345:67');
            expect(cleanStack('Error: ENOENT: c:\\path\\to\\file\n\tat failingFunction c:\\some\\other\\path')).to.eq('Error: ENOENT: <path removed>\n\tat failingFunction <path removed>');
        });
    } else {
        test('Check PII removal - *nix', async () => {
            expect(cleanStack('at failingFunction (/usr/home/main.js)')).to.eq('at failingFunction (main.js)');
            expect(cleanStack('at failingFunction (/usr/home/main.js:12)')).to.eq('at failingFunction (main.js:12)');
            expect(cleanStack('at failingFunction (/usr/home/main.js:12:34)')).to.eq('at failingFunction (main.js:12:34)');
            expect(cleanStack('at /usr/home/main.js:12345:67')).to.eq('at main.js:12345:67');
            expect(cleanStack('at async /usr/home/main.js:12345:67')).to.eq('at async main.js:12345:67');
            expect(cleanStack('Error: ENOENT: /path/to/file\n\tat failingFunction /some/other/path')).to.eq('Error: ENOENT: <path removed>\n\tat failingFunction <path removed>');
        });
    }

    test('Check PII removal - relative', async () => {
        expect(cleanStack('at failingFunction (main.js)')).to.eq('at failingFunction (main.js)');
        expect(cleanStack('at failingFunction (main.js:1)')).to.eq('at failingFunction (main.js:1)');
        expect(cleanStack('at failingFunction (main.js:1:2)')).to.eq('at failingFunction (main.js:1:2)');
    });

    if (os.platform() === 'win32') {
        test('Check PII removal - multiline', async () => {
            expect(cleanStack('ERROR: foo\n\tat failingFunction (c:\\path\\to\\main.js:1:2)\n\tat c:\\path\\to\\main.js:12345:67\n\tat failingFunction (c:\\path\\to\\main.js:1:2)\n\tat failingFunction (main.js:1:2)'))
                .to.eq('ERROR: foo\n\tat failingFunction (main.js:1:2)\n\tat main.js:12345:67\n\tat failingFunction (main.js:1:2)\n\tat failingFunction (main.js:1:2)');
        });
    } else {
        test('Check PII removal - multiline', async () => {
            expect(cleanStack('ERROR: foo\n\tat failingFunction (/usr/bin/main.js:1:2)\n\tat /usr/home/main.js:12345:67\n\tat failingFunction (/usr/bin/main.js:1:2)\n\tat failingFunction (main.js:1:2)'))
                .to.eq('ERROR: foo\n\tat failingFunction (main.js:1:2)\n\tat main.js:12345:67\n\tat failingFunction (main.js:1:2)\n\tat failingFunction (main.js:1:2)');
        });
    }

    test('Check PII removal - Errors', async () => {
        expect(cleanString('Error: ENOENT: c:\\path\\to\\file')).to.eq('Error: ENOENT: <path removed>');
        expect(cleanString('Error: ENOENT: /path/to/file')).to.eq('Error: ENOENT: <path removed>');
    });
});

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import {cleanStack} from '../../src/rollbar';

// tslint:disable:no-unused-expression

suite('Stack trace cleaning test', async () => {
  test('Check PII removal - Windows', async () => {
    expect(cleanStack('at failingFunction (c:\\path\\to\\main.js)')).to.eq('at failingFunction (main.js)');
    expect(cleanStack('at failingFunction (c:\\path\\to\\main.js:12)')).to.eq('at failingFunction (main.js:12)');
    expect(cleanStack('at failingFunction (c:\\path\\to\\main.js:12:34)')).to.eq('at failingFunction (main.js:12:34)');
  });
  test('Check PII removal - *nix', async () => {
    expect(cleanStack('at failingFunction (/usr/home/main.js)')).to.eq('at failingFunction (main.js)');
    expect(cleanStack('at failingFunction (/usr/home/main.js:12)')).to.eq('at failingFunction (main.js:12)');
    expect(cleanStack('at failingFunction (/usr/home/main.js:12:34)')).to.eq('at failingFunction (main.js:12:34)');
  });
  test('Check PII removal - relative', async () => {
    expect(cleanStack('at failingFunction (main.js)')).to.eq('at failingFunction (main.js)');
    expect(cleanStack('at failingFunction (main.js:1)')).to.eq('at failingFunction (main.js:1)');
    expect(cleanStack('at failingFunction (main.js:1:2)')).to.eq('at failingFunction (main.js:1:2)');
  });
  test('Check PII removal - multiline', async () => {
    expect(cleanStack('ERROR: foo\n\tat failingFunction (/usr/bin/main.js:1:2)\n\tat failingFunction (/usr/bin/main.js:1:2)')).to.eq('ERROR: foo\n\tat failingFunction (main.js:1:2)\n\tat failingFunction (main.js:1:2)');
  });
});
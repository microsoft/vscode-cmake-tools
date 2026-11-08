const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const decode = require('./index.cjs');

test('preserves the CommonJS function API and URI decoding', () => {
    assert.equal(typeof decode, 'function');
    assert.equal(decode('a%20b%2Fc'), 'a b/c');
    assert.equal(decode('%C3%A5'), '\u00e5');
    assert.equal(decode('%zz'), '%zz');
    assert.throws(() => decode(null), TypeError);
});

test('bounds malformed-input decoding in an isolated process', () => {
    const script = `
        const assert = require('node:assert/strict');
        const decode = require(process.argv[1]);
        const malformed = '%C0'.repeat(1024);
        assert.equal(decode(malformed), malformed);
        const runs = Array.from({length: 4000}, (_, value) =>
            '%' + (value >> 8).toString(16).padStart(2, '0') +
            '%' + (value & 255).toString(16).padStart(2, '0') + 'x');
        assert.equal(decode(runs.join('') + '%zz'), runs.map(decode).join('') + '%zz');
    `;
    const result = spawnSync(process.execPath, ['-e', script, require.resolve('./index.cjs')], {
        encoding: 'utf8',
        timeout: 5000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
});

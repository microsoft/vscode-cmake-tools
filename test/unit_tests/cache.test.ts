//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import * as api from '../../src/api';
import {CMakeCache} from '../../src/cache';
import * as util from '../../src/util';


const here = __dirname;
function getTestResourceFilePath(filename: string): string { return path.normalize(path.join(here, '../../../test/unit_tests', filename)); }

suite('Cache test', async () => {
  test("Read CMake Cache", async function() {
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache.txt'));
    const generator = cache.get("CMAKE_GENERATOR") as api.CacheEntry;
    expect(generator.type).to.eq(api.CacheEntryType.Internal);
    expect(generator.key).to.eq('CMAKE_GENERATOR');
    expect(generator.as<string>()).to.eq('Ninja');
    expect(typeof generator.value).to.eq('string');

    const build_testing = await cache.get('BUILD_TESTING') as api.CacheEntry;
    expect(build_testing.type).to.eq(api.CacheEntryType.Bool);
    expect(build_testing.as<boolean>()).to.be.true;
  });
  test("Read cache with various newlines", async function() {
    for (const newline of ['\n', '\r\n', '\r']) {
      const str = [ '# This line is ignored', '// This line is docs', 'SOMETHING:STRING=foo', '' ].join(newline);
      const entries = CMakeCache.parseCache(str);
      expect(entries.size).to.eq(1);
      expect(entries.has('SOMETHING')).to.be.true;
      const entry = entries.get('SOMETHING')!;
      expect(entry.value).to.eq('foo');
      expect(entry.type).to.eq(api.CacheEntryType.String);
      expect(entry.helpString).to.eq('This line is docs');
    }
  });
  test('Falsey values', () => {
    const false_things = [
      '0',
      '',
      'NO',
      'FALSE',
      'OFF',
      'NOTFOUND',
      'IGNORE',
      'N',
      'SOMETHING-NOTFOUND',
      null,
      false,
    ];
    for (const thing of false_things) {
      expect(util.isTruthy(thing), 'Check false-iness of ' + thing).to.be.false;
    }
  });
  test('Truthy values', () => {
    const true_things = [ '1', 'ON', 'YES', 'Y', '112', 12, 'SOMETHING' ];
    for (const thing of true_things) {
      expect(util.isTruthy(thing), 'Check truthiness of ' + thing).to.be.true;
    }
  });
});
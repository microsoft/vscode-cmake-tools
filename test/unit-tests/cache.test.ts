/* eslint-disable no-unused-expressions */
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';

chai.use(chaiAsPromised);

import { expect } from 'chai';
import { CMakeCache, CacheEntryType, CacheEntry } from '@cmt/cache';
import * as util from '@cmt/util';

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
    return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

suite('Cache test', () => {
    test('Read CMake Cache', async () => {
        const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache.txt'));
        const generator = cache.get('CMAKE_GENERATOR') as CacheEntry;
        expect(generator.type).to.eq(CacheEntryType.Internal);
        expect(generator.key).to.eq('CMAKE_GENERATOR');
        expect(generator.as<string>()).to.eq('Ninja');
        expect(typeof generator.value).to.eq('string');

        const build_testing = cache.get('BUILD_TESTING') as CacheEntry;
        expect(build_testing.type).to.eq(CacheEntryType.Bool);
        expect(build_testing.as<boolean>()).to.be.true;
    });
    test('Read cache with various newlines', async () => {
        for (const newline of ['\n', '\r\n', '\r']) {
            const str = ['# This line is ignored', '// This line is docs', 'SOMETHING:STRING=foo', ''].join(newline);
            const entries = CMakeCache.parseCache(str);
            expect(entries.size).to.eq(1);
            expect(entries.has('SOMETHING')).to.be.true;
            const entry = entries.get('SOMETHING')!;
            expect(entry.value).to.eq('foo');
            expect(entry.type).to.eq(CacheEntryType.String);
            expect(entry.helpString).to.eq('This line is docs');
        }
    });
    test('Read cache entry with double quotes because of colon', async () => {
        const str = "\"FIRSTPART:SECONDPART\":STRING=value";
        const entries = CMakeCache.parseCache(str);
        expect(entries.size).to.eq(1);
        expect(entries.has('FIRSTPART:SECONDPART')).to.be.true;
        const entry = entries.get('FIRSTPART:SECONDPART')!;
        expect(entry.value).to.eq('value');
        expect(entry.type).to.eq(CacheEntryType.String);
    });
    test('Read cache entry with double quotes, but no colon', async () => {
        const str = "\"QUOTED\":STRING=value";
        const entries = CMakeCache.parseCache(str);
        expect(entries.size).to.eq(1);
        expect(entries.has('QUOTED')).to.be.true;
        const entry = entries.get('QUOTED')!;
        expect(entry.value).to.eq('value');
        expect(entry.type).to.eq(CacheEntryType.String);
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
            false
        ];
        for (const thing of false_things) {
            expect(util.isTruthy(thing), `Check false-iness of ${thing}`).to.be.false;
        }
    });
    test('Truthy values', () => {
        const true_things = ['1', 'ON', 'YES', 'Y', '112', 12, 'SOMETHING'];
        for (const thing of true_things) {
            expect(util.isTruthy(thing), `Check truthiness of ${thing}`).to.be.true;
        }
    });
});

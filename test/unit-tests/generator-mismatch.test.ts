/* eslint-disable no-unused-expressions */
import { expect } from 'chai';
import { CMakeCache, CacheEntry } from '@cmt/cache';
import { generatorMismatch } from '@cmt/drivers/cmakeDriver';

suite('Generator mismatch detection', () => {
    suite('generatorMismatch (pure helper)', () => {
        test('Returns true when generators differ', () => {
            expect(generatorMismatch('Visual Studio 18 2026', 'Ninja')).to.be.true;
        });

        test('Returns false when generators match', () => {
            expect(generatorMismatch('Ninja', 'Ninja')).to.be.false;
        });

        test('Returns false when new generator is undefined', () => {
            expect(generatorMismatch(undefined, 'Ninja')).to.be.false;
        });

        test('Returns false when cached generator is undefined', () => {
            expect(generatorMismatch('Ninja', undefined)).to.be.false;
        });

        test('Returns false when both are undefined', () => {
            expect(generatorMismatch(undefined, undefined)).to.be.false;
        });

        test('Returns false when cached value is empty string', () => {
            expect(generatorMismatch('Ninja', '')).to.be.false;
        });

        test('Returns true for different VS versions', () => {
            expect(generatorMismatch('Visual Studio 18 2026', 'Visual Studio 17 2022')).to.be.true;
        });

        test('Returns true switching from VS generator to Ninja', () => {
            expect(generatorMismatch('Ninja', 'Visual Studio 18 2026')).to.be.true;
        });

        test('Returns true switching from Unix Makefiles to Ninja', () => {
            expect(generatorMismatch('Ninja', 'Unix Makefiles')).to.be.true;
        });
    });

    suite('CMakeCache.parseCache integration', () => {
        test('Detects mismatch via parsed cache (Ninja cached, VS selected)', () => {
            const cacheContent = [
                '# This is the CMakeCache file.',
                'CMAKE_GENERATOR:INTERNAL=Ninja',
                ''
            ].join('\n');
            const entries = CMakeCache.parseCache(cacheContent);
            const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
            expect(generatorMismatch('Visual Studio 18 2026', cachedGenerator.value)).to.be.true;
        });

        test('No mismatch when cached generator matches selected', () => {
            const cacheContent = 'CMAKE_GENERATOR:INTERNAL=Ninja\n';
            const entries = CMakeCache.parseCache(cacheContent);
            const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
            expect(generatorMismatch('Ninja', cachedGenerator.value)).to.be.false;
        });

        test('No mismatch when CMAKE_GENERATOR absent from cache', () => {
            const cacheContent = 'CMAKE_BUILD_TYPE:STRING=Debug\n';
            const entries = CMakeCache.parseCache(cacheContent);
            const cachedGenerator = entries.get('CMAKE_GENERATOR');
            expect(generatorMismatch('Ninja', cachedGenerator?.value)).to.be.false;
        });

        test('No mismatch when cache is empty', () => {
            const entries = CMakeCache.parseCache('');
            const cachedGenerator = entries.get('CMAKE_GENERATOR');
            expect(generatorMismatch('Ninja', cachedGenerator?.value)).to.be.false;
        });

        test('Detects mismatch between two VS generator versions via cache', () => {
            const cacheContent = 'CMAKE_GENERATOR:INTERNAL=Visual Studio 17 2022\n';
            const entries = CMakeCache.parseCache(cacheContent);
            const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
            expect(generatorMismatch('Visual Studio 18 2026', cachedGenerator.value)).to.be.true;
        });

        test('Detects mismatch when switching from Unix Makefiles cached to Ninja', () => {
            const cacheContent = 'CMAKE_GENERATOR:INTERNAL=Unix Makefiles\n';
            const entries = CMakeCache.parseCache(cacheContent);
            const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
            expect(generatorMismatch('Ninja', cachedGenerator.value)).to.be.true;
        });
    });
});

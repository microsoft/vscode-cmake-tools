/* eslint-disable no-unused-expressions */
import { expect } from 'chai';
import { CMakeCache, CacheEntry } from '@cmt/cache';

suite('Generator mismatch detection', () => {
    // Test the core logic that _cleanIfGeneratorChanged relies on:
    // reading CMAKE_GENERATOR from cache and comparing with new generator

    test('Detects generator mismatch when cache has Ninja but VS generator selected', () => {
        const cacheContent = [
            '# This is the CMakeCache file.',
            'CMAKE_GENERATOR:INTERNAL=Ninja',
            ''
        ].join('\n');
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
        expect(cachedGenerator).to.not.be.undefined;
        expect(cachedGenerator.value).to.eq('Ninja');
        // Simulating the comparison in _cleanIfGeneratorChanged
        const newGenerator = 'Visual Studio 18 2026';
        expect(cachedGenerator.value).to.not.eq(newGenerator);
    });

    test('No mismatch when cache generator matches selected generator', () => {
        const cacheContent = [
            'CMAKE_GENERATOR:INTERNAL=Ninja',
            ''
        ].join('\n');
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
        expect(cachedGenerator).to.not.be.undefined;
        expect(cachedGenerator.value).to.eq('Ninja');
    });

    test('No mismatch detection when cache is empty', () => {
        const cacheContent = '';
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR');
        expect(cachedGenerator).to.be.undefined;
        // _cleanIfGeneratorChanged would return early (no cached generator)
    });

    test('No mismatch detection when CMAKE_GENERATOR not in cache', () => {
        const cacheContent = [
            'CMAKE_BUILD_TYPE:STRING=Debug',
            'CMAKE_INSTALL_PREFIX:PATH=/usr/local',
            ''
        ].join('\n');
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR');
        expect(cachedGenerator).to.be.undefined;
    });

    test('Detects mismatch with Visual Studio generators of different versions', () => {
        const cacheContent = [
            'CMAKE_GENERATOR:INTERNAL=Visual Studio 17 2022',
            ''
        ].join('\n');
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
        expect(cachedGenerator).to.not.be.undefined;
        const newGenerator = 'Visual Studio 18 2026';
        expect(cachedGenerator.value).to.not.eq(newGenerator);
    });

    test('No mismatch when both are Visual Studio 18 2026', () => {
        const cacheContent = [
            'CMAKE_GENERATOR:INTERNAL=Visual Studio 18 2026',
            ''
        ].join('\n');
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
        expect(cachedGenerator).to.not.be.undefined;
        expect(cachedGenerator.value).to.eq('Visual Studio 18 2026');
    });

    test('Detects mismatch switching from VS generator to Ninja', () => {
        const cacheContent = [
            'CMAKE_GENERATOR:INTERNAL=Visual Studio 18 2026',
            ''
        ].join('\n');
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
        expect(cachedGenerator).to.not.be.undefined;
        const newGenerator = 'Ninja';
        expect(cachedGenerator.value).to.not.eq(newGenerator);
    });

    test('Handles Unix Makefiles generator in cache', () => {
        const cacheContent = [
            'CMAKE_GENERATOR:INTERNAL=Unix Makefiles',
            ''
        ].join('\n');
        const entries = CMakeCache.parseCache(cacheContent);
        const cachedGenerator = entries.get('CMAKE_GENERATOR') as CacheEntry;
        expect(cachedGenerator).to.not.be.undefined;
        expect(cachedGenerator.value).to.eq('Unix Makefiles');
        const newGenerator = 'Ninja';
        expect(cachedGenerator.value).to.not.eq(newGenerator);
    });
});

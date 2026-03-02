import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the fix for #4959 (command-name completion stopped auto-triggering since 1.23.51).
 *
 * Root cause: the CMake TextMate grammar tokenizes a command word as
 * `string.unquoted.cmake` until `()` is typed (the command patterns require a
 * trailing `(` via a `(?=\s*\()` lookahead, added by #4740). The completion
 * provider registers with no trigger characters, so auto-popup relies on
 * `editor.quickSuggestions`, whose `strings` category is `off` by VS Code default —
 * hence no suggestions while typing a command name.
 *
 * Fix: `contributes.configurationDefaults` enables quick suggestions in strings for
 * the `cmake` language. This test pins that manifest shape so the fix cannot
 * silently regress. It reads `package.json` from disk, walking up from `__dirname`
 * so it works under both `yarn backendTests` (ts-node from `test/...`) and
 * `yarn unitTests` (compiled from `out/test/...`).
 */
function findExtensionManifest(): { contributes: any } {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
            const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            // Identify the CMake Tools extension manifest specifically (skip any stray
            // package.json) by its `cmake` language contribution.
            if (json?.contributes?.languages?.some((l: { id?: string }) => l.id === 'cmake')) {
                return json;
            }
        }
        dir = path.dirname(dir);
    }
    throw new Error('CMake Tools package.json (with a `cmake` language contribution) was not found');
}

suite('[completion-config] #4959 cmake quickSuggestions', () => {
    let contributes: any;
    suiteSetup(() => {
        contributes = findExtensionManifest().contributes;
    });

    test('declares configurationDefaults for the [cmake] language', () => {
        expect(contributes.configurationDefaults, 'contributes.configurationDefaults').to.be.an('object');
        expect(contributes.configurationDefaults['[cmake]'], 'configurationDefaults["[cmake]"]').to.be.an('object');
    });

    test('enables editor.quickSuggestions in strings so command completion auto-triggers', () => {
        const qs = contributes.configurationDefaults['[cmake]']['editor.quickSuggestions'];
        expect(qs, '[cmake] editor.quickSuggestions').to.be.an('object');
        // The essential fix: a command being typed sits in a `string.unquoted.cmake` scope
        // until "()" is added, so suggestions must be enabled in strings.
        expect(qs.strings, 'editor.quickSuggestions.strings').to.equal('on');
        // `other` stays on and `comments` off (the VS Code defaults) so non-string behavior is unchanged.
        expect(qs.other, 'editor.quickSuggestions.other').to.equal('on');
        expect(qs.comments, 'editor.quickSuggestions.comments').to.equal('off');
    });
});

/* eslint-disable no-unused-expressions */

import { CMakeCache, CacheEntryType } from '@cmt/cache';
import { CMakeProject } from '@cmt/cmakeProject';
import { clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';
import { fs } from '@cmt/pr';
import * as path from 'path';

suite('Environment Variables in Variants', () => {
    let cmakeProject: CMakeProject;
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
        cmakeProject = await CMakeProject.create(testEnv.wsContext, "${workspaceFolder}");

        // This test will use all on the same kit.
        // No rescan of the tools is needed
        // No new kit selection is needed
        await clearExistingKitConfigurationFile();
        await cmakeProject.setKit(await getFirstSystemKit());

        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
        const variantFileBackup = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
        if (await fs.exists(variantFileBackup)) {
            const variantFile = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
            await fs.rename(variantFileBackup, variantFile);
        }

        this.timeout(30000);
        await cmakeProject.asyncDispose();
        testEnv.teardown();
    });

    test('Replace default variant', async () => {
        const variantFile = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
        const variantFileBackup = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json.backup');
        await fs.rename(variantFile, variantFileBackup);
        expect(await fs.exists(variantFile)).to.be.false;

        // Set fake settings
        testEnv.config.updatePartial({
            defaultVariants: {
                buildType: {
                    default: 'debug-label',
                    choices: {
                        'debug-label': { short: 'debug-label short', buildType: 'Debug' },
                        'not-debug': { short: 'not-debug short', buildType: 'Release' }
                    }
                },
                otherVariant: {
                    default: 'option1',
                    choices: {
                        option1: { short: 'option1 short', env: { TEST_VARIANT_ENV: '0xCAFE' } },
                        option2: { short: 'option2 short' }
                    }
                }
            }
        });

        // Give enough time for the file watcher to kick in and update the variant manager
        await new Promise<void>(resolve => {
            setTimeout(() => {
                resolve();
            }, 2000);
        });

        try {
            // Configure
            expect((await cmakeProject.configure()).result).to.be.eq(0, '[variantEnv] configure failed');
            expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
            const cache = await CMakeCache.fromPath(await cmakeProject.cachePath);

            const cacheEntry_ = cache.get('variantEnv');
            expect(cacheEntry_).to.not.be.eq(null, '[variantEnv] Cache entry was not present');
            const cacheEntry = cacheEntry_!;
            expect(cacheEntry.type).to.eq(CacheEntryType.String, '[variantEnv] unexpected cache entry type');
            expect(cacheEntry.key).to.eq('variantEnv', '[variantEnv] unexpected cache entry key name');
            expect(typeof cacheEntry.value).to.eq('string', '[variantEnv] unexpected cache entry value type');
            expect(cacheEntry.as<string>()).to.eq('0xCAFE', '[variantEnv] incorrect environment variable');
        } finally {
            // Restore the vairants file to before the test
            await fs.rename(variantFileBackup, variantFile);
        }
    }).timeout(100000);
});

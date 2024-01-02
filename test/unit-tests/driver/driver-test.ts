/* eslint-disable no-unused-expressions */
import { CMakeExecutable, getCMakeExecutableInformation } from '@cmt/cmake/cmakeExecutable';
import { ConfigureTrigger } from '@cmt/cmakeProject';
import { ConfigurationReader } from '@cmt/config';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiString from 'chai-string';
import * as fs from 'fs';
import * as path from 'path';
import { CMakeFileApiDriver } from '@cmt/drivers/cmakeFileApiDriver';
import { CMakeServerDriver } from '@cmt/drivers/cmakeServerDriver';

chai.use(chaiString);

import { Kit, CMakeGenerator } from '@cmt/kit';
import { CMakePreconditionProblems, CMakeDriver, CMakePreconditionProblemSolver, NoGeneratorError, ConfigureResultType } from '@cmt/drivers/cmakeDriver';

const here = __dirname;
function getTestRootFilePath(filename: string): string {
    return path.normalize(path.join(here, '../../../..', filename));
}

function cleanupBuildDir(build_dir: string): boolean {
    fs.rmSync(build_dir, {recursive: true, force: true});
    return !fs.existsSync(build_dir);
}

export function makeDriverTestsuite(driverName: string, driver_generator: (cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit | null, workspaceFolder: string, preconditionHandler: CMakePreconditionProblemSolver, preferredGenerators: CMakeGenerator[]) => Promise<CMakeDriver>) {
    let driver: CMakeDriver | null = null;

    suite(`CMake ${driverName} driver tests`, () => {
        const cmakePath: string = process.env.CMAKE_EXECUTABLE ? process.env.CMAKE_EXECUTABLE : 'cmake';
        const defaultWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/test_project');
        const emptyWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/empty_project');
        const badCommandWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/bad_command');

        let ninjaKitDefault: Kit;
        if (process.platform === 'win32') {
            ninjaKitDefault = {
                name: 'Visual Studio Community 2019 - amd64',
                visualStudio: 'VisualStudio.16.0',
                visualStudioArchitecture: 'x64',
                preferredGenerator: { name: 'Ninja' }
            } as Kit;
        } else {
            ninjaKitDefault = { name: 'GCC', compilers: { C: 'gcc', CXX: 'g++' }, preferredGenerator: { name: 'Ninja' }, isTrusted: true } as Kit;
        }
        let secondaryKit: Kit;
        if (process.platform === 'win32') {
            secondaryKit = {
                name: 'Visual Studio Community 2019 - amd64',
                visualStudio: 'VisualStudio.16.0',
                visualStudioArchitecture: 'x64',
                preferredGenerator: {name: 'Visual Studio 16 2019', platform: 'x64'}
            } as Kit;
        } else {
            secondaryKit = { name: 'GCC', compilers: { C: 'gcc', CXX: 'g++' }, preferredGenerator: { name: 'Unix Makefiles' }, isTrusted: true } as Kit;
        }

        setup(async function (this: Mocha.Context, done) {
            driver = null;

            if (!cleanupBuildDir(path.join(defaultWorkspaceFolder, 'build'))) {
                done('Default build folder still exists');
            }

            if (!cleanupBuildDir(path.join(emptyWorkspaceFolder, 'build'))) {
                done('Empty project build folder still exists');
            }

            if (!cleanupBuildDir(path.join(badCommandWorkspaceFolder, 'build'))) {
                done('Bad command build folder still exists');
            }
            done();
        });

        teardown(async function (this: Mocha.Context) {
            this.timeout(20000);
            if (driver) {
                return driver.asyncDispose();
            }
        });

        test(`All target for ${ninjaKitDefault.name}`, async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            const allTargetName = driver.allTargetName;

            expect(allTargetName).to.eq('all');

        }).timeout(60000 * 2);

        test('Check binary dir', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            expect(driver.binaryDir).to.endsWith('test/unit-tests/driver/workspace/test_project/build');
        }).timeout(60000);

        test('Configure fails', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, badCommandWorkspaceFolder, async () => {}, []);
            expect((await driver.cleanConfigure(ConfigureTrigger.runTests, [])).result).to.be.eq(1);
        }).timeout(90000);

        test('Build', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            expect((await driver.cleanConfigure(ConfigureTrigger.runTests, [])).result).to.be.eq(0);
            expect(await driver.build([driver.allTargetName])).to.be.eq(0);

            expect(driver.executableTargets.length).to.be.eq(2);
            const targetInTopLevelBuildDir = driver.executableTargets.find(t => t.name === 'TestBuildProcess');
            expect(targetInTopLevelBuildDir).to.not.undefined;
            expect(fs.existsSync(targetInTopLevelBuildDir!.path)).to.be.true;

            const targetInRuntimeOutputDir = driver.executableTargets.find(t => t.name === 'TestBuildProcessOtherOutputDir');
            expect(targetInRuntimeOutputDir).to.not.undefined;
            expect(fs.existsSync(targetInRuntimeOutputDir!.path)).to.be.true;
        }).timeout(90000);

        test('Configure fails on invalid preferred generator', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            const kit = { name: 'GCC', preferredGenerator: { name: 'invalid Name' } } as Kit;

            try {
                await driver_generator(executable, config, kit, defaultWorkspaceFolder, async () => {}, []);
                expect(false, 'configure did not detect the invalid generator').to.be.true;
            } catch (e) {
                if (!(e instanceof NoGeneratorError)) {
                    expect(false, `configure threw the wrong Error type: ${typeof(e)}`).to.be.true;
                }
            }
        }).timeout(60000);

        test('Test compiler name reporting for telemetry', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);
            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);

            // A few path examples that would exercise through the telemetry reporting rules:
            // - any name that is not recognized is reported as "other"
            // - any architecture reference found in either suffix or prefix is appended to the telemetry filtered name
            //   (architecture specific keywords being arm, arm64, eabi and aarch64)
            // - include a few of the compiler names that are substrings of others
            let compilerInfo = await driver.getCompilerVersion("drive/folder/path/aarch64_clang++");
            expect(compilerInfo.name).to.be.eq("clang++-aarch64");
            compilerInfo = await driver.getCompilerVersion("drive/folder/path/clang_eabi");
            expect(compilerInfo.name).to.be.eq("clang-eabi");
            compilerInfo = await driver.getCompilerVersion("drive/folder/path/cl.exe");
            expect(compilerInfo.name).to.be.eq("cl");
            compilerInfo = await driver.getCompilerVersion("drive/folder/path/arm-xlc++");
            expect(compilerInfo.name).to.be.eq("xlc++-arm");
            compilerInfo = await driver.getCompilerVersion("drive/folder/path/other-prefix-gcc");
            expect(compilerInfo.name).to.be.eq("gcc");
            compilerInfo = await driver.getCompilerVersion("drive/folder/path/cc-other-suffix");
            expect(compilerInfo.name).to.be.eq("cc");
            compilerInfo = await driver.getCompilerVersion("drive/folder/path/unknown-arm64-compiler");
            expect(compilerInfo.name).to.be.eq("other-arm64");
        }).timeout(90000);

        test('Set kit without a preferred generator', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);

            // Set kit without a preferred generator
            await driver.setKit({ name: 'GCC', isTrusted: true }, []);
            expect((await driver.cleanConfigure(ConfigureTrigger.runTests, [])).result).to.be.eq(0);
            const kit1 = driver.cmakeCacheEntries?.get('CMAKE_GENERATOR')!.value;

            // Set kit with a list of two default preferred generators, for comparison
            await driver.setKit({ name: 'GCC', isTrusted: true }, [{ name: 'Ninja' }, { name: 'Unix Makefiles' }]);
            expect((await driver.configure(ConfigureTrigger.runTests, [])).result).to.be.eq(0);
            const kit2 = driver.cmakeCacheEntries?.get('CMAKE_GENERATOR')!.value;

            expect(kit1).to.be.equal(kit2);
        }).timeout(90000);

        test('Try build on empty dir', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                expect(e).to.be.eq(CMakePreconditionProblems.MissingCMakeListsFile);
                called = true;
            };
            driver = await driver_generator(executable, config, ninjaKitDefault, emptyWorkspaceFolder, checkPreconditionHelper, []);
            expect((await driver.cleanConfigure(ConfigureTrigger.runTests, [])).result).to.be.eq(-2);
            expect(called).to.be.true;
        }).timeout(60000);

        test('No parallel configuration', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
                called = true;
            };
            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
            const configure1 = driver.configure(ConfigureTrigger.runTests, []);
            const configure2 = driver.configure(ConfigureTrigger.runTests, []);

            expect((await configure1).result).to.be.equal(0);
            expect((await configure2).result).to.be.equal(-1);
            expect(called).to.be.true;
        }).timeout(90000);

        test('No parallel clean configuration', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
                called = true;
            };
            driver
                = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
            const configure1 = driver.cleanConfigure(ConfigureTrigger.runTests, []);
            const configure2 = driver.cleanConfigure(ConfigureTrigger.runTests, []);

            expect((await configure1).result).to.be.equal(0);
            expect((await configure2).result).to.be.equal(-1);
            expect(called).to.be.true;
        }).timeout(90000);

        test('No parallel builds', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                if (e === CMakePreconditionProblems.BuildIsAlreadyRunning) {
                    called = true;
                }
            };
            driver
                = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
            expect((await driver.configure(ConfigureTrigger.runTests, [])).result).to.be.equal(0);
            const build1 = driver.build([driver.allTargetName]);
            const build2 = driver.build([driver.allTargetName]);

            expect(await build1).to.be.equal(0);
            expect(await build2).to.be.equal(-1);
            expect(called).to.be.true;
        }).timeout(90000);

        test('No build parallel to configure', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                if (e === CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
                    called = true;
                }
            };
            driver
                = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
            expect((await driver.configure(ConfigureTrigger.runTests, [])).result).to.be.equal(0);
            const configure = driver.configure(ConfigureTrigger.runTests, []);
            const build = driver.build([driver.allTargetName]);

            expect(await configure).to.be.deep.equal({ result: 0, resultType: ConfigureResultType.NormalOperation });
            expect(await build).to.be.equal(-1);
            expect(called).to.be.true;
        }).timeout(90000);

        test('No configure parallel to build', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                if (e === CMakePreconditionProblems.BuildIsAlreadyRunning) {
                    called = true;
                }
            };
            driver
                = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
            expect((await driver.configure(ConfigureTrigger.runTests, [])).result).to.be.equal(0);
            const build = driver.build([driver.allTargetName]);
            const configure = driver.configure(ConfigureTrigger.runTests, []);

            expect(await build).to.be.equal(0);
            expect((await configure).result).to.be.equal(-1);
            expect(called).to.be.true;
        }).timeout(90000);

        test('No build parallel to clean configuration', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                if (e === CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
                    called = true;
                }
            };
            driver
                = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
            const configure = driver.cleanConfigure(ConfigureTrigger.runTests, []);
            const build = driver.build([driver.allTargetName]);

            expect(await configure).to.be.deep.equal({ result: 0, resultType: ConfigureResultType.NormalOperation });
            expect(await build).to.be.equal(-1);
            expect(called).to.be.true;
        }).timeout(90000);

        test('No clean configuration parallel to build', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            let called = false;
            const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
                if (e === CMakePreconditionProblems.BuildIsAlreadyRunning) {
                    called = true;
                }
            };
            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
            expect((await driver.configure(ConfigureTrigger.runTests, [])).result).to.be.equal(0);
            const build = driver.build([driver.allTargetName]);
            const configure = (await driver.cleanConfigure(ConfigureTrigger.runTests, [])).result;

            expect(await build).to.be.equal(0);
            expect(configure).to.be.equal(-1);
            expect(called).to.be.true;
        }).timeout(90000);

        test('Test pre-configured workspace', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, secondaryKit, defaultWorkspaceFolder, async () => {}, []);
            await driver.cleanConfigure(ConfigureTrigger.runTests, []);
            await driver.asyncDispose();

            driver = null;
            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            expect((await driver.configure(ConfigureTrigger.runTests, [])).result).to.be.eq(0);

            const expFileApi = driver instanceof CMakeFileApiDriver;
            const expSrv = driver instanceof CMakeServerDriver;
            expect(!expFileApi || !expSrv); // mutually exclusive

            // Configure with a different generator should overwrite the previous Ninja generator
            // for fileApi and not for cmakeServer communication modes.
            const kitBaseline = expFileApi ? ninjaKitDefault : secondaryKit;
            expect(driver.generatorName).to.be.eq(kitBaseline.preferredGenerator!.name);
            expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq(kitBaseline.preferredGenerator!.name);
        }).timeout(60000);

        test('Test generator switch', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            await driver.cleanConfigure(ConfigureTrigger.runTests, []);
            expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq('Ninja');

            // Change the generator from Ninja to 'Visual Studio 16 2019'/'Unix Makefiles'.
            if (process.platform === 'win32') {
                await driver.setKit(secondaryKit, [{name: 'Visual Studio 16 2019', platform: 'x64'}]);
            } else {
                await driver.setKit(secondaryKit, [{ name: 'Unix Makefiles' }]);
            }

            expect((await driver.configure(ConfigureTrigger.runTests, [])).result).to.be.eq(0);
            expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.not.eq('Ninja');

            if (process.platform === 'win32') {
                expect(driver.allTargetName).to.eq('ALL_BUILD');
            } else {
                expect(driver.allTargetName).to.eq('all');
            }

        }).timeout(90000);

        test('Test Visual Studio kit with wrong all target name', async () => {
            if (process.platform !== 'win32') {
                return;
            }
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, secondaryKit, defaultWorkspaceFolder, async () => {}, []);
            await driver.cleanConfigure(ConfigureTrigger.runTests, []);
            expect(await driver.build(['all'])).to.be.eq(0, 'Automatic correction of all target failed');
        }).timeout(90000);

        test('Test Ninja kit with wrong all target name', async () => {
            if (process.platform !== 'win32') {
                return;
            }
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            await driver.cleanConfigure(ConfigureTrigger.runTests, []);
            expect(await driver.build(['ALL_BUILD'])).to.be.eq(0, 'Automatic correction of ALL_BUILD target failed');
        }).timeout(90000);

        test('Test extra arguments on configure', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            await driver.configure(ConfigureTrigger.runTests, ['-DEXTRA_ARGS_TEST=Hallo']);
            expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')?.value).to.be.eq('Hallo');
        }).timeout(90000);

        test('Test extra arguments on clean and configure', async () => {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, ninjaKitDefault, defaultWorkspaceFolder, async () => {}, []);
            await driver.cleanConfigure(ConfigureTrigger.runTests, ['-DEXTRA_ARGS_TEST=Hallo']);
            expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')?.value).to.be.eq('Hallo');
        }).timeout(90000);
    });
}

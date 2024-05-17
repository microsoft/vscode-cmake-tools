/* eslint-disable no-unused-expressions */
import { CMakeExecutable, getCMakeExecutableInformation } from '@cmt/cmake/cmakeExecutable';
import { ConfigurationReader } from '@cmt/config';
import { ConfigureTrigger } from '@cmt/cmakeProject';
import { CodeModelContent } from '@cmt/drivers/codeModel';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiString from 'chai-string';
import * as fs from 'fs';
import * as path from 'path';

chai.use(chaiString);

import { Kit, CMakeGenerator } from '@cmt/kit';
import { CMakeDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/cmakeDriver';
import { CMakeLegacyDriver } from '@cmt/drivers/cmakeLegacyDriver';

const here = __dirname;
function getTestRootFilePath(filename: string): string {
    return path.normalize(path.join(here, '../../../..', filename));
}

function cleanupBuildDir(build_dir: string): boolean {
    fs.rmSync(build_dir, {recursive: true, force: true});
    return !fs.existsSync(build_dir);
}

let driver: CMakeDriver | null = null;

export function makeCodeModelDriverTestsuite(driverName: string, driver_generator: (cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit | null, workspaceFolder: string, preconditionHandler: CMakePreconditionProblemSolver, preferredGenerators: CMakeGenerator[]) => Promise<CMakeDriver>) {
    suite(`CMake CodeModel ${driverName} Driver tests`, () => {
        const cmakePath: string = process.env.CMAKE_EXECUTABLE ? process.env.CMAKE_EXECUTABLE : 'cmake';
        const workspacePath: string = 'test/unit-tests/driver/workspace';
        const root = getTestRootFilePath(workspacePath);
        const defaultWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/test_project');
        const emptyWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/empty_project');
        const sourceOutsideOfWorkspace
            = getTestRootFilePath('test/unit-tests/driver/workspace/source_outside_of_workspace/workspace');

        let kitDefault: Kit;
        if (process.platform === 'win32') {
            kitDefault = {
                name: 'Visual Studio Community 2019',
                visualStudio: 'VisualStudio.16.0',
                visualStudioArchitecture: 'x64',
                preferredGenerator: {name: 'Visual Studio 16 2019', platform: 'x64', toolset: 'host=x64'}
            } as Kit;
        } else {
            kitDefault = { name: 'GCC', compilers: { C: 'gcc', CXX: 'g++' }, preferredGenerator: { name: 'Unix Makefiles' }, isTrusted: true } as Kit;
        }

        setup(async function (this: Mocha.Context, done) {
            driver = null;

            if (!cleanupBuildDir(path.join(defaultWorkspaceFolder, 'build'))) {
                done('Default build folder still exists');
            }

            if (!cleanupBuildDir(path.join(emptyWorkspaceFolder, 'build'))) {
                done('Empty project build folder still exists');
            }

            if (!cleanupBuildDir(path.join(sourceOutsideOfWorkspace, 'build'))) {
                done('Source-outside-of-workspace project build folder still exists');
            }

            done();
        });

        teardown(async function (this: Mocha.Context) {
            this.timeout(20000);
            if (driver) {
                return driver.asyncDispose();
            }
        });

        async function generateCodeModelForConfiguredDriver(args: string[] = [],
            workspaceFolder: string = defaultWorkspaceFolder):
            Promise<null | CodeModelContent> {
            const config = ConfigurationReader.create();
            const executable = await getCMakeExecutableInformation(cmakePath);

            driver = await driver_generator(executable, config, kitDefault, workspaceFolder, async () => {}, []);
            let code_model: null | CodeModelContent = null;
            if (driver && !(driver instanceof CMakeLegacyDriver)) {
                driver.onCodeModelChanged(cm => {
                    code_model = cm;
                });
            }
            expect((await driver.configure(ConfigureTrigger.runTests, args)).result).to.be.eq(0);
            return code_model;
        }

        test('Test generation of code model with multi configuration like VS', async () => {
            if (process.platform !== 'win32') {
                return;
            }

            const codemodel_data = await generateCodeModelForConfiguredDriver();
            expect(codemodel_data).to.be.not.null;
            expect(codemodel_data!.configurations.length).to.be.eql(4);
        }).timeout(90000);

        test('Test generation of code model with one configuration like make on linux', async () => {
            if (process.platform === 'win32') {
                return;
            }

            const codemodel_data = await generateCodeModelForConfiguredDriver();
            expect(codemodel_data).to.be.not.null;
            expect(codemodel_data!.configurations.length).to.be.eql(1);
        }).timeout(90000);

        test('Test project information', async () => {
            const codemodel_data = await generateCodeModelForConfiguredDriver();
            expect(codemodel_data).to.be.not.null;

            const project = codemodel_data!.configurations[0].projects[0];

            // Test project name
            expect(project.name).to.be.eq('TestBuildProcess');

            // Test location of project source directory
            // Used by tree view to make paths relative
            expect(path.normalize(project.sourceDirectory).toLowerCase())
                .to.eq(path.normalize(path.join(root, 'test_project')).toLowerCase());
        }).timeout(90000);

        test('Test executable target information', async () => {
            const codemodel_data = await generateCodeModelForConfiguredDriver();
            expect(codemodel_data).to.be.not.null;

            const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type === 'EXECUTABLE' && t.name === 'TestBuildProcess');
            expect(target).to.be.not.undefined;

            // Test target name used for node label
            expect(target!.name).to.be.eq('TestBuildProcess');
            const executableName = process.platform === 'win32' ? 'TestBuildProcess.exe' : 'TestBuildProcess';
            expect(target!.fullName).to.be.eq(executableName);
            expect(target!.type).to.be.eq('EXECUTABLE');

            // Test location of project source directory
            // used by tree view to make paths relative
            expect(path.normalize(target!.sourceDirectory!).toLowerCase())
                .to.eq(path.normalize(path.join(root, 'test_project')).toLowerCase());

            // Test main source file used in by tree view
            expect(target!.fileGroups).to.be.not.undefined;
            const compile_information = target!.fileGroups!.find((t: any) => !!t.language);

            expect(compile_information).to.be.not.undefined;
            expect(compile_information!.sources).to.include('main.cpp');
        }).timeout(90000);

        test('Test first static library target directory', async () => {
            const codemodel_data = await generateCodeModelForConfiguredDriver();
            expect(codemodel_data).to.be.not.null;

            const target = codemodel_data!.configurations[0].projects[0].targets.find((t: any) => t.type === 'STATIC_LIBRARY');
            expect(target).to.be.not.undefined;

            // Test target name used for node label
            expect(target!.name).to.be.eq('StaticLibDummy');
            const executableName = process.platform === 'win32' ? 'StaticLibDummy.lib' : 'libStaticLibDummy.a';
            expect(target!.fullName).to.be.eq(executableName);
            expect(target!.type).to.be.eq('STATIC_LIBRARY');

            // Test location of project source directory
            // Used by tree view to make paths relative
            expect(path.normalize(target!.sourceDirectory!).toLowerCase())
                .to.eq(path.normalize(path.join(root, 'test_project', 'static_lib_dummy')).toLowerCase());

            // Language
            const compile_information = target!.fileGroups!.find((t: any) => !!t.language);
            expect(compile_information).to.be.not.undefined;
            expect(compile_information!.language).to.eq('CXX');

            // Test main source file
            expect(compile_information!.sources).to.include('info.cpp');
            expect(compile_information!.sources).to.include('test2.cpp');

            // compile flags or fragments for file groups
            if (process.platform === 'win32') {
                expect(compile_information!.compileCommandFragments?.map(str => str.trim()).join(' ')).to.eq('/DWIN32 /D_WINDOWS /W3 /GR /EHsc /MDd /Zi /Ob0 /Od /RTC1');
            }
        }).timeout(90000);

        test('Test first shared library target directory', async () => {
            const codemodel_data = await generateCodeModelForConfiguredDriver();
            expect(codemodel_data).to.be.not.null;

            const target = codemodel_data!.configurations[0].projects[0].targets.find((t: any) => t.type === 'SHARED_LIBRARY');
            expect(target).to.be.not.undefined;

            // Test target name used for node label
            expect(target!.name).to.be.eq('SharedLibDummy');
            const executableNameRegex
                = process.platform === 'win32' ? /^SharedLibDummy.dll/ : /^libSharedLibDummy.(so|dylib)/;
            expect(target!.fullName).to.match(executableNameRegex);
            expect(target!.type).to.be.eq('SHARED_LIBRARY');

            // Test location of project source directory
            // Used by tree view to make paths relative
            expect(path.normalize(target!.sourceDirectory!).toLowerCase())
                .to.eq(path.normalize(path.join(root, 'test_project', 'shared_lib_dummy')).toLowerCase());

            // Test main source file
            expect(target!.fileGroups).to.be.not.undefined;
            expect(target!.fileGroups![0].sources[0]).to.eq('src/info.c');
            expect(target!.fileGroups![0].defines).contains('TEST_CMAKE_DEFINE');
            expect(target!.fileGroups![0].isGenerated).to.be.false;
            expect(path.normalize(target!.fileGroups![0].includePath![0].path).toLowerCase())
                .to.eq(path.normalize(path.join(root, 'test_project', 'shared_lib_dummy', 'inc')).toLowerCase());

            // Language
            expect(target!.fileGroups![0].language).to.eq('C');

            // compile flags or fragments for file groups
            if (process.platform === 'win32') {
                expect(target!.fileGroups![0].compileCommandFragments?.map(str => str.trim()).join(' ')).to.eq('/DWIN32 /D_WINDOWS /W3 /MDd /Zi /Ob0 /Od /RTC1');
            }

        }).timeout(90000);

        test('Test cache access', async () => {
            const codemodel_data = await generateCodeModelForConfiguredDriver();
            expect(codemodel_data).to.be.not.null;

            const target = codemodel_data!.configurations[0].projects[0].targets.find((t: any) => t.type === 'UTILITY'
                && t.name === 'runTestTarget');
            expect(target).to.be.not.undefined;

            // maybe could be used to exclude file list from utility targets
            expect(target!.fileGroups![0].isGenerated).to.be.true;
        }).timeout(90000);

        test('Test sysroot access', async () => {
            // This test does not work with VisualStudio.
            // VisualStudio generator does not provide the sysroot in the code model.
            // macOS has separate sysroot variable (see CMAKE_OSX_SYSROOT); this build fails.
            if (process.platform === 'win32' || process.platform === 'darwin') {
                return;
            }

            const codemodel_data = await generateCodeModelForConfiguredDriver(['-DCMAKE_SYSROOT=/tmp']);
            expect(codemodel_data).to.be.not.null;

            const target = codemodel_data!.configurations[0].projects[0].targets.find((t: any) => t.type === 'EXECUTABLE');
            expect(target).to.be.not.undefined;
            expect(target!.sysroot).to.be.eq('/tmp');
        }).timeout(90000);

        test('Test source files outside of workspace root', async () => {
            const project_name: string = 'source_outside_of_workspace';
            const codemodel_data = await generateCodeModelForConfiguredDriver([], sourceOutsideOfWorkspace);
            expect(codemodel_data).to.be.not.null;

            for (const [target_name, target_subdir, sourcefile_name] of [['root_target', '', '../main.cpp'], ['subdir_target', 'subdir', '../../main.cpp']] as const) {
                const target = codemodel_data!.configurations[0].projects[0].targets.find((t: any) => t.type === 'EXECUTABLE'
                    && t.name === target_name);
                expect(target).to.be.not.undefined;

                // Assert correct target names for node labels
                const executableName = target_name + (process.platform === 'win32' ? '.exe' : '');
                expect(target!.fullName).to.be.eq(executableName);

                // Assert correct location of target source directories
                expect(path.normalize(target!.sourceDirectory!).toLowerCase())
                    .to.eq(path.normalize(path.join(root, project_name, 'workspace', target_subdir)).toLowerCase());

                // Assert correct path to source file
                expect(target!.fileGroups).to.be.not.undefined;
                const compile_information = target!.fileGroups!.find((t: any) => !!t.language);
                expect(compile_information).to.be.not.undefined;
                const sources: string[] = [];
                compile_information!.sources.forEach((source: any) => {
                    sources.push(path.normalize(source).toLowerCase());
                });
                expect(sources).to.include(path.normalize(sourcefile_name).toLowerCase());
            }
        }).timeout(90000);
    });
}

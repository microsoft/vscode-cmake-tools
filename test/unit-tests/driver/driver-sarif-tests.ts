/* eslint-disable no-unused-expressions */
import { CMakeExecutable, getCMakeExecutableInformation } from '@cmt/cmakeExecutable';
import { ConfigureTrigger } from '@cmt/cmakeProject';
import { ConfigurationReader } from '@cmt/config';
import { CMakeOutputConsumer } from '@cmt/diagnostics/cmake';
import { CMakeDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/cmakeDriver';
import { CMakeGenerator, Kit } from '@cmt/kits/kit';
import { ConfigurePreset } from '@cmt/presets/preset';
import * as util from '@cmt/util';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

const here = __dirname;
function getTestRootFilePath(filename: string): string {
    return path.normalize(path.join(here, '../../../..', filename));
}

export function makeSarifDriverTestsuite(driverName: string, driver_generator: (cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit | null, workspaceFolder: string, preconditionHandler: CMakePreconditionProblemSolver, preferredGenerators: CMakeGenerator[], configurePreset?: ConfigurePreset) => Promise<CMakeDriver>, driverSupportsCMake: (cmake: CMakeExecutable) => boolean) {
    suite(`CMake SARIF ${driverName} driver tests`, () => {
        const cmakePath: string = process.env.CMAKE_EXECUTABLE ? process.env.CMAKE_EXECUTABLE : 'cmake';
        const projectDir = getTestRootFilePath('test/unit-tests/driver/workspace/sarif_project');
        const buildDir = path.join(projectDir, 'build');
        const sarifLog = path.join(buildDir, '.cmake', 'sarif', 'cmake.sarif');

        const kit: Kit = process.platform === 'win32'
            ? { name: 'Visual Studio Community 2022 - amd64', visualStudio: 'VisualStudio.17.0', visualStudioArchitecture: 'x64', preferredGenerator: { name: 'Ninja' } } as Kit
            : { name: 'GCC', compilers: { C: 'gcc', CXX: 'g++' }, preferredGenerator: { name: 'Ninja' }, isTrusted: true } as Kit;

        let sandbox: sinon.SinonSandbox;
        let driver: CMakeDriver | null = null;
        let cmake: CMakeExecutable;
        let config: ConfigurationReader;

        function setExportSarifFile(value: boolean) {
            const getConfiguration = vscode.workspace.getConfiguration;
            sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string, scope?: vscode.ConfigurationScope | null) => {
                const configuration = getConfiguration(section, scope);
                if (section !== 'cmake') {
                    return configuration;
                }
                // The configuration is frozen, so override `get` on an object derived from it.
                return Object.defineProperty(Object.create(configuration), 'get', {
                    value: (key: string, defaultValue?: unknown) => key === 'exportSarifFile' ? value : configuration.get(key, defaultValue)
                });
            });
        }

        async function createKitsDriver() {
            return driver_generator(cmake, config, kit, projectDir, async () => true, []);
        }

        async function createPresetsDriver(cacheVariables: ConfigurePreset['cacheVariables']) {
            const configurePreset = { name: 'sarif', binaryDir: buildDir, generator: 'Ninja', cacheVariables } as ConfigurePreset;
            return driver_generator(cmake, config, null, projectDir, async () => true, [], configurePreset);
        }

        /** CMAKE_EXPORT_SARIF as the configure left it in the cache, if at all. */
        function cachedExportSarif(): boolean | undefined {
            const entry = driver!.cmakeCacheEntries.get('CMAKE_EXPORT_SARIF');
            return entry === undefined ? undefined : util.isTruthy(entry.value);
        }

        setup(async function (this: Mocha.Context) {
            this.timeout(30000);
            fs.rmSync(buildDir, { recursive: true, force: true });
            sandbox = sinon.createSandbox();
            driver = null;
            config = ConfigurationReader.create();
            cmake = await getCMakeExecutableInformation(cmakePath);
            if (!driverSupportsCMake(cmake) || !cmake.isSarifExportSupported) {
                this.skip();
            }
        });

        teardown(async function (this: Mocha.Context) {
            this.timeout(20000);
            sandbox.restore();
            if (driver) {
                await driver.asyncDispose();
            }
        });

        suite('Kits Flag Injection', () => {
            test('Should inject CMAKE_EXPORT_SARIF when cmake.exportSarifFile is enabled', async () => {
                setExportSarifFile(true);
                driver = await createKitsDriver();
                expect((await driver.configure(ConfigureTrigger.runTests, [])).exitCode).to.eq(0);
                expect(cachedExportSarif()).to.eq(true);
                expect(fs.existsSync(sarifLog)).to.be.true;
            }).timeout(60000);

            test('Ignore CMAKE_EXPORT_SARIF when cmake.exportSarifFile is disabled', async () => {
                setExportSarifFile(false);
                driver = await createKitsDriver();
                expect((await driver.configure(ConfigureTrigger.runTests, [])).exitCode).to.eq(0);
                expect(cachedExportSarif()).to.be.undefined;
                expect(fs.existsSync(sarifLog)).to.be.false;
            }).timeout(60000);

            test('CMAKE_EXPORT_SARIF value in cmake.configureSettings wins over cmake.exportSarifFile', async () => {
                setExportSarifFile(true);
                config.updatePartial({ configureSettings: { CMAKE_EXPORT_SARIF: false } });
                driver = await createKitsDriver();
                expect((await driver.configure(ConfigureTrigger.runTests, [])).exitCode).to.eq(0);
                expect(cachedExportSarif()).to.eq(false);
                expect(fs.existsSync(sarifLog)).to.be.false;
            }).timeout(60000);
        });

        suite('Presets Flag Injection', () => {
            test('Should inject CMAKE_EXPORT_SARIF when cmake.exportSarifFile is enabled', async () => {
                setExportSarifFile(true);
                driver = await createPresetsDriver({});
                expect((await driver.configure(ConfigureTrigger.runTests, [])).exitCode).to.eq(0);
                expect(cachedExportSarif()).to.eq(true);
                expect(fs.existsSync(sarifLog)).to.be.true;
            }).timeout(60000);

            test('Do not inject CMAKE_EXPORT_SARIF when set in the preset\'s cacheVariables', async () => {
                setExportSarifFile(true);
                driver = await createPresetsDriver({ CMAKE_EXPORT_SARIF: 'OFF' });
                expect((await driver.configure(ConfigureTrigger.runTests, [])).exitCode).to.eq(0);
                expect(cachedExportSarif()).to.eq(false);
                expect(fs.existsSync(sarifLog)).to.be.false;
            }).timeout(60000);
        });

        test('cmake.loadSarifFile should ignore logs from CMake older than 4.5', async () => {
            setExportSarifFile(true);
            config.updatePartial({ loadSarifFile: true });
            driver = await createKitsDriver();
            driver.cmake = { ...cmake, isRichSarifSupported: false };
            const result = await driver.configure(ConfigureTrigger.runTests, []);
            expect(result.exitCode).to.eq(0);
            expect(fs.existsSync(sarifLog)).to.be.true;
            expect(result.sarifDiagnostics).to.not.be.ok;
        }).timeout(60000);

        suite('Loading SARIF diagnostics', () => {
            setup(function (this: Mocha.Context) {
                if (!cmake.isRichSarifSupported) {
                    this.skip();
                }
            });

            test('SARIF diagnostics are returned when cmake.loadSarifFile is enabled', async () => {
                setExportSarifFile(true);
                config.updatePartial({ loadSarifFile: true });
                driver = await createKitsDriver();
                const consumer = new CMakeOutputConsumer(projectDir);
                const result = await driver.configure(ConfigureTrigger.runTests, [], consumer);
                expect(result.exitCode).to.eq(0);

                const where = (d: { filepath: string; diag: vscode.Diagnostic }) => `${util.lightNormalizePath(d.filepath)}:${d.diag.range.start.line + 1}`;
                const expected = `${util.lightNormalizePath(path.join(projectDir, 'CMakeLists.txt'))}:5`;
                expect(consumer.diagnostics.map(where)).to.deep.equal([expected]);
                expect(result.sarifDiagnostics?.map(where)).to.deep.equal([expected]);
                expect(result.sarifDiagnostics![0].diag.message).to.eq('SARIF driver test warning');
            }).timeout(60000);

            test('SARIF diagnostics are ignored when cmake.loadSarifFile is disabled', async () => {
                setExportSarifFile(true);
                config.updatePartial({ loadSarifFile: false });
                driver = await createKitsDriver();
                const result = await driver.configure(ConfigureTrigger.runTests, []);
                expect(result.exitCode).to.eq(0);
                expect(fs.existsSync(sarifLog)).to.be.true;
                expect(result.sarifDiagnostics).to.not.be.ok;
            }).timeout(60000);

            test('A stale log is ignored', async () => {
                setExportSarifFile(true);
                config.updatePartial({ loadSarifFile: true });
                driver = await createKitsDriver();
                expect((await driver.configure(ConfigureTrigger.runTests, [])).sarifDiagnostics).to.have.lengthOf(1);

                const result = await driver.configure(ConfigureTrigger.runTests, ['-DCMAKE_EXPORT_SARIF=OFF']);
                expect(result.exitCode).to.eq(0);
                expect(fs.existsSync(sarifLog)).to.be.true;
                expect(result.sarifDiagnostics).to.not.be.ok;
            }).timeout(60000);
        });
    });
}

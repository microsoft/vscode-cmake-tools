import {ConfigurationReader, ExtensionConfigurationSettings} from '@cmt/config';
import {expect} from '@test/util';


function createConfig(conf: Partial<ExtensionConfigurationSettings>): ConfigurationReader {
  const ret = new ConfigurationReader({
    autoSelectActiveFolder: false,
    cmakePath: '',
    buildDirectory: '',
    installPrefix: null,
    sourceDirectory: '',
    saveBeforeBuild: true,
    buildBeforeRun: true,
    clearOutputBeforeBuild: true,
    configureSettings: {},
    cacheInit: null,
    preferredGenerators: [],
    generator: null,
    toolset: null,
    platform: null,
    configureArgs: [],
    buildArgs: [],
    buildToolArgs: [],
    parallelJobs: 0,
    ctestPath: '',
    ctest: {
      parallelJobs: 0,
    },
    parseBuildDiagnostics: true,
    enabledOutputParsers: [],
    debugConfig: {},
    defaultVariants: {},
    ctestArgs: [],
    environment: {},
    configureEnvironment: {},
    buildEnvironment: {},
    testEnvironment: {},
    mingwSearchDirs: [],
    emscriptenSearchDirs: [],
    copyCompileCommands: null,
    configureOnOpen: null,
    configureOnEdit: true,
    skipConfigureIfCachePresent: null,
    useCMakeServer: true,
    cmakeCommunicationMode: 'automatic',
    ignoreKitEnv: false,
    buildTask: false,
    outputLogEncoding: 'auto',
    enableTraceLogging: false,
    loggingLevel: 'info',
    statusbar: {
      advanced: {},
      visibility: "default"
    }
  });
  ret.updatePartial(conf);
  return ret;
}

suite('[Configuration]', () => {
  test('Create a read from a configuration', () => {
    const conf = createConfig({parallelJobs: 13});
    expect(conf.parallelJobs).to.eq(13);
  });

  test('Update a configuration', () => {
    const conf = createConfig({parallelJobs: 22});
    expect(conf.parallelJobs).to.eq(22);
    conf.updatePartial({parallelJobs: 4});
    expect(conf.parallelJobs).to.eq(4);
  });

  test('Listen for config changes', () => {
    const conf = createConfig({parallelJobs: 22});
    let jobs = conf.parallelJobs;
    expect(jobs).to.eq(22);
    conf.onChange('parallelJobs', j => jobs = j);
    conf.updatePartial({parallelJobs: 3});
    expect(jobs).to.eq(3);
  });

  test('Listen only fires for changing properties', () => {
    const conf = createConfig({parallelJobs: 3});
    let fired = false;
    conf.onChange('parallelJobs', _ => fired = true);
    conf.updatePartial({buildDirectory: 'foo'});
    expect(!fired, 'Event fired when it should not have');
    conf.updatePartial({parallelJobs: 4});
    expect(fired, 'Update event did not fire');
  });

  test('Unchanged values in partial update are unaffected', () => {
    const conf = createConfig({parallelJobs: 5});
    conf.updatePartial({buildDirectory: 'Foo'});
    expect(conf.parallelJobs).to.eq(5);
  });
});
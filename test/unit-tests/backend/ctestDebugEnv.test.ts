import { expect } from 'chai';
import { Environment, EnvironmentUtils } from '@cmt/environmentVariables';
import { fromDebuggerEnvironmentVars, makeDebuggerEnvironmentVars } from '@cmt/util';

/**
 * Mirrors of the environment composition used when debugging a CTest test, so the precedence can be
 * verified without a VS Code instance or a live CMake driver.
 */

interface DriverEnvironmentState {
    useCMakePresets: boolean;
    testPresetEnvironment?: Environment;
    configurePresetEnvironment?: Environment;
    kitEnvironment?: Environment;
    variantEnvironment?: Environment;
    /** `cmake.environment` */
    settingsEnvironment?: Environment;
    /** `cmake.testEnvironment` */
    settingsTestEnvironment?: Environment;
    /** `cmake.configureEnvironment` */
    settingsConfigureEnvironment?: Environment;
}

/** Mirror of CMakeDriver.getCTestCommandEnvironment(). */
function getCTestCommandEnvironment(driver: DriverEnvironmentState): Environment {
    if (driver.useCMakePresets) {
        let envs = EnvironmentUtils.create(driver.testPresetEnvironment);
        envs = EnvironmentUtils.merge([envs, driver.settingsEnvironment]);
        envs = EnvironmentUtils.merge([envs, driver.settingsTestEnvironment]);
        return envs;
    }
    let envs = EnvironmentUtils.create(driver.kitEnvironment);
    envs = EnvironmentUtils.merge([envs, driver.settingsEnvironment]);
    envs = EnvironmentUtils.merge([envs, driver.settingsTestEnvironment]);
    envs = EnvironmentUtils.merge([envs, driver.variantEnvironment]);
    return envs;
}

/** Mirror of CMakeDriver.getConfigureEnvironment(), i.e. the environment CTest debugging used before. */
function getConfigureEnvironment(driver: DriverEnvironmentState): Environment {
    if (driver.useCMakePresets) {
        let envs = EnvironmentUtils.create(driver.configurePresetEnvironment);
        envs = EnvironmentUtils.merge([envs, driver.settingsEnvironment]);
        envs = EnvironmentUtils.merge([envs, driver.settingsConfigureEnvironment]);
        return envs;
    }
    let envs = EnvironmentUtils.create(driver.kitEnvironment);
    envs = EnvironmentUtils.merge([envs, driver.settingsEnvironment]);
    envs = EnvironmentUtils.merge([envs, driver.settingsConfigureEnvironment]);
    envs = EnvironmentUtils.merge([envs, driver.variantEnvironment]);
    return envs;
}

/** Mirror of CMakeProject.mergeLaunchEnvironment() (expansion of plain values is the identity). */
function mergeLaunchEnvironment(baseEnv: Environment | undefined, debugEnv?: { name: string; value: string }[]): Environment {
    let env = fromDebuggerEnvironmentVars(debugEnv);
    env = EnvironmentUtils.merge([baseEnv, env]);
    if (debugEnv) {
        for (const envPair of debugEnv) {
            env[envPair.name] = envPair.value;
        }
    }
    return env;
}

/**
 * Mirror of the environment CMakeProject.debugCTest() hands to the debug adapter: the authoritative
 * CTest environment, then the test's CTest ENVIRONMENT property, then the launch configuration.
 */
function ctestDebugEnvironment(driver: DriverEnvironmentState, testEnvironmentProperty: Environment, launchConfigEnvironment: { name: string; value: string }[] = []): Environment {
    const testEnvVars = makeDebuggerEnvironmentVars(testEnvironmentProperty);
    const combinedEnvVars = [...testEnvVars, ...launchConfigEnvironment];
    return mergeLaunchEnvironment(getCTestCommandEnvironment(driver), combinedEnvVars);
}

/** The previous behavior: the configure environment as the base instead of the CTest environment. */
function legacyCtestDebugEnvironment(driver: DriverEnvironmentState, testEnvironmentProperty: Environment, launchConfigEnvironment: { name: string; value: string }[] = []): Environment {
    const testEnvVars = makeDebuggerEnvironmentVars(testEnvironmentProperty);
    const combinedEnvVars = [...testEnvVars, ...launchConfigEnvironment];
    return mergeLaunchEnvironment(getConfigureEnvironment(driver), combinedEnvVars);
}

const presetsDriver: DriverEnvironmentState = {
    useCMakePresets: true,
    configurePresetEnvironment: EnvironmentUtils.create({ FROM_CONFIGURE_PRESET: 'configure', SHARED: 'configure' }),
    testPresetEnvironment: EnvironmentUtils.create({ FROM_CONFIGURE_PRESET: 'configure', SHARED: 'configure', TEST_DATA_DIR: '/data', PATH_LIKE: '/preset/bin' }),
    settingsEnvironment: EnvironmentUtils.create({ FROM_SETTINGS: 'settings' }),
    settingsTestEnvironment: EnvironmentUtils.create({ FROM_TEST_SETTINGS: 'testSettings' }),
    settingsConfigureEnvironment: EnvironmentUtils.create({ FROM_CONFIGURE_SETTINGS: 'configureSettings' })
};

const kitsDriver: DriverEnvironmentState = {
    useCMakePresets: false,
    kitEnvironment: EnvironmentUtils.create({ FROM_KIT: 'kit', PATH_LIKE: '/kit/bin' }),
    variantEnvironment: EnvironmentUtils.create({ FROM_VARIANT: 'variant' }),
    settingsEnvironment: EnvironmentUtils.create({ FROM_SETTINGS: 'settings' }),
    settingsTestEnvironment: EnvironmentUtils.create({ FROM_TEST_SETTINGS: 'testSettings' }),
    settingsConfigureEnvironment: EnvironmentUtils.create({ FROM_CONFIGURE_SETTINGS: 'configureSettings' })
};

suite('[CTest debug environment - presets mode]', () => {
    test('Test preset environment reaches the debug session', () => {
        const env = ctestDebugEnvironment(presetsDriver, EnvironmentUtils.create({}));
        expect(env['TEST_DATA_DIR']).to.equal('/data');
        expect(env['PATH_LIKE']).to.equal('/preset/bin');
        // Regression: the configure environment has no notion of the test preset.
        expect(legacyCtestDebugEnvironment(presetsDriver, EnvironmentUtils.create({}))['TEST_DATA_DIR']).to.equal(undefined);
    });

    test('cmake.testEnvironment reaches the debug session', () => {
        const env = ctestDebugEnvironment(presetsDriver, EnvironmentUtils.create({}));
        expect(env['FROM_TEST_SETTINGS']).to.equal('testSettings');
        expect(env['FROM_SETTINGS']).to.equal('settings');
        expect(legacyCtestDebugEnvironment(presetsDriver, EnvironmentUtils.create({}))['FROM_TEST_SETTINGS']).to.equal(undefined);
    });

    test('Configure preset environment inherited by the test preset is preserved', () => {
        const env = ctestDebugEnvironment(presetsDriver, EnvironmentUtils.create({}));
        expect(env['FROM_CONFIGURE_PRESET']).to.equal('configure');
    });

    test('CTest ENVIRONMENT property wins over the test preset environment', () => {
        const env = ctestDebugEnvironment(presetsDriver, EnvironmentUtils.create({ TEST_DATA_DIR: '/from/ctest/property' }));
        expect(env['TEST_DATA_DIR']).to.equal('/from/ctest/property');
    });

    test('Launch configuration environment wins over the CTest ENVIRONMENT property and the preset', () => {
        const env = ctestDebugEnvironment(
            presetsDriver,
            EnvironmentUtils.create({ TEST_DATA_DIR: '/from/ctest/property' }),
            [{ name: 'TEST_DATA_DIR', value: '/from/launch/json' }, { name: 'FROM_TEST_SETTINGS', value: 'launchWins' }]
        );
        expect(env['TEST_DATA_DIR']).to.equal('/from/launch/json');
        expect(env['FROM_TEST_SETTINGS']).to.equal('launchWins');
    });
});

suite('[CTest debug environment - kits/variants mode]', () => {
    test('Kit and variant environment reach the debug session', () => {
        const env = ctestDebugEnvironment(kitsDriver, EnvironmentUtils.create({}));
        expect(env['FROM_KIT']).to.equal('kit');
        expect(env['FROM_VARIANT']).to.equal('variant');
        expect(env['PATH_LIKE']).to.equal('/kit/bin');
    });

    test('cmake.testEnvironment reaches the debug session instead of cmake.configureEnvironment', () => {
        const env = ctestDebugEnvironment(kitsDriver, EnvironmentUtils.create({}));
        expect(env['FROM_TEST_SETTINGS']).to.equal('testSettings');
        expect(env['FROM_CONFIGURE_SETTINGS']).to.equal(undefined);
        expect(legacyCtestDebugEnvironment(kitsDriver, EnvironmentUtils.create({}))['FROM_TEST_SETTINGS']).to.equal(undefined);
    });

    test('CTest ENVIRONMENT property and launch overrides keep their precedence', () => {
        const testProperty = EnvironmentUtils.create({ FROM_KIT: 'ctestProperty', ONLY_CTEST: 'ctest' });
        const env = ctestDebugEnvironment(kitsDriver, testProperty, [{ name: 'FROM_KIT', value: 'launch' }]);
        expect(env['ONLY_CTEST']).to.equal('ctest');
        expect(env['FROM_KIT']).to.equal('launch');
    });

    test('Debug environment matches the CTest run environment when no test or launch overrides exist', () => {
        const runEnv = getCTestCommandEnvironment(kitsDriver);
        const debugEnv = ctestDebugEnvironment(kitsDriver, EnvironmentUtils.create({}));
        expect({ ...debugEnv }).to.deep.equal({ ...runEnv });
    });
});

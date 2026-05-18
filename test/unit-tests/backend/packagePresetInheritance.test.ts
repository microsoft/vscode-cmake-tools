import { expect } from 'chai';
import * as path from 'path';
import {
    type ConfigurePreset,
    type PackagePreset,
    type PresetsFile,
    expandPackagePresetVariables,
    getPackagePresetInherits,
    packageArgs,
    setExpandedPresets,
    setExpandedUserPresetsFile,
    setPresetsPlusIncluded,
    setUserPresetsPlusIncluded
} from '@cmt/presets/preset';

const folder = 'Q:\\repos\\vscode-cmake-tools-cpack\\test\\package-preset-inheritance';
const workspaceFolder = 'Q:\\repos\\vscode-cmake-tools-cpack';
const sourceDir = workspaceFolder;
const presetsPath = 'Q:\\repos\\vscode-cmake-tools-cpack\\CMakePresets.json';

function createPresetsFile(configurePresets: ConfigurePreset[], packagePresets: PackagePreset[]): PresetsFile {
    const presetsFile: PresetsFile = {
        version: 8,
        __path: presetsPath,
        configurePresets,
        packagePresets
    };

    for (const preset of configurePresets) {
        preset.__file = presetsFile;
        preset.isUserPreset = false;
    }

    for (const preset of packagePresets) {
        preset.__file = presetsFile;
        preset.isUserPreset = false;
    }

    return presetsFile;
}

function createConfigurePreset(name: string = 'configureBase'): ConfigurePreset {
    return {
        name,
        binaryDir: path.join(sourceDir, 'out', 'build', name),
        generator: 'Ninja'
    };
}

function seedPresets(configurePresets: ConfigurePreset[], packagePresets: PackagePreset[]) {
    const presetsFile = createPresetsFile(configurePresets, packagePresets);
    setExpandedPresets(folder, presetsFile);
    setPresetsPlusIncluded(folder, presetsFile);
}

function clearPresets() {
    setExpandedPresets(folder, undefined);
    setPresetsPlusIncluded(folder, undefined);
    setExpandedUserPresetsFile(folder, undefined);
    setUserPresetsPlusIncluded(folder, undefined);
}

async function resolvePackagePreset(name: string, configurePresets: ConfigurePreset[], packagePresets: PackagePreset[]) {
    seedPresets(configurePresets, packagePresets);

    const inheritedPreset = await getPackagePresetInherits(
        folder,
        name,
        workspaceFolder,
        sourceDir,
        undefined,
        false,
        undefined
    );

    expect(inheritedPreset, 'package preset should resolve').to.not.equal(null);

    return expandPackagePresetVariables(inheritedPreset!, name, workspaceFolder, sourceDir);
}

suite('[package preset inheritance]', () => {
    setup(() => clearPresets());
    teardown(() => clearPresets());

    test('inherits parent package variables alongside child variables (issue #4924)', async () => {
        const expandedPreset = await resolvePackagePreset('soft_api', [createConfigurePreset()], [
            {
                name: 'packageBase',
                configurePreset: 'configureBase',
                variables: {
                    CPACK_ARCHIVE_COMPONENT_INSTALL: 'ON',
                    CPACK_COMPONENTS_GROUPING: 'IGNORE'
                }
            },
            {
                name: 'soft_api',
                inherits: 'packageBase',
                variables: {
                    CPACK_COMPONENTS_ALL: 'soft_api'
                }
            }
        ]);

        expect(expandedPreset.configurePreset).to.equal('configureBase');
        expect(expandedPreset.variables).to.deep.equal({
            CPACK_COMPONENTS_ALL: 'soft_api',
            CPACK_ARCHIVE_COMPONENT_INSTALL: 'ON',
            CPACK_COMPONENTS_GROUPING: 'IGNORE'
        });
        expect(packageArgs(expandedPreset)).to.include.members([
            '-D CPACK_COMPONENTS_ALL=soft_api',
            '-D CPACK_ARCHIVE_COMPONENT_INSTALL=ON',
            '-D CPACK_COMPONENTS_GROUPING=IGNORE'
        ]);
    });

    test('keeps child values when parent defines the same package variable', async () => {
        const expandedPreset = await resolvePackagePreset('overrideChild', [createConfigurePreset()], [
            {
                name: 'packageBase',
                configurePreset: 'configureBase',
                variables: {
                    CPACK_COMPONENTS_ALL: 'parent-components',
                    CPACK_ARCHIVE_COMPONENT_INSTALL: 'ON'
                }
            },
            {
                name: 'overrideChild',
                inherits: 'packageBase',
                variables: {
                    CPACK_COMPONENTS_ALL: 'child-components'
                }
            }
        ]);

        expect(expandedPreset.variables).to.deep.equal({
            CPACK_COMPONENTS_ALL: 'child-components',
            CPACK_ARCHIVE_COMPONENT_INSTALL: 'ON'
        });
    });

    test('inherits missing package variables through multi-level chains and empty child maps', async () => {
        const expandedPreset = await resolvePackagePreset('child', [createConfigurePreset()], [
            {
                name: 'grandparent',
                configurePreset: 'configureBase',
                variables: {
                    CPACK_ARCHIVE_COMPONENT_INSTALL: 'ON'
                }
            },
            {
                name: 'parent',
                inherits: 'grandparent',
                variables: {
                    CPACK_COMPONENTS_GROUPING: 'IGNORE'
                }
            },
            {
                name: 'child',
                inherits: 'parent',
                variables: {}
            }
        ]);

        expect(expandedPreset.variables).to.deep.equal({
            CPACK_ARCHIVE_COMPONENT_INSTALL: 'ON',
            CPACK_COMPONENTS_GROUPING: 'IGNORE'
        });
    });
});

import { expect } from 'chai';

/**
 * Mirror of the install command construction logic from CMakeDriver.getCMakeInstallCommand().
 * This tests the command construction independently from the vscode-dependent driver class.
 */
interface BuildCommand {
    command: string;
    args: string[];
    build_env: Record<string, string>;
}

interface InstallCommandParams {
    cmakePath: string;
    binaryDir: string;
    isMultiConf: boolean;
    currentBuildType: string;
    installDir: string | null;
    supportsInstallCommand: boolean;
}

function getCMakeInstallCommand(params: InstallCommandParams): BuildCommand | null {
    if (!params.supportsInstallCommand) {
        return null;
    }
    const args: string[] = ['--install', params.binaryDir];

    if (params.isMultiConf) {
        args.push('--config', params.currentBuildType);
    }

    if (params.installDir) {
        args.push('--prefix', params.installDir);
    }

    return { command: params.cmakePath, args, build_env: {} };
}

suite('[Install Command Construction]', () => {
    test('basic install command for single-config generator', () => {
        const cmd = getCMakeInstallCommand({
            cmakePath: '/usr/bin/cmake',
            binaryDir: '/home/user/project/build',
            isMultiConf: false,
            currentBuildType: 'Release',
            installDir: null,
            supportsInstallCommand: true
        });
        expect(cmd).to.not.be.null;
        expect(cmd!.command).to.equal('/usr/bin/cmake');
        expect(cmd!.args).to.deep.equal(['--install', '/home/user/project/build']);
    });

    test('install command includes --config for multi-config generator', () => {
        const cmd = getCMakeInstallCommand({
            cmakePath: '/usr/bin/cmake',
            binaryDir: '/home/user/project/build',
            isMultiConf: true,
            currentBuildType: 'Debug',
            installDir: null,
            supportsInstallCommand: true
        });
        expect(cmd).to.not.be.null;
        expect(cmd!.args).to.deep.equal([
            '--install', '/home/user/project/build',
            '--config', 'Debug'
        ]);
    });

    test('install command includes --prefix when installDir is set', () => {
        const cmd = getCMakeInstallCommand({
            cmakePath: '/usr/bin/cmake',
            binaryDir: '/home/user/project/build',
            isMultiConf: false,
            currentBuildType: 'Release',
            installDir: '/home/user/project/_install',
            supportsInstallCommand: true
        });
        expect(cmd).to.not.be.null;
        expect(cmd!.args).to.deep.equal([
            '--install', '/home/user/project/build',
            '--prefix', '/home/user/project/_install'
        ]);
    });

    test('install command includes both --config and --prefix when needed', () => {
        const cmd = getCMakeInstallCommand({
            cmakePath: 'C:\\cmake\\bin\\cmake.exe',
            binaryDir: 'C:\\project\\build',
            isMultiConf: true,
            currentBuildType: 'Release',
            installDir: 'C:\\project\\_install',
            supportsInstallCommand: true
        });
        expect(cmd).to.not.be.null;
        expect(cmd!.args).to.deep.equal([
            '--install', 'C:\\project\\build',
            '--config', 'Release',
            '--prefix', 'C:\\project\\_install'
        ]);
    });

    test('returns null when cmake version does not support --install', () => {
        const cmd = getCMakeInstallCommand({
            cmakePath: '/usr/bin/cmake',
            binaryDir: '/home/user/project/build',
            isMultiConf: false,
            currentBuildType: 'Release',
            installDir: null,
            supportsInstallCommand: false
        });
        expect(cmd).to.be.null;
    });

    test('installDir null does not produce --prefix', () => {
        const cmd = getCMakeInstallCommand({
            cmakePath: '/usr/bin/cmake',
            binaryDir: '/build',
            isMultiConf: true,
            currentBuildType: 'RelWithDebInfo',
            installDir: null,
            supportsInstallCommand: true
        });
        expect(cmd).to.not.be.null;
        expect(cmd!.args).to.deep.equal([
            '--install', '/build',
            '--config', 'RelWithDebInfo'
        ]);
        // Ensure no --prefix argument when installDir is null
        expect(cmd!.args).to.not.include('--prefix');
    });
});

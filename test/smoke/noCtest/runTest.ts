import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');
        const extensionTestsEnv: { [key: string]: string | undefined } = { "CMT_TESTING": "1", "CMT_QUIET_CONSOLE": "1" };

        // The path to the extension test runner script
        const extensionTestsPath = path.resolve(__dirname, './index');
        const testWorkspace = path.resolve(extensionDevelopmentPath, 'test/smoke/noCtest');
        const launchArgs = ["--disable-extensions", "--disable-workspace-trust", testWorkspace];
        await runTests({ launchArgs, extensionDevelopmentPath, extensionTestsPath, extensionTestsEnv });

    } catch (err) {
        console.error(err);
        console.error('Failed to run tests');
        process.exit(1);
    }
}

void main();

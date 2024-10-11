import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');

        // The path to the extension test runner script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './index');

        const testWorkspace = path.resolve(extensionDevelopmentPath, 'test/end-to-end-tests/single-root-UI/project-folder');

        const launchArgs = ["--disable-extensions", "--disable-workspace-trust", testWorkspace];

        const extensionTestsEnv: { [key: string]: string | undefined } = {
            "CMT_TESTING": "1",
            "CMT_QUIET_CONSOLE": "1",
            "TEST_FILTER": process.env.TEST_FILTER ?? ".*"
        };

        // Download VS Code, unzip it and run the integration test
        await runTests({ launchArgs, extensionDevelopmentPath, extensionTestsPath, extensionTestsEnv });
    } catch (err) {
        console.error(err);
        console.error('Failed to run tests');
        process.exit(1);
    }
}

void main();

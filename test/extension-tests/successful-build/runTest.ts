import * as path from 'path';

import { runTests } from 'vscode-test';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './index');

    const testWorkspace = path.resolve(extensionDevelopmentPath, 'test/extension-tests/successful-build/project-folder');

    const launchArgs = [ "--disable-extensions", testWorkspace ];

    const extensionTestsEnv: { [key: string]: string | undefined } = { "CMT_TESTING": "1" };

    // Download VS Code, unzip it and run the integration test
    await runTests({ launchArgs, extensionDevelopmentPath, extensionTestsPath, extensionTestsEnv });
  } catch (err) {
    console.error(err);
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
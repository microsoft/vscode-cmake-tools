/**
 * Single source of truth for the VS Code version used by the @vscode/test-electron
 * harness across every runTest.ts entry point.
 *
 * Pinned to a known-good release: the latest stable VS Code (1.131.0) fails to launch
 * on CI (macos-26 / Apple Silicon) with ENOENT before any test runs. Override with the
 * VSCODE_TEST_VERSION environment variable to test a different build without editing code.
 *
 * See https://github.com/microsoft/vscode-cmake-tools/issues/5011
 */
export const vscodeTestVersion: string = process.env['VSCODE_TEST_VERSION'] || '1.130.0';

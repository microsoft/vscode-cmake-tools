/**
 * Single source of truth for the VS Code version used by the @vscode/test-electron
 * harness across every runTest.ts entry point.
 *
 * Pinned to VS Code 1.131.0, which does not contain the legacy Contents/MacOS/Electron
 * symlink. Combined with @vscode/test-electron 3.1.0 (which resolves the macOS executable
 * from the app bundle's Info.plist CFBundleExecutable rather than the removed symlink), this
 * keeps CI deterministic and proves the harness launches VS Code via Contents/MacOS/Code on
 * macOS. Override with the VSCODE_TEST_VERSION environment variable to test a different build
 * without editing code.
 *
 * See https://github.com/microsoft/vscode-cmake-tools/issues/5011
 */
export const vscodeTestVersion: string = process.env['VSCODE_TEST_VERSION'] || '1.131.0';

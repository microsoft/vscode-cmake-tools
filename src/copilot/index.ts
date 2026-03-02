/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ExtensionManager } from '@cmt/extension';
import { CMakeBuildTool, CMakeConfigureTool, CMakeGetErrorsTool } from './tools';

/**
 * Registers CMake Copilot tools for use with VS Code's Language Model API
 *
 * @param context Extension context for managing disposables
 * @param extensionManager The CMake Tools extension manager instance
 */
export function registerCopilotTools(
    context: vscode.ExtensionContext,
    extensionManager: ExtensionManager
): void {
    // Register the build tool
    context.subscriptions.push(
        vscode.lm.registerTool('cmake_build', new CMakeBuildTool(extensionManager))
    );

    // Register the configure tool
    context.subscriptions.push(
        vscode.lm.registerTool('cmake_configure', new CMakeConfigureTool(extensionManager))
    );

    // Register the get errors tool
    context.subscriptions.push(
        vscode.lm.registerTool('cmake_get_errors', new CMakeGetErrorsTool())
    );
}

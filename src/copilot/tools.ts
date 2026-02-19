/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IBuildParameters, IConfigureParameters, IGetErrorsParameters } from './types';
import { ExtensionManager } from '@cmt/extension';
import { collections } from '@cmt/diagnostics/collections';

/**
 * Language Model Tool for building CMake projects
 */
export class CMakeBuildTool implements vscode.LanguageModelTool<IBuildParameters> {
    constructor(private readonly extensionManager: ExtensionManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const target = options.input.target;
        const clean = options.input.clean ?? false;

        let targetDesc = target ? `target '${target}'` : 'default target';
        if (clean) {
            targetDesc = `clean and build ${targetDesc}`;
        } else {
            targetDesc = `build ${targetDesc}`;
        }

        const confirmationMessages = {
            title: 'Build CMake Project',
            message: new vscode.MarkdownString(
                `Build the CMake project: ${targetDesc}?`
            )
        };

        return {
            invocationMessage: clean ? 'Cleaning and building CMake project...' : 'Building CMake project...',
            confirmationMessages
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IBuildParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const params = options.input;
        const targets = params.target ? [params.target] : undefined;

        try {
            // If clean is requested, clean first
            if (params.clean) {
                await this.extensionManager.clean();
            }

            // Perform the build
            const result = await this.extensionManager.build(undefined, undefined, undefined, undefined, undefined);

            if (result === 0) {
                const targetDesc = params.target ? `target '${params.target}'` : 'default target';
                const message = `CMake build completed successfully for ${targetDesc}.`;
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(message)
                ]);
            } else {
                const errorMsg = `CMake build failed with exit code ${result}.`;
                throw new Error(errorMsg + ' Use the cmake_get_errors tool to see the compilation errors, then help the user fix them.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`CMake build failed: ${errorMessage}. Use the cmake_get_errors tool to see detailed diagnostics.`);
        }
    }
}

/**
 * Language Model Tool for configuring CMake projects
 */
export class CMakeConfigureTool implements vscode.LanguageModelTool<IConfigureParameters> {
    constructor(private readonly extensionManager: ExtensionManager) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IConfigureParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const cleanFirst = options.input.cleanFirst ?? false;
        const presetName = this.extensionManager.activeConfigurePresetName() || 'default';

        const action = cleanFirst ? 'Clean and reconfigure' : 'Configure';
        const confirmationMessages = {
            title: `${action} CMake Project`,
            message: new vscode.MarkdownString(
                `${action} the CMake project with preset '${presetName}'?`
            )
        };

        return {
            invocationMessage: cleanFirst ? 'Cleaning and reconfiguring CMake project...' : 'Configuring CMake project...',
            confirmationMessages
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IConfigureParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const params = options.input;
        const presetName = this.extensionManager.activeConfigurePresetName() || 'default';

        try {
            let result: number;
            if (params.cleanFirst) {
                result = await this.extensionManager.cleanConfigure();
            } else {
                result = await this.extensionManager.configure();
            }

            if (result === 0) {
                const action = params.cleanFirst ? 'Clean reconfiguration' : 'Configuration';
                const message = `${action} completed successfully using preset '${presetName}'.`;
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(message)
                ]);
            } else {
                const errorMsg = `CMake configuration failed with exit code ${result}.`;
                throw new Error(errorMsg + ' Use the cmake_get_errors tool to see the configuration errors, then help the user fix the CMakeLists.txt or preset issues.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`CMake configuration failed: ${errorMessage}. Use the cmake_get_errors tool to see detailed diagnostics.`);
        }
    }
}

/**
 * Language Model Tool for retrieving CMake-specific errors
 */
export class CMakeGetErrorsTool implements vscode.LanguageModelTool<IGetErrorsParameters> {
    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<IGetErrorsParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: 'Reading CMake diagnostics...',
            confirmationMessages: {
                title: 'Get CMake Errors',
                message: new vscode.MarkdownString('Retrieve CMake-specific diagnostics (configure, build, and preset errors)?')
            }
        };
    }

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<IGetErrorsParameters>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || '';

        // Collect diagnostics from all CMake-specific collections
        const diagnosticGroups = [
            { name: 'CMake Configure', collection: collections.cmake },
            { name: 'CMake Build', collection: collections.build },
            { name: 'CMake Presets', collection: collections.presets }
        ];

        let totalErrors = 0;
        let totalWarnings = 0;
        let totalInfo = 0;
        const errorLines: string[] = [];

        for (const group of diagnosticGroups) {
            const diagnostics: [vscode.Uri, readonly vscode.Diagnostic[]][] = [];
            group.collection.forEach((uri, diags) => {
                diagnostics.push([uri, diags]);
            });

            if (diagnostics.length === 0) {
                continue;
            }

            const groupErrors: string[] = [];
            for (const [uri, diags] of diagnostics) {
                for (const diag of diags) {
                    // Count by severity
                    switch (diag.severity) {
                        case vscode.DiagnosticSeverity.Error:
                            totalErrors++;
                            break;
                        case vscode.DiagnosticSeverity.Warning:
                            totalWarnings++;
                            break;
                        case vscode.DiagnosticSeverity.Information:
                        case vscode.DiagnosticSeverity.Hint:
                            totalInfo++;
                            break;
                    }

                    // Format the diagnostic
                    const severityLabel = this.getSeverityLabel(diag.severity);
                    const relativePath = workspaceRoot ? uri.fsPath.replace(workspaceRoot, '.') : uri.fsPath;
                    const location = `${relativePath}:${diag.range.start.line + 1}:${diag.range.start.character + 1}`;
                    const source = diag.source ? `[${diag.source}] ` : '';
                    const code = diag.code ? `(${diag.code}) ` : '';

                    groupErrors.push(`${severityLabel}: ${location}: ${source}${code}${diag.message}`);
                }
            }

            if (groupErrors.length > 0) {
                errorLines.push(`\n## ${group.name} Errors (${groupErrors.length})`);
                errorLines.push(...groupErrors);
            }
        }

        // Build summary
        const summary = `Found ${totalErrors} error(s), ${totalWarnings} warning(s), ${totalInfo} info message(s) in CMake diagnostics.`;

        if (errorLines.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No CMake errors found. The project is clean.')
            ]);
        }

        const fullReport = [summary, ...errorLines].join('\n');
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(fullReport)
        ]);
    }

    private getSeverityLabel(severity: vscode.DiagnosticSeverity): string {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error:
                return 'ERROR';
            case vscode.DiagnosticSeverity.Warning:
                return 'WARNING';
            case vscode.DiagnosticSeverity.Information:
                return 'INFO';
            case vscode.DiagnosticSeverity.Hint:
                return 'HINT';
            default:
                return 'UNKNOWN';
        }
    }
}

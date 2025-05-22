import { title } from 'process';
import * as vscode from 'vscode';
import { extensionManager } from '@cmt/extension';

interface IBuildToolOptions {
    target?: string;
}

export class BuildTool implements vscode.LanguageModelTool<IBuildToolOptions> {
    async invoke(_options: vscode.LanguageModelToolInvocationOptions<IBuildToolOptions>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const result = await extensionManager?.build();
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`The build resulted with the following return code: ${result}`)]);
    }

    prepareInvocation?(_options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildToolOptions>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        const confirmationMessages = {
            title: "Build the project in CMake Tools",
            message: new vscode.MarkdownString("Build the project in CMake Tools?")
        };

        return {
            invocationMessage: "Building the project in CMake Tools",
            confirmationMessages
        };
    }
}

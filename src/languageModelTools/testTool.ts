import * as vscode from 'vscode';
import { extensionManager } from '@cmt/extension';

interface ITestToolOptions {
    tests?: string[];
}

export class TestTool implements vscode.LanguageModelTool<ITestToolOptions> {
    async invoke(_options: vscode.LanguageModelToolInvocationOptions<ITestToolOptions>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const result = await extensionManager?.ctest();
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`The ctest execution resulted with the following return code: ${result}`)]);
    }

    prepareInvocation?(_options: vscode.LanguageModelToolInvocationPrepareOptions<ITestToolOptions>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        const confirmationMessages = {
            title: "Running ctest for the project in CMake Tools",
            message: new vscode.MarkdownString("Run ctest for the project in CMake Tools?")
        };

        return {
            invocationMessage: "Running Ctest for the project in CMake Tools",
            confirmationMessages
        };
    }
}

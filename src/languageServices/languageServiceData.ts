import * as vscode from "vscode";
import * as path from "path";
import { fs } from "@cmt/pr";
import { thisExtensionPath } from "@cmt/util";

interface Commands {
    [key: string]: Command;
}

interface Command {
    name: string;
    description: string;
    syntax_examples: string;
}

interface Variables {
    [key: string]: Variable;
}

interface Variable {
    name: string;
    description: string;
}

export class LanguageServiceData implements vscode.HoverProvider, vscode.CompletionItemProvider {
    private commandsJson: Commands = {};
    private variablesJson: Variables = {};

    private constructor() {
    }

    private async load(): Promise<void> {
        const test = thisExtensionPath();
        console.log(test);
        this.commandsJson = JSON.parse(await fs.readFile(path.join(thisExtensionPath(), 'assets', 'commands.json')));
        this.variablesJson = JSON.parse(await fs.readFile(path.join(thisExtensionPath(), 'assets', 'variables.json')));
    }

    public static async create(): Promise<LanguageServiceData> {
        const data = new LanguageServiceData();
        await data.load();
        return data;
    }

    provideCompletionItems(_document: vscode.TextDocument, _position: vscode.Position, _token: vscode.CancellationToken, _context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        return null;
    }

    resolveCompletionItem?(_item: vscode.CompletionItem, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        return null;
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position);
        const value = document.getText(range);

        if (token.isCancellationRequested) {
            return null;
        }

        const hoverSuggestions = this.commandsJson[value] || this.variablesJson[value];
        if (hoverSuggestions) {
            return new vscode.Hover({language: 'md', value: hoverSuggestions.description });
        }

        return null;
    }
}

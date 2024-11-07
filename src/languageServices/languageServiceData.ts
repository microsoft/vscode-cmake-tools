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
    syntax_examples: string[];
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
    private variablesJson: Variables = {}; // variables and properties

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

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, _context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const wordAtPosition = document.getWordRangeAtPosition(position);

        let currentWord = "";
        if (wordAtPosition && wordAtPosition.start.character < position.character) {
            const word = document.getText(wordAtPosition);
            currentWord = word.substr(0, position.character - wordAtPosition.start.character);
        }

        if (token.isCancellationRequested) {
            return null;
        }

        const suggestions = Object.keys(this.commandsJson).map((key) => {
            if (this.commandsJson[key].name.includes(currentWord)) {
                const completionItem = new vscode.CompletionItem(this.commandsJson[key].name);
                completionItem.insertText = (this.commandsJson[key].name);
                completionItem.kind = vscode.CompletionItemKind.Function;
                return completionItem;
            }
            return null;
        }).filter((value) => value !== null).concat(Object.keys(this.variablesJson).map((key) => {
            if (this.variablesJson[key].name.includes(currentWord)) {
                const completionItem = new vscode.CompletionItem(this.variablesJson[key].name);
                completionItem.insertText = (this.variablesJson[key].name);
                completionItem.kind = vscode.CompletionItemKind.Variable;
                return completionItem;
            }
            return null;
        }).filter((value) => value !== null));

        return suggestions as vscode.CompletionItem[];
    }

    resolveCompletionItem?(item: vscode.CompletionItem, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        return item;
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position);
        const value = document.getText(range);

        if (token.isCancellationRequested) {
            return null;
        }

        const hoverSuggestions = this.commandsJson[value] || this.variablesJson[value];

        const markdown: vscode.MarkdownString = new vscode.MarkdownString();
        markdown.appendMarkdown(hoverSuggestions.description);
        hoverSuggestions.syntax_examples?.forEach((example) => {
            markdown.appendCodeblock(`\t${example}`, "cmake");
        });

        if (hoverSuggestions) {
            return new vscode.Hover(markdown);
        }

        return null;
    }
}

import * as vscode from "vscode";
import * as path from "path";
import { fs } from "@cmt/pr";
import { thisExtensionPath } from "@cmt/util";
import * as util from "@cmt/util";

interface Commands {
    [key: string]: Command;
}

interface Command {
    name: string;
    description: string;
    syntax_examples: string[];
}

// Same as variables right now. If we modify, create individual interfaces.
interface Modules extends Variables {

}

interface Variables {
    [key: string]: Variable;
}

interface Variable {
    name: string;
    description: string;
}

enum LanguageType {
    Variable,
    Command,
    Module
}

export class LanguageServiceData implements vscode.HoverProvider, vscode.CompletionItemProvider {
    private commands: Commands = {};
    private variables: Variables = {}; // variables and properties
    private modules: Modules = {};

    private constructor() {
    }

    private async getFile(fileEnding: string, locale: string): Promise<string> {
        let filePath: string = path.join(thisExtensionPath(), "dist/languageServices", locale, "assets", fileEnding);
        const fileExists: boolean = await util.checkFileExists(filePath);
        if (!fileExists) {
            filePath = path.join(thisExtensionPath(), "assets", fileEnding);
        }
        return fs.readFile(filePath);
    }

    private async load(): Promise<void> {
        const locale: string = util.getLocaleId();
        this.commands = JSON.parse(await this.getFile("commands.json", locale));
        this.variables = JSON.parse(await this.getFile("variables.json", locale));
        this.modules = JSON.parse(await this.getFile("modules.json", locale));
    }

    private getCompletionSuggestionsHelper(currentWord: string, data: Commands | Modules | Variables, type: LanguageType, beforeCurrentWord?: string): vscode.CompletionItem[] {
        function moduleInsertText(module: string, beforeCurrentWord?: string): vscode.SnippetString {
            if (beforeCurrentWord) {
                if (beforeCurrentWord.startsWith("include")) {
                    return new vscode.SnippetString(module);
                } else if (beforeCurrentWord.startsWith("find_package")) {
                    return new vscode.SnippetString(`${module.replace("Find", "")}\${1: REQUIRED}`);
                }
            }

            if (module.indexOf("Find") === 0) {
                return new vscode.SnippetString(`find_package(${module.replace("Find", "")}\${1: REQUIRED})`);
            } else {
                return new vscode.SnippetString(`include(${module})`);
            }
        }

        function variableInsertText(variable: string): vscode.SnippetString {
            return new vscode.SnippetString(variable.replace(/<(.*)>/g, "${1:<$1>}"));
        }

        function commandInsertText(func: string): vscode.SnippetString {
            const scopedFunctions = ["if", "function", "while", "macro", "foreach"];
            const is_scoped = scopedFunctions.includes(func);
            if (is_scoped) {
                return new vscode.SnippetString(`${func}(\${1})\n\t\nend${func}(\${1})\n`);
            } else {
                return new vscode.SnippetString(`${func}(\${1})`);
            }
        }

        return Object.keys(data).map((key) => {
            if (data[key].name.includes(currentWord)) {
                const completionItem = new vscode.CompletionItem(data[key].name);
                completionItem.insertText = type === LanguageType.Command ? commandInsertText(data[key].name) : type === LanguageType.Variable ? variableInsertText(data[key].name) : moduleInsertText(data[key].name, beforeCurrentWord);
                completionItem.kind = type === LanguageType.Command ? vscode.CompletionItemKind.Function : type === LanguageType.Variable ? vscode.CompletionItemKind.Variable : vscode.CompletionItemKind.Module;
                return completionItem;
            }
            return null;
        }).filter((value) => value !== null) as vscode.CompletionItem[];
    }

    private getCompletionSuggestions(currentWord: string, beforeCurrentWord?: string): vscode.CompletionItem[] {
        return this.getCompletionSuggestionsHelper(currentWord, this.commands, LanguageType.Command, beforeCurrentWord)
            .concat(this.getCompletionSuggestionsHelper(currentWord, this.variables, LanguageType.Variable, beforeCurrentWord))
            .concat(this.getCompletionSuggestionsHelper(currentWord, this.modules, LanguageType.Module, beforeCurrentWord));
    }

    public static async create(): Promise<LanguageServiceData> {
        const data = new LanguageServiceData();
        await data.load();
        return data;
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, _context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const wordAtPosition = document.getWordRangeAtPosition(position);
        const beforeWordAtPosition = wordAtPosition ? document.getText(new vscode.Range(new vscode.Position(position.line, 0), new vscode.Position(position.line, wordAtPosition.start.character))) : undefined;

        let currentWord = "";
        if (wordAtPosition && wordAtPosition.start.character < position.character) {
            const word = document.getText(wordAtPosition);
            currentWord = word.substr(0, position.character - wordAtPosition.start.character);
        }

        if (token.isCancellationRequested) {
            return null;
        }

        return this.getCompletionSuggestions(currentWord, beforeWordAtPosition);
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

        const hoverSuggestions = this.commands[value] || this.variables[value] || this.modules[value] || this.modules[`Find${value}`];

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

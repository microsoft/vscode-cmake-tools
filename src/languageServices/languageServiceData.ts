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

interface Policies {
    [key: string]: Policy;
}

interface Policy {
    name: string;
    description: string;
    introduced_version: string;
    removed_version?: string;
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
    private policies: Policies = {};

    private loadPromise?: Promise<boolean>;
    private disposed = false;

    private constructor(private readonly onLoadError?: (error: unknown) => void) {
    }

    /**
     * Lazily load the bundled language-service data on first use. The load is
     * memoized so concurrent hover/completion requests share a single read, and
     * a failure is memoized as `false` (never a rejected promise and never
     * cleared) so providers stop retrying the four files on every keystroke.
     */
    private ensureLoaded(): Promise<boolean> {
        return this.loadPromise ??= this.load().then(
            () => true,
            (error) => {
                this.onLoadError?.(error);
                return false;
            }
        );
    }

    public dispose(): void {
        this.disposed = true;
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
        this.policies = JSON.parse(await this.getFile("policies.json", locale));
    }

    /**
     * Provides completion suggestions based on the current word and the type of language construct.
     *
     * @param currentWord - The current word being typed by the user.
     * @param data - The data containing commands, modules, or variables for completion suggestions.
     * @param type - The type of language construct (Command, Module, or Variable).
     * @param beforeCurrentWord - Optional. The text before the current word, used to determine the appropriate snippet format.
     * @returns An array of `vscode.CompletionItem` objects representing the completion suggestions.
     */
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
                return new vscode.SnippetString(`${func}(\${1})\n\t\$0\nend${func}()\n`);
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

    public static create(onLoadError?: (error: unknown) => void): LanguageServiceData {
        return new LanguageServiceData(onLoadError);
    }

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, _context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | undefined> {
        if (this.disposed || token.isCancellationRequested) {
            return undefined;
        }

        if (!await this.ensureLoaded()) {
            return undefined;
        }

        if (this.disposed || token.isCancellationRequested) {
            return undefined;
        }

        const wordAtPosition = document.getWordRangeAtPosition(position);
        const beforeWordAtPosition = wordAtPosition ? document.getText(new vscode.Range(new vscode.Position(position.line, 0), new vscode.Position(position.line, wordAtPosition.start.character))) : undefined;

        let currentWord = "";
        if (wordAtPosition && wordAtPosition.start.character < position.character) {
            const word = document.getText(wordAtPosition);
            currentWord = word.substr(0, position.character - wordAtPosition.start.character);
        }

        return this.getCompletionSuggestions(currentWord, beforeWordAtPosition);
    }

    resolveCompletionItem?(item: vscode.CompletionItem, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        return item;
    }

    async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        if (this.disposed || token.isCancellationRequested) {
            return undefined;
        }

        if (!await this.ensureLoaded()) {
            return undefined;
        }

        if (this.disposed || token.isCancellationRequested) {
            return undefined;
        }

        const range = document.getWordRangeAtPosition(position);
        const value = document.getText(range);

        // Check for CMake policy identifiers (e.g., CMP0177)
        const policy = this.policies[value];
        if (policy) {
            const markdown: vscode.MarkdownString = new vscode.MarkdownString();
            if (policy.introduced_version && policy.removed_version) {
                markdown.appendMarkdown(`Added in CMake ${policy.introduced_version} and removed in CMake ${policy.removed_version}.\n\n`);
            } else if (policy.introduced_version) {
                markdown.appendMarkdown(`Added in CMake ${policy.introduced_version}.\n\n`);
            }

            markdown.appendMarkdown(`${policy.description}\n\n`);
            const policyUrl = `https://cmake.org/cmake/help/latest/policy/${policy.name}.html`;
            markdown.appendMarkdown(`[${policy.name} Documentation](${policyUrl})`);
            return new vscode.Hover(markdown);
        }

        const hoverSuggestions = this.commands[value] || this.variables[value] || this.modules[value] || this.modules[`Find${value}`];
        if (hoverSuggestions) {
            const markdown: vscode.MarkdownString = new vscode.MarkdownString();
            markdown.appendMarkdown(hoverSuggestions.description);
            hoverSuggestions.syntax_examples?.forEach((example) => {
                markdown.appendCodeblock(`\t${example}`, "cmake");
            });
            return new vscode.Hover(markdown);
        }

        return undefined;
    }
}

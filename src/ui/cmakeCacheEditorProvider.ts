import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as telemetry from '@cmt/telemetry';
import * as util from '@cmt/util';

import { CacheEntryType, CMakeCache } from '@cmt/cache';

import * as logging from '@cmt/logging';
const log = logging.createLogger('cache');

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface IOption {
    key: string;    // same as CMake cache variable key names
    type: string;   // "Bool" for boolean and "String" for anything else for now
    helpString: string;
    choices: string[];
    value: string;  // value from the cache file or changed in the UI
    dirty: boolean; // if the variable was edited in the UI
}

/**
 * Provider for the CMake Cache Editor custom text editor.
 * This implements CustomTextEditorProvider to enable standard VS Code save functionality (Ctrl+S).
 */
export class CMakeCacheEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'cmake.cmakeCacheEditor';

    private readonly cmakeCacheEditorText = localize("cmake.cache.editor", "CMake Cache Editor");

    // Callback to trigger reconfigure after save
    private onSaveCallback: (() => void) | undefined;

    public static register(context: vscode.ExtensionContext, onSave?: () => void): vscode.Disposable {
        const provider = new CMakeCacheEditorProvider(context, onSave);
        return vscode.window.registerCustomEditorProvider(
            CMakeCacheEditorProvider.viewType,
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false
            }
        );
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        onSave?: () => void
    ) {
        this.onSaveCallback = onSave;
    }

    /**
     * Set the callback to be invoked when the cache is saved.
     */
    public setOnSaveCallback(callback: () => void): void {
        this.onSaveCallback = callback;
    }

    /**
     * Called when the custom editor is opened.
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Set up the webview options
        webviewPanel.webview.options = {
            enableScripts: true
        };

        // Parse options from the document
        let options = await this.getConfigurationOptionsFromDocument(document);

        // Render the webview
        webviewPanel.webview.html = this.getWebviewMarkup(options);

        // Handle messages from the webview
        const messageHandler = webviewPanel.webview.onDidReceiveMessage(async (message: IOption | false) => {
            if (message === false) {
                // Save button was clicked - apply pending edits to the document
                await this.applyEditsToDocument(document, options);
            } else {
                // Option was edited in the webview
                const option = message as IOption;
                const index = options.findIndex(opt => opt.key === option.key);
                if (index !== -1 && options[index].value !== option.value) {
                    options[index].dirty = true;
                    options[index].type = option.type;
                    options[index].value = option.value;

                    // Apply the edit to the document immediately so Ctrl+S works
                    await this.applyEditsToDocument(document, options);
                }
            }
        });

        // Handle document changes from external sources
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
                // Reload options from the document
                void this.getConfigurationOptionsFromDocument(document).then(newOptions => {
                    options = newOptions;
                    webviewPanel.webview.html = this.getWebviewMarkup(options);
                });
            }
        });

        // Handle document save events
        const saveSubscription = vscode.workspace.onDidSaveTextDocument(savedDocument => {
            if (savedDocument.uri.toString() === document.uri.toString()) {
                telemetry.logEvent("editCMakeCache", { command: "saveCMakeCacheUI" });
                void vscode.window.showInformationMessage(localize('cmake.cache.saved', 'CMake options have been saved.'));

                // Trigger reconfigure if callback is set
                if (this.onSaveCallback) {
                    this.onSaveCallback();
                }

                // Mark all options as not dirty
                options.forEach(opt => opt.dirty = false);
            }
        });

        // Clean up when the panel is closed
        webviewPanel.onDidDispose(() => {
            messageHandler.dispose();
            changeDocumentSubscription.dispose();
            saveSubscription.dispose();
        });
    }

    /**
     * Parse the CMake cache options from the document content.
     */
    private async getConfigurationOptionsFromDocument(document: vscode.TextDocument): Promise<IOption[]> {
        const options: IOption[] = [];
        const content = document.getText();
        const entries = CMakeCache.parseCache(content);

        for (const entry of entries.values()) {
            // Static cache entries are set automatically by CMake, overriding any value set by the user in this view.
            // Not useful to show these entries in the list.
            if (entry.type !== CacheEntryType.Static) {
                options.push({
                    key: entry.key,
                    helpString: entry.helpString,
                    choices: entry.choices,
                    type: (entry.type === CacheEntryType.Bool) ? "Bool" : "String",
                    value: entry.value,
                    dirty: false
                });
            }
        }

        return options;
    }

    /**
     * Apply the edited options to the document.
     */
    private async applyEditsToDocument(document: vscode.TextDocument, options: IOption[]): Promise<void> {
        const dirtyOptions = options.filter(opt => opt.dirty);
        if (dirtyOptions.length === 0) {
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        let content = document.getText();

        for (const option of dirtyOptions) {
            content = this.replaceOptionInContent(content, option);
        }

        // Replace the entire document content
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);
    }

    /**
     * Replace a single option value in the content string.
     */
    private replaceOptionInContent(content: string, option: IOption): string {
        // Handle keys that may need to be quoted (contain special characters)
        const escapedKey = option.key.replace(/[^A-Za-z0-9_]/g, '\\$&');
        const quotedEscapedKey = `"${escapedKey}"`;

        // Try unquoted key first, then quoted
        let re = RegExp(`^(${escapedKey}:[^=]+=)(.*)$`, 'm');
        let match = content.match(re);

        if (!match) {
            re = RegExp(`^(${quotedEscapedKey}:[^=]+=)(.*)$`, 'm');
            match = content.match(re);
        }

        if (match) {
            let newValue: string;
            if (option.type === "Bool") {
                newValue = util.isTruthy(option.value) ? "TRUE" : "FALSE";
            } else {
                // Truncate at newlines
                const newlineIndex = option.value.search(/[\r\n]/);
                if (newlineIndex >= 0) {
                    newValue = option.value.substring(0, newlineIndex);
                    log.warning(localize('cache.value.truncation.warning', 'Newline(s) found in cache entry {0}. Value has been truncated to {1}', `"${option.key}"`, `"${newValue}"`));
                } else {
                    newValue = option.value;
                }
            }

            const oldLine = match[0];
            const prefix = match[1];
            const newLine = prefix + newValue;
            content = content.replace(oldLine, newLine);
        }

        return content;
    }

    /**
     * Returns an HTML markup for the webview.
     */
    getWebviewMarkup(options: IOption[]) {
        const key = '%TABLE_ROWS%';
        const searchButtonText = localize("search", "Search");
        const saveButtonText = localize("save", "Save");
        const keyColumnText = localize("key", "Key");
        const valueColumnText = localize("value", "Value");

        let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.cmakeCacheEditorText}</title>
        <style>
          .select-default {
              width: 300px;
              height: 25px;
              font-size: 13px;
              font-family:sans-serif;
              color: var(--vscode-settings-dropdownForeground);
              background: var(--vscode-settings-dropdownBackground);
              border: 1px solid var(--vscode-settings-dropdownBorder);
          }

          input {
            height: 17px;
            padding: 6px;
            border: solid 1px;
            font-size: 13px;
            font-family: Menlo, Monaco, Consolas, "Droid Sans Mono", "Courier New", monospace, "Droid Sans Fallback";
            color: var(--vscode-settings-textInputForeground);
            background: var(--vscode-settings-textInputBackground);
            border: 1px solid var(--vscode-settings-textInputBorder);
          }

          .invalid-selection {
            background-color: #4e2621;
          }

          .vscode-light .input-disabled {
              background-color:rgba(255, 255, 255, 0.4);
              color: rgb(138, 138, 138);
              border: solid 1px rgb(201, 198, 198);
          }

          .vscode-dark .input-disabled {
              background-color: rgba(255, 255, 255, 0.1);
              color: rgb(167, 167, 167);
          }

          .vscode-high-contrast .input-disabled {
               background-color: transparent;
               color: #fff;
               border: solid 1px rgb(255, 255, 255);
          }

          .vscode-high-contrast code > div {
              background-color: #000
          }

          .vscode-high-contrast h1 {
              border-color: #000
          }

          .vscode-light {
              color: #1e1e1e
          }
          .vscode-dark {
              color: #ddd
          }
          .vscode-high-contrast {
              color: #fff
          }
          .vscode-light table,
          .vscode-high-contrast table {
            border: 1px solid var(--vscode-settings-textInputBorder);
            border-collapse: collapse;
          }
          .vscode-dark table {
            border: 1px solid rgb(255,255,255,0.3);
            border-collapse: collapse;
          }
          .container {
            padding-right: 15px;
            padding-left: 15px;
            width: 760px;
            margin: 30px auto;
          }
          tr {
            height: 25px;
          }
          .vscode-light th {
            background: rgba(0,0,0,.1);
          }
          .vscode-dark th {
            background: rgba(255,255,255,.1);
          }
          input#search {
            width: 98%;
            padding: 11px 0px 11px 11px;
            margin: 10px 0;
            color: var(--vscode-settings-textInputForeground);
            background: var(--vscode-settings-textInputBackground);
            border: 1px solid var(--vscode-settings-textInputBorder);
          }
          .invisible {
            display: none;
          }
          button#save {
            float: right;
            padding: 10px 25px;
            margin-top: 15px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            text-transform: uppercase;
            font-weight: bold;
            border: solid 1px var(--vscode-contrastBorder);
            transition: 100ms ease-in-out;
          }
          button#save:hover {
            cursor: pointer;
            background-color: var(--vscode-button-hoverBackground);
          }
          button#save:focus,
          button#save input:focus,
          button#save select:focus {
            outline: 1px solid -webkit-focus-ring-color;
            outline-offset: 2px;
            border-color: var(--vscode-focusBorder);
            border: var(--vscode-focusBorder);
            contrastBorder: var(--vscode-focusBorder);
            contrastActiveBorder: var(--vscode-focusBorder);
          }
          button#save:active {
            outline: none;
          }

          checkbox:active,
          checkbox {
            color: var(--vscode-settings-checkboxForeground);
            background: var(--vscode-settings-checkboxForeground);
            border: var(--vscode-settings-checkboxBorder);
          }

          .vscode-light cmake-input-bool input:checked,
          .vscode-dark cmake-input-bool {
            color: var(--vscode-settings-checkboxForeground);
            background: var(--vscode-settings-checkboxForeground);
            border: var(--vscode-settings-checkboxBorder);
          }

          .cmake-input-bool input:checked,
          .cmake-input-bool:active,
          .cmake-input-bool {
            color: var(--vscode-settings-checkboxForeground);
            background: var(--vscode-settings-checkboxForeground);
            border: var(--vscode-settings-checkboxBorder);
          }
          a:focus,
          input:focus,
          select:focus,
          textarea:focus {
              outline: 1px solid -webkit-focus-ring-color;
              outline-offset: -1px;
              border-color: var(--vscode-focusBorder);
              contrastBorder: var(--vscode-focusBorder);
              contrastActiveBorder: var(--vscode-focusBorder);
          }
        </style>
        <script>
          const vscode = acquireVsCodeApi();
          function updateCheckboxState(checkbox) {
            checkbox.labels.forEach(label => label.textContent = checkbox.checked ? 'ON' : 'OFF');
          }
          function toggleKey(checkbox) {
            updateCheckboxState(checkbox);
            vscode.postMessage({key: checkbox.id, type: "Bool", value: checkbox.checked});
          }
          function validateInput(editbox) {
            const list = editbox.list;
            if (list) {
              let found = false;
              for (const opt of list.options) {
                if (opt.value === editbox.value) {
                  found = true;
                  break;
                }
              }
              editbox.classList.toggle('invalid-selection', !found);
            }
          }
          function edit(editbox) {
            validateInput(editbox);
            vscode.postMessage({key: editbox.id, type: "String", value: editbox.value});
          }
          function save() {
            vscode.postMessage(false);
          }
          function search() {
            const filter = document.getElementById('search').value.toLowerCase();
            for (const tr of document.querySelectorAll('.content-tr')) {
              if (!tr.innerHTML.toLowerCase().includes(filter)) {
                tr.classList.add('invisible');
              } else {
                tr.classList.remove('invisible');
              }
            }
          }

          window.onload = function() {
            document.querySelectorAll('.cmake-input-bool').forEach(checkbox => {
              updateCheckboxState(checkbox);
              checkbox.onclick = () => toggleKey(checkbox);
            });
            document.querySelectorAll('.cmake-input-text').forEach(editbox => {
              validateInput(editbox)
              editbox.oninput = () => edit(editbox);
            });
            document.querySelector('#search').focus();
          }
        </script>
    </head>
    <body>
      <div class="container">
        <button id="save" onclick="save()">${saveButtonText}</button>
        <h1>${this.cmakeCacheEditorText}</h1>
        <input class="search" type="text" id="search" oninput="search()" placeholder="${searchButtonText}">
        <table style="width:100%">
          <tr style="height: 25px;">
            <th style="width: 30px"></th>
            <th style="width: 1px; white-space: nowrap;">${keyColumnText}</th>
            <th>${valueColumnText}</th>
          </tr>
          ${key}
        </table>
      </div>
    </body>
    </html>`;

        // compile a list of table rows that contain the key and value pairs
        const tableRows = options.map(option => {

            // HTML attributes may not contain literal double quotes or ambiguous ampersands
            const escapeAttribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
            // Escape HTML special characters that may not occur literally in any text
            const escapeHtml = (text: string) =>
                escapeAttribute(text)
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/'/g, "&#039;")
                    .replace(/ /g, "&nbsp;"); // we are usually dealing with single line entities - avoid unintential line breaks

            const id = escapeAttribute(option.key);
            let editControls = '';

            if (option.type === "Bool") {
                editControls = `<input class="cmake-input-bool" id="${id}" type="checkbox" ${util.isTruthy(option.value) ? 'checked' : ''}>
          <label id="LABEL_${id}" for="${id}"/>`;
            } else {
                const hasChoices = option.choices.length > 0;
                if (hasChoices) {
                    editControls = `<datalist id="CHOICES_${id}">
            ${option.choices.map(ch => `<option value="${escapeAttribute(ch)}">`).join('')}
          </datalist>`;
                }
                editControls += `<input class="cmake-input-text" id="${id}" value="${escapeAttribute(option.value)}" style="width: 90%;"
          type="text" ${hasChoices ? `list="CHOICES_${id}"` : ''}>`;
            }

            return `<tr class="content-tr">
      <td></td>
      <td title="${escapeAttribute(option.helpString)}">${escapeHtml(option.key)}</td>
      <td>${editControls}</td>
    </tr>`;
        });

        html = html.replace(key, tableRows.join(""));

        return html;
    }
}

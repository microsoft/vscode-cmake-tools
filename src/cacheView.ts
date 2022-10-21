import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as telemetry from '@cmt/telemetry';
import * as util from './util';

import { CacheEntryType, CMakeCache } from './cache';

import * as logging from './logging';
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
 * This object manages the webview rendering.
 */
export class ConfigurationWebview {
    private readonly cmakeCacheEditorText = localize("cmake.cache.editor", "CMake Cache Editor");

    // The dirty state of the whole webview.
    private dirtyFlag: boolean = false;
    get isDirty(): boolean {
        return this.dirtyFlag;
    }
    set isDirty(d: boolean) {
        this.dirtyFlag = d;

        if (this.panel.title) {
            // The webview title should reflect the dirty state
            this.panel.title = this.cmakeCacheEditorText;
            if (d) {
                this.panel.title += "*";
            } else {
                // If the global dirty state gets cleared, make sure all the entries
                // of the cache table have their state dirty updated accordingly.
                this.options.forEach(opt => opt.dirty = false);
            }
        }
    }
    public readonly panel: vscode.WebviewPanel;

    private options: IOption[] = [];

    constructor(protected cachePath: string, protected save: () => void) {
        this.panel = vscode.window.createWebviewPanel(
            'cmakeConfiguration', // Identifies the type of the webview. Used internally
            this.cmakeCacheEditorText, // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                // this is needed for the html view to trigger events in the extension
                enableScripts: true
            }
        );
    }

    // Save from the UI table into the CMake cache file if there are any unsaved edits.
    async persistCacheEntries() {
        if (this.isDirty) {
            telemetry.logEvent("editCMakeCache", { command: "saveCMakeCacheUI" });
            await this.saveCmakeCache(this.options);
            void vscode.window.showInformationMessage(localize('cmake.cache.saved', 'CMake options have been saved.'));
            // start configure
            this.save();
            this.isDirty = false;
        }
    }

    /**
     * Called when the extension detects a cache change performed outside this webview.
     * The webview is updated with the latest cache variables (this includes new or deleted entries),
     * but for merge conflicts the user is asked which values to keep.
     */
    async refreshPanel() {
        if (this.isDirty) {
            const newOptions = await this.getConfigurationOptions();
            const mergedOptions: IOption[] = [];
            let conflictsExist = false;
            newOptions.forEach(option => {
                const index = this.options.findIndex(opt => opt.key === option.key);
                // Add to the final list of cache entries if it's a new, an unchanged value
                // or a changed value of a cache variable that is not dirty in the webview.
                if (index === -1 ||
                    this.options[index].value === option.value ||
                    !this.options[index].dirty) {
                    mergedOptions.push(option);
                } else {
                    // Log the cache value mismatch in the Output Channel, until we display the conflicts
                    // more friendly in the UI.
                    conflictsExist = true;
                    log.info(`Detected a cache merge conflict for entry "${option.key}": ` +
                        `value in CMakeCache.txt="${option.value}", ` +
                        `value in UI="${this.options[index].value}"`);

                    // Include in the final list of cache entries the version from UI.
                    // If later the user choses 'ignore' or 'fromUI', the UI value is good for both
                    // and in case of 'fromCache' the read operation will be done from the cache
                    // and will override the value displayed currently in the UI.
                    // If we don't do this then any merge conflicting entries will disappear from the list
                    // if in the middle and will be showed at the end (because we would need to add them
                    // via a concat).
                    mergedOptions.push(this.options[index]);
                }
            });

            // Any variables present in the current webview but not in the latest CMake Cache file
            // represent deleted cache entries. Remember them because in the 'ignore' case below
            // we need to keep them.
            const deletedOptions: IOption[] = [];
            this.options.forEach(option => {
                if (newOptions.findIndex(opt => opt.key === option.key) === -1) {
                    deletedOptions.push(option);
                }
            });

            let result;
            // Don't reload the conflicting CMake cache entries. Keep but don't save the current edits.
            // Include any new or non-conflicting CMake cache updates.
            const ignore = localize('ignore', 'Ignore');
            // Persist the currently unsaved edits.
            const fromUI = localize('from.UI', 'From UI');
            // Reload the CMake cache, losing the curent unsaved edits.
            const fromCache = localize('from.cache', 'From Cache');
            if (conflictsExist) {
                result = await vscode.window.showWarningMessage(
                    localize('merge.cache.edits', "The CMake cache has been modified outside this webview and there are conflicts with the current unsaved edits. Which values do you want to keep?"),
                    ignore,
                    fromCache,
                    fromUI);
                if (result === fromUI) {
                    this.options = mergedOptions;
                    await this.persistCacheEntries();
                } else if (result === fromCache) {
                    this.options = newOptions;
                }
            } else {
                this.options = mergedOptions;
            }

            // The webview needs a re-render also for the "ignore" or "fromUI" cases
            // to reflect all the unconflicting changes.
            if (this.panel.visible) {
                await this.renderWebview(this.panel, false);
            }

            // Keep the unsaved look in case the user decided to ignore the CMake Cache conflicts
            // between the webview and the file on disk.
            if (result !== ignore) {
                this.isDirty = false;
            }
        } else {
            this.options = await this.getConfigurationOptions();
        }
    }

    /**
     * Initializes the panel, registers events and renders initial content
     */
    async initPanel() {
        await this.renderWebview(this.panel, true);

        this.panel.onDidChangeViewState(async event => {
            if (event.webviewPanel.visible) {
                await this.renderWebview(event.webviewPanel, false);
            }
        });

        this.panel.onDidDispose(async event => {
            console.log(`disposing webview ${event} - ${this.panel}`);
            if (this.isDirty) {
                const yes = localize('yes', 'Yes');
                const no = localize('no', 'No');
                const result = await vscode.window.showWarningMessage(
                    localize('unsaved.cache.edits', "Do you want to save the latest cache edits?"), yes, no);
                if (result === yes) {
                    await this.persistCacheEntries();
                }
            }
        });

        // handles the following events:
        //     - checkbox update (update entry in the internal array)
        //     - editbox update (update entry in the internal array)
        //     - save button (save the internal array into the cache file)
        this.panel.webview.onDidReceiveMessage(async (option: IOption) => {
            if (!option) {
                await this.persistCacheEntries();
            } else {
                const index = this.options.findIndex(opt => opt.key === option.key);
                if (this.options[index].value !== option.value) {
                    this.isDirty = true;
                    this.options[index].dirty = true;
                    this.options[index].type = option.type;
                    this.options[index].value = option.value;
                }
            }
        });
    }

    async saveCmakeCache(options: IOption[]) {
        const cmakeCache = await CMakeCache.fromPath(this.cachePath);
        await cmakeCache.saveAll(options);
    }

    /**
     * reads local cmake cache path from build folder and returns array of IOption objects
     */
    async getConfigurationOptions(): Promise<IOption[]> {
        const options: IOption[] = [];

        // get cmake cache
        const cmakeCache = await CMakeCache.fromPath(this.cachePath);
        for (const entry of cmakeCache.allEntries) {
            // Static cache entries are set automatically by CMake, overriding any value set by the user in this view.
            // Not useful to show these entries in the list.
            if (entry.type !== CacheEntryType.Static) {
                options.push({ key: entry.key, helpString: entry.helpString, choices: entry.choices, type: (entry.type === CacheEntryType.Bool) ? "Bool" : "String", value: entry.value, dirty: false });
            }
        }
        return options;
    }

    /**
     *
     * @param panel
     */
    async renderWebview(panel?: vscode.WebviewPanel, refresh: boolean = false) {
        if (!panel) {
            panel = this.panel;
        }

        if (refresh) {
            this.options = this.options.concat(await this.getConfigurationOptions());
        }

        panel.webview.html = this.getWebviewMarkup();
    }

    /**
     * Returns an HTML markup
     * @param options CMake Cache Options
     */
    getWebviewMarkup() {
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
            document.getElementById('not-saved').classList.remove('invisible');
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
            document.getElementById('not-saved').classList.remove('invisible');
          }
          function save() {
            document.getElementById('not-saved').classList.add('invisible');
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
          }
        </script>
    </head>
    <body>
      <div class="container">
        <button id="save" onclick="save()">${saveButtonText}</button>
        <h1>${this.cmakeCacheEditorText}<span class="invisible" id="not-saved">*</span></h1>
        <input class="search" type="text" id="search" oninput="search()" placeholder="${searchButtonText}" autofocus>
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
        const tableRows = this.options.map(option => {

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
            ${option.choices.map(ch => `<option value="${escapeAttribute(ch)}">`).join()}
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

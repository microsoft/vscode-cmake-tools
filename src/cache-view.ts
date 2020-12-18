import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as api from './api';
import * as util from './util';

import { CMakeCache } from './cache';

import * as logging from './logging';
const log = logging.createLogger('cache');

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface IOption {
    key: string;    // same as CMake cache variable key names
    type: string;   // "Bool" for boolean and "String" for anything else for now
    value: string;  // value from the cache file or changed in the UI
    dirty: boolean; // if the variable was edited in the UI
}


/**
 * This object manages the webview rendering.
 */
export class ConfigurationWebview {
  private readonly cmakeCacheEditorText = localize("cmake.cache.editor", "CMake Cache Editor");

  // The dirty state of the whole webview.
  private _dirty: boolean = false;
  get dirty(): boolean { return this._dirty; }
  set dirty(d: boolean) {
    this._dirty = d;

    if (this._panel.title) {
      // The webview title should reflect the dirty state
      this._panel.title = this.cmakeCacheEditorText;
      if (d) {
        this._panel.title += "*";
      } else {
        // If the global dirty state gets cleared, make sure all the entries
        // of the cache table have their state dirty updated accordingly.
        this._options.forEach(opt => { opt.dirty = false; });
      }
    }
  }
  private readonly _panel: vscode.WebviewPanel;
  private _options: IOption[] = [];
  get panel() {
      return this._panel;
  }

  constructor(protected cachePath: string,
      protected save: () => void) {
    this._panel = vscode.window.createWebviewPanel(
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
    if (this.dirty) {
      await this.saveCmakeCache(this._options);
      vscode.window.showInformationMessage(localize('cmake.cache.saved', 'CMake options have been saved.'));
      // start configure
      this.save();
      this.dirty = false;
    }
  }

  /**
   * Called when the extension detects a cache change performed outside this webview.
   * The webview is updated with the latest cache variables (this includes new or deleted entries),
   * but for merge conflicts the user is asked which values to keep.
   */
  async refreshPanel() {
    if (this.dirty) {
      const newOptions = await this.getConfigurationOptions();
      const mergedOptions: IOption[] = [];
      let conflictsExist = false;
      newOptions.forEach(option => {
        const index = this._options.findIndex(opt => opt.key === option.key);
        // Add to the final list of cache entries if it's a new, an unchanged value
        // or a changed value of a cache variable that is not dirty in the webview.
        if (index === -1 ||
            this._options[index].value === option.value ||
            !this._options[index].dirty) {
          mergedOptions.push(option);
        } else {
          // Log the cache value mismatch in the Output Channel, until we display the conflicts
          // more friendly in the UI.
          conflictsExist = true;
          log.info(`Detected a cache merge conflict for entry "${option.key}": ` +
            `value in CMakeCache.txt="${option.value}", ` +
            `value in UI="${this._options[index].value}"`);

          // Include in the final list of cache entries the version from UI.
          // If later the user choses 'ignore' or 'fromUI', the UI value is good for both
          // and in case of 'fromCache' the read operation will be done from the cache
          // and will override the value displayed currently in the UI.
          // If we don't do this then any merge conflicting entries will disappear from the list
          // if in the middle and will be showed at the end (because we would need to add them
          // via a concat).
          mergedOptions.push(this._options[index]);
        }
      });

      // Any variables present in the current webview but not in the latest CMake Cache file
      // represent deleted cache entries. Remember them because in the 'ignore' case below
      // we need to keep them.
      const deletedOptions: IOption[] = [];
      this._options.forEach(option => {
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
          this._options = mergedOptions;
          await this.persistCacheEntries();
        } else if (result === fromCache) {
          this._options = newOptions;
        }
      } else {
        this._options = mergedOptions;
      }

      // The webview needs a re-render also for the "ignore" or "fromUI" cases
      // to reflect all the unconflicting changes.
      if (this._panel.visible) {
        await this.renderWebview(this._panel, false);
      }

      // Keep the unsaved look in case the user decided to ignore the CMake Cache conflicts
      // between the webview and the file on disk.
      if (result !== ignore) {
        this.dirty = false;
      }
    } else {
      this._options = await this.getConfigurationOptions();
    }
  }

  /**
   * Initializes the panel, registers events and renders initial content
   */
  async initPanel() {
    await this.renderWebview(this._panel, true);

    this._panel.onDidChangeViewState(async event => {
      if (event.webviewPanel.visible) {
        await this.renderWebview(event.webviewPanel, false);
      }
    });

    this._panel.onDidDispose(async event => {
      console.log(`disposing webview ${event} - ${this._panel}`);
      if (this.dirty) {
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
    this._panel.webview.onDidReceiveMessage(async (option: IOption) => {
      if (!option) {
        await this.persistCacheEntries();
      } else {
        const index = this._options.findIndex(opt => opt.key === option.key);
        if (this._options[index].value !== option.value) {
          this.dirty = true;
          this._options[index].dirty = true;
          this._options[index].type = option.type;
          this._options[index].value = option.value;
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
    return new Promise(async (resolve: (value: IOption[]) => void) => {
      const options: IOption[] = [];

      // get cmake cache
      const cmakeCache = await CMakeCache.fromPath(this.cachePath);
      for (const entry of cmakeCache.allEntries) {
        // Static cache entries are set automatically by CMake, overriding any value set by the user in this view.
        // Not useful to show these entries in the list.
        if (entry.type !== api.CacheEntryType.Static) {
          options.push({ key: entry.key, type: (entry.type === api.CacheEntryType.Bool) ? "Bool" : "String", value: entry.value, dirty: false });
        }
      }

      resolve(options);
    });
  }

  /**
   *
   * @param panel
   */
  async renderWebview(panel?: vscode.WebviewPanel, refresh: boolean = false) {
    if (!panel) {
        panel = this._panel;
    }

    if (refresh) {
      this._options = this._options.concat(await this.getConfigurationOptions());
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
    const keyColumnText = localize ("key", "Key");
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
          function toggleKey(id) {
            const label = document.getElementById('LABEL_' + id);
            label.textContent = label.textContent == 'ON' ? 'OFF' : 'ON';
            const checkbox = document.getElementById(id);
            vscode.postMessage({key: id, type: "Bool", value: checkbox.checked});
            document.getElementById('not-saved').classList.remove('invisible');
          }
          function edit(id) {
            const editbox = document.getElementById(id);
            vscode.postMessage({key: id, type: "String", value: editbox.value});
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
    const tableRows = this._options.map(option => {
      if (option.type === "Bool") {
        return `<tr class="content-tr">
        <td></td>
        <td>${option.key}</td>
        <td>
          <input class="cmake-input-bool" id="${option.key}" onclick="toggleKey('${option.key}')"
                 type="checkbox" ${util.isTruthy(option.value) ? 'checked' : ''}>
          <label id="LABEL_${option.key}" for="${option.key}">${util.isTruthy(option.value) ? `ON` : `OFF`}</label>
        </td>
      </tr>`;
      } else {
        return `<tr class="content-tr">
        <td></td>
        <td>${option.key}</td>
        <td>
          <input id="${option.key}" value="${option.value}" style="width: 90%;"
                 type="text" oninput="edit('${option.key}')">
        </td>
      </tr>`;
      }
    });

    html = html.replace(key, tableRows.join(""));

    return html;
  }
}
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as api from './api';
import * as util from './util';
import { CMakeCache } from './cache';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface IOption {
    key: string;
    type: string;
    value: string;
}


/**
 * This object manages the webview rendering.
 */
export class ConfigurationWebview {

  WINDOW_TITLE = 'CMake Cache Editor';
  WINDOW_TITLE_UNSAVED = 'CMake Cache Editor*';

  private readonly _panel: vscode.WebviewPanel;
  get panel() {
      return this._panel;
  }

  constructor(protected cachePath: string,
      protected save: () => void) {
    this._panel = vscode.window.createWebviewPanel(
      'cmakeConfiguration', // Identifies the type of the webview. Used internally
      'CMake Cache Editor', // Title of the panel displayed to the user
      vscode.ViewColumn.One, // Editor column to show the new webview panel in.
      {
        // this is needed for the html view to trigger events in the extension
        enableScripts: true
      }
    );
  }

  /**
   * Initializes the panel, registers events and renders initial content
   */
  async initPanel() {
    await this.renderWebview(this._panel);

    this._panel.onDidChangeViewState(async event => {
      // reset options when user clicks on panel
      if (event.webviewPanel.visible) {
        await this.renderWebview(event.webviewPanel);
      }
    });

    // handle checkbox value change event
    this._panel.webview.onDidReceiveMessage(async (options: IOption[]) => {
      if (options) {
        await this.saveCmakeCache(options);
        this._panel.title = this.WINDOW_TITLE;
        vscode.window.showInformationMessage(localize('cmake.cache.saved', 'CMake options have been saved.'));
        // start configure
        this.save();
      } else {
        this._panel.title = this.WINDOW_TITLE_UNSAVED;
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
          options.push({ key: entry.key, type: (entry.type === api.CacheEntryType.Bool) ? "Bool" : "String", value: entry.value });
        }
      }

      resolve(options);
    });
  }

  /**
   *
   * @param panel
   */
  async renderWebview(panel?: vscode.WebviewPanel) {
    if (!panel) {
        panel = this._panel;
    }

    const options: IOption[] = await this.getConfigurationOptions();
    panel.webview.html = this.getWebviewMarkup(options);
  }

  /**
   * Returns an HTML markup
   * @param options CMake Cache Options
   */
  getWebviewMarkup(options: IOption[]) {
    const key = '%TABLE_ROWS%';
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CMake Cache Editor</title>
        <style>
          table {
            border: 1px solid black;
            border-collapse: collapse;
          }

          .container {
            padding-right: 15px;
            padding-left: 15px;
            width: 760px;
            margin: 30px auto;
          }

          tr {
            height: 30px;
            background: rgba(255,255,255,.1);
            border-bottom: 1px solid rgba(255,255,255,0.045);
          }

          tr.content-tr:hover {
            background: rgba(255, 255, 255, .25);
          }

          input#search {
            width: 98%;
            padding: 11px 0px 11px 11px;
            margin: 10px 0;
          }

          .invisible {
            display: none;
          }

          button#save {
            float: right;
            padding: 10px 25px;
            margin-top: 15px;
            background: none;
            color: white;
            text-transform: uppercase;
            font-weight: bold;
            border: 1px solid transparent;
            border-image: linear-gradient(to bottom right, #b827fc 0%, #2c90fc 25%, #b8fd33 50%, #fec837 75%, #fd1892 100%);
            border-image-slice: 1;
            transition: 100ms ease-in-out;
          }

          button#save:hover {
            cursor: pointer;
            background: #333;
          }
        </style>

        <script>
          const vscode = acquireVsCodeApi();
          function toggleKey(id) {
            const label = document.getElementById('LABEL_' + id);

            label.textContent = label.textContent == 'ON' ? 'OFF' : 'ON';
            vscode.postMessage(false);

            document.getElementById('not-saved').classList.remove('invisible');
          }

          function save() {
            const inputsBool = [...document.querySelectorAll('.cmake-input-bool')];
            const valuesBool = inputsBool.map(x => { return { key: x.id, value: x.checked } });

            const inputsString = [...document.querySelectorAll('.cmake-input-string')];
            const valuesString = inputsString.map(x => {
              const setting = document.getElementById(x.id);
              return { key: x.id, value: setting.value };
            });

            document.getElementById('not-saved').classList.add('invisible');
            vscode.postMessage(valuesBool.concat(valuesString));
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
        <button id="save" onclick="save()">Save</button>
        <h1>CMake Cache Editor<span class="invisible" id="not-saved">*</span></h1>
        <hr>
        <input class="search" type="text" id="search" oninput="search()" placeholder="Search" autofocus>
        <table style="width:100%">
          <tr style="
            height: 35px;
            background: linear-gradient(90deg, rgba(145,145,173,1) 0%, rgba(163,163,194,1) 36%, rgba(130,130,171,1) 61%, rgba(141,137,163,1) 100%);
          ">
            <th style="width: 30px">#</th>
            <th style="width: 1px; white-space: nowrap;">Key</th>
            <th>Value</th>
          </tr>
          ${key}
        </table>
      </div>
    </body>
    </html>`;

    // compile a list of table rows that contain the key and value pairs
    const tableRows = options.map(option => {
      if (option.type === "Bool") {
        return `<tr class="content-tr">
        <td></td>
        <td>${option.key}</td>
        <td>
          <input class="cmake-input-bool" id="${option.key}" onclick="toggleKey('${option.key}')"
                 type="checkbox" ${util.isTruthy(option.value) ? 'checked' : ''}>
          <label id="LABEL_${option.key}" for="${option.key}">${util.isTruthy(option.value) ? 'ON' : 'OFF'}</label>
        </td>
      </tr>`;
      } else {
        return `<tr class="content-tr">
        <td></td>
        <td>${option.key}</td>
        <td>
          <input class="cmake-input-string" id="${option.key}" value="${option.value}" style="width: 90%;"
                 type="text">
        </td>
      </tr>`;
      }
    });

    html = html.replace(key, tableRows.join(""));

    return html;
  }
}

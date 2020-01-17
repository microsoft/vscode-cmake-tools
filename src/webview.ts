import * as vscode from 'vscode';
import { CMakeCache } from './cache';
import * as api from './api';

interface IOption {
    key: string;
    value: boolean;
}

export class ConfigurationWebview {
  private readonly _panel: vscode.WebviewPanel;
  cachePath = '';

  get panel() {
      return this._panel;
  }

  constructor(cachePath: string) {
    this._panel = vscode.window.createWebviewPanel(
      'cmakeConfiguration', // Identifies the type of the webview. Used internally
      'CMake Configuration', // Title of the panel displayed to the user
      vscode.ViewColumn.One, // Editor column to show the new webview panel in.
      {
        enableScripts: true
      }
    );

    this.cachePath = cachePath;
  }

  async initPanel() {
    await this.updateWebview(this._panel);

    this._panel.onDidChangeViewState(async event => {
      // reset options when user clicks on panel
      if (event.webviewPanel.visible) {
        await this.updateWebview(event.webviewPanel);
      }
    });

    // handle checkbox value change event
    this._panel.webview.onDidReceiveMessage(async (options: IOption[]) => {
      try {
        if (options) {
          await this.saveCmakeCache(options);
          this._panel.title = 'CMake Configuration';
          vscode.window.showInformationMessage('CMake options have been saved.');
        } else {
          this._panel.title = 'CMake Configuration *';
        }
      } catch (error) {
        vscode.window.showErrorMessage(error);
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
        if (entry.type === api.CacheEntryType.Bool) {
          options.push({ key: entry.key, value: entry.value });
        }
      }

      resolve(options);
    });
  }

  async updateWebview(panel?: vscode.WebviewPanel) {
    if (!panel) {
        panel = this._panel;
    }

    const options: IOption[] = await this.getConfigurationOptions();
    panel.webview.html = this.getWebviewContent(options);
  }

  getWebviewContent(options: IOption[]) {
    const key = '%TABLE_ROWS%';
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CMake Configuration</title>
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
            const inputs = [...document.querySelectorAll('.cmake-input')];
            const values = inputs.map(x => { return { key: x.id, value: x.checked } });

            document.getElementById('not-saved').classList.add('invisible');
            vscode.postMessage(values);
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
        <h1>CMake Configuration<span class="invisible" id="not-saved">*</span></h1>
        <small>Here you can configure your cmake options by the touch of a button.</small>
        <hr>
        <input class="search" type="text" id="search" oninput="search()" placeholder="Search">
        <table style="width:100%">
          <tr style="
            height: 35px;
            background: linear-gradient(90deg, rgba(145,145,173,1) 0%, rgba(163,163,194,1) 36%, rgba(130,130,171,1) 61%, rgba(141,137,163,1) 100%);
          ">
            <th style="width: 30px">#</th>
            <th>Key</th>
            <th>Value</th>
          </tr>
          ${key}
        </table>
      </div>
    </body>
    </html>`;

    // compile a list of table rows that contain the key and value pairs
    const tableRows = options.map(option => {
      return `<tr class="content-tr">
        <td></td>
        <td>${option.key}</td>
        <td>
          <input class="cmake-input" id="${option.key}" onclick="toggleKey('${option.key}')"
                 type="checkbox" ${option.value ? 'checked' : ''}>
          <label id="LABEL_${option.key}" for="${option.key}">${option.value ? 'ON': 'OFF'}</label>
        </td>
      </tr>`;
    });

    html = html.replace(key, tableRows.join(""));

    return html;
  }
}

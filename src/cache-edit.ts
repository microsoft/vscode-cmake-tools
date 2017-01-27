import * as path from 'path';
import * as http from 'http';
import * as vscode from 'vscode';

export class CacheEditorContentProvider implements
    vscode.TextDocumentContentProvider {
  constructor(private readonly _ctx: vscode.ExtensionContext, private readonly _port: Number) {
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const here = __dirname;
    const inline_script = path.join(here, 'cache-edit-inline.ts');
    const poly_html = this._ctx.asAbsolutePath('node_modules/Polymer/polymer.html');
    return `
      <html>
        <head>
          <link rel=import href="file://${poly_html}">
          <style>
            body {
              width: 100vw;
              height: 100vh;
              display: flex;
              flex-direction: column;
              align-items: stretch;
            }
            cmt-editor {
              flex: 1;
            }
          </style>
        </head>
        <body>
          <dom-module id=cmt-cache-entry>
            <template>
              <style>
                :host {
                  display: flex;
                  flex-direction: row;
                  font-family: Fira Code, Ubuntu Mono, Courier New, Courier, monospace;
                  margin: 2px;
                  margin-right: 10px;
                }
                :host(:not([advanced])) .key .asterisk {
                  display: none;
                }
                :host(:not([visible])) {
                  display: none;
                }
                .key {
                  white-space: nowrap;
                  flex-grow: 1;
                  flex-shrink: 1;
                  flex-basis: 100px;
                  text-align: right;
                  margin-right: 10px;
                  line-height: 1.9em;
                }
                .input {
                  flex: 5;
                  font-family: Fira Code, Ubuntu Mono, Courier New, Courier, monospace;
                  background-color: rgb(60,60,60);
                  color: rgb(204,204,204);
                  border: none;
                  padding: 4px;
                }
                .input[modified] {
                  outline: 1px solid #e44;
                }
              </style>
              <div class=key><span class=asterisk>*</span>[[key]]</div>
              <input id=textInput class=input type="text" value="{{value::input}}" modified$=[[modified]] on-input=_modifiedValue>
            </template>
            <script>
              Polymer({
                is: "cmt-cache-entry",
                properties: {
                  key: String,
                  value: {
                    type: String,
                    observer: '_valueChanged'
                  },
                  modified: {
                    type: Boolean,
                    value: false,
                  },
                  type: Number,
                  strings: Array,
                  advanced: {
                    type: Boolean,
                    reflectToAttribute: true,
                  },
                  helpString: String,
                  showAdvanced: Boolean,
                  visible: {
                    type: Boolean,
                    reflectToAttribute: true,
                    computed: '_isVisible(showAdvanced, advanced)'
                  },
                },
                _valueChanged(v) {
                  this.$.textInput.value = v;
                },
                _isVisible() {
                  return !this.advanced || this.showAdvanced;
                },
                getEnteredValue() {
                  return this.$.textInput.value;
                },
                _modifiedValue() {
                  this.modified = true;
                  this.fire('modified', {
                    key: this.key,
                    value: this.$.textInput.value,
                  });
                },
              });
            </script>
          </dom-module>

          <dom-module id=cmt-editor>
            <template>
              <style>
                :host {
                  display: flex;
                  flex-direction: column;
                  align-items: stretch;
                  margin-bottom: 50px;
                  border-left: 1px solid rgb(70,70,70);
                  padding-bottom: 10px;
                  overflow-y: auto;
                  padding: 0 10px;
                }

                cmt-cache-entry, .controls {
                  flex-shrink: 0;
                }

                div.controls {
                  display: flex;
                  flex-direction: row;
                  align-items: center;
                }

                .nothing-here {
                  font-size: 18pt;
                  text-align: center;
                  align-self: center;
                  margin-top: 50px;
                }

                .buttons {
                  position: absolute;
                  bottom: 0;
                  left: 0;
                  right: 0;
                  height: 50px;
                  display: flex;
                  display: flex;
                  flex-direction: row;
                  justify-content: stretch;
                  align-items: stretch;
                  background-color: rgb(30,30,30);
                  border-top: 1px solid rgb(70, 70, 70);
                  box-shadow: 0 -2px 5px rgba(0,0,0,0.4);
                }
                .buttons button {
                  flex: 1;
                  margin: 10px;
                  cursor: pointer;
                  background-color: #007acc;
                  border: 1px solid #3f8bce;
                  color: #fff;
                  font-family: -apple-system,BlinkMacSystemFont,Segoe WPC,Segoe UI,HelveticaNeue-Light,Ubuntu,Droid Sans,sans-serif;
                  font-size: 14pt;
                }
                .buttons button:hover {
                  background-color: #3f8bce;
                }
              </style>
              <h2>CMake Cache ${uri.fsPath}</h2>
              <div class="controls">
                <input type="checkbox" checked="{{showAdvanced::change}}">
                <label>Show Advanced</label>
              </div>
              <div class="nothing-here" hidden$=[[!_empty(entries)]]>
                There are no cache entries to show. Have you configured the project?
              </div>
              <template is="dom-repeat" items="[[entries]]">
                <cmt-cache-entry
                  key=[[item.key]]
                  value=[[item.value]]
                  type=[[item.type]]
                  advanced=[[item.advanced]]
                  help-string=[[item.helpString]]
                  show-advanced=[[showAdvanced]]
                ></cmt-cache-entry>
              </template>
              <div class="buttons">
                <button on-tap=_sendConfigure>Configure</button>
                <button on-tap=_sendBuild>Build</button>
              </div>
            </template>
            <script>
              Polymer({
                is: "cmt-editor",
                properties: {
                  cachePath: String,
                  serverPort: Number,
                  entries: {
                    type: Array,
                    value: [],
                  },
                  showAdvanced: {
                    type: Boolean,
                    value: false,
                  },
                },
                listeners: {
                  modified: '_onModified'
                },
                _sendRequest(method, params = {}) {
                  const id = Math.random().toString();
                  const pr = new Promise((resolve, reject) => {
                    this._resolvers[id] = [resolve, reject];
                    this._websocket.send(JSON.stringify({method, params, id}));
                  });
                  return pr;
                },
                _empty(arr) {
                  return !arr.length;
                },
                _handleNotification(method, params) {
                  switch (method) {
                    case 'refreshContent': {
                      this.reload();
                      console.log('We need to refresh content');
                      return;
                    }
                    default: {
                      console.error('Unknown notification message: ', method, params);
                      return;
                    }
                  }
                },
                reload() {
                  this._sendRequest('getEntries').then(entries => {
                    console.debug('Got cache entries', entries);
                    this.splice('entries', 0, this.entries.length, ...entries);
                    this.entries = entries;
                    Array.from(this.querySelectorAll('cmt-cache-entry')).map(e => e.modified = false);
                  }).catch(e => {
                    debugger;
                    console.error('Error getting cache entries ', e);
                  });
                },
                ready() {
                  const ws = this._websocket = new WebSocket('ws://localhost:' + this.serverPort.toString());
                  this._modifications = {};
                  this._resolvers = {};
                  ws.onmessage = (msg) => {
                    console.log('Got message from server: ' + JSON.stringify(msg.data));
                    const data = JSON.parse(msg.data);
                    const id = data['id'];
                    if (!id) {
                      return this._handleNotification(data.method, data.params);
                    }
                    console.log('Response for message', id);
                    const [res, rej] = this._resolvers[id];
                    if ('result' in data) {
                      res(data['result']);
                    } else {
                      rej(new Error(data['error']));
                    }
                    delete this._resolvers[id];
                  };
                  ws.onopen = () => {
                    this.reload();
                  };
                },
                attached() {
                  setTimeout(() => this.reload(), 100);
                },
                _sendConfigure() {
                  console.log('Sending modifications', this._modifications);
                  const args = [];
                  for (const key in this._modifications) {
                    args.push('-D' + key + '=' + this._modifications[key]);
                  }
                  this._modifications = {};
                  return this._sendRequest('configure', {args});
                },
                _sendBuild() {
                  return this._sendConfigure().then(() => {
                    this._sendRequest('build');
                  });
                },
                _onModified(ev) {
                  const det = ev.detail;
                  console.log('Set', det.key, 'to', det.value);
                  this._modifications[det.key] = det.value;
                },
              })
            </script>
          </dom-module>
          <cmt-editor cache-path=${uri.fsPath} server-port=${this._port}></cmt-editor>
        </body>
      </html>
    `;
  }
}
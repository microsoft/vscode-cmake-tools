import * as vscode from 'vscode';

export class CacheEditorContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly _ctx: vscode.ExtensionContext, private readonly _port: Number) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
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
                :host:not([hidden]) {
                  display: flex;
                  flex-direction: column;
                  align-items: stretch;
                }
                div.main {
                  display: flex;
                  flex-direction: row;
                  font-family: Fira Code, Ubuntu Mono, Courier New, Courier, monospace;
                  margin: 2px;
                  margin-right: 10px;
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
                .control-base:not([hidden]) {
                  flex: 5;
                  display: flex;
                }
                .check-container {
                  align-items: center;
                }
                .array-container {
                  flex-direction: column;
                  align-items: stretch;
                }
                input {
                  font-family: Fira Code, Ubuntu Mono, Courier New, Courier, monospace;
                  background-color: rgb(60,60,60);
                  color: rgb(204,204,204);
                  border: none;
                  padding: 4px;
                }
                .input[modified] {
                  outline: 1px solid #e44;
                }

                .array-item:not(:first-child) {
                  margin-top: 3px;
                }

                div.help {
                  font-style: italic;
                  font-size: 10pt;
                  transition:
                    300ms line-height ease,
                    300ms padding ease,
                    300ms opacity ease;
                  line-height: 0;
                  opacity: 0;
                  text-align: center;
                  pointer-events: none;
                }
                div.help[show] {
                  line-height: normal;
                  padding: 10px;
                  opacity: 1;
                  overflow-y: auto;
                }
                div.whats-this {
                  padding: 4.5px;
                  border-left: 1px solid rgb(204,204,204);
                  color: rgb(204,204,204);
                  background-color: rgb(60,60,60);
                  border-radius: 0 50px 50px 0;
                  cursor: pointer;
                  align-self: center;
                  font-weight: bold;
                  width: 12pt;
                  text-align: center;
                }
              </style>
              <div class="main">
                <div class=key><span class=asterisk hidden$=[[!advanced]]>*</span>[[key]]</div>
                <div class="control-base array-container" hidden$="[[!_isString(type)]]">
                  <template is="dom-repeat" items="[[arrayItems]]">
                    <input
                      class='input array-item'
                      type="text"
                      modified$=[[modified]]
                      value=[[item]]
                      on-input=_modifiedArrayItemValue
                      hidden$=[[_isBool(type)]]
                    >
                  </template>
                </div>
                <div
                  class="control-base check-container"
                  hidden$=[[!_isBool(type)]]
                >
                  <input
                    id=checkBox
                    type="checkbox"
                    checked={{checked::change}}
                    class=check
                  >
                </div>
                <div on-tap="_toggleShowHelp" class=whats-this>?</div>
              </div>
              <div class="help" show$=[[showHelp]]>[[helpString]]</div>
            </template>
            <script>
              const EntryType = {
                Bool: 0,
                String: 1,
                Path: 2,
                FilePath: 3,
                Internal: 4,
                Uninitialized: 5,
                Static: 6,
              };
              Polymer({
                is: "cmt-cache-entry",
                properties: {
                  key: String,
                  value: {
                    type: String,
                    observer: 'reinit',
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
                  checked: {
                    type: Boolean,
                    observer: '_checkedChanged',
                  },
                  helpString: String,
                  showAdvanced: Boolean,
                  hidden: {
                    type: Boolean,
                    reflectToAttribute: true,
                    computed: '_isHidden(showAdvanced, advanced, type)'
                  },
                  arrayItems: {
                    type: Array,
                    value: [],
                  },
                },
                _toggleShowHelp() {
                  this.showHelp = !this.showHelp;
                },
                _isBool(t) {
                  return t === EntryType.Bool;
                },
                _isString(t) {
                  return t === EntryType.String || t === EntryType.FilePath || t == EntryType.Path || t == EntryType.Uninitialized;
                },
                _isHidden() {
                  return (
                    this.type === EntryType.Internal
                    || this.type === EntryType.Static
                    || (this.advanced && !this.showAdvanced)
                  );
                },
                get typeString() {
                  return {
                    [EntryType.Bool]: 'BOOL',
                    [EntryType.FilePath]: 'FILEPATH',
                    [EntryType.Internal]: 'INTERNAL',
                    [EntryType.Path]: 'PATH',
                    [EntryType.Static]: 'STATIC',
                    [EntryType.String]: 'STRING',
                    [EntryType.Uninitialized]: 'UNINITIALIZED',
                  }[this.type];
                },
                attached() {
                  this.reinit();
                },
                reinit() {
                  this.initing = true;
                  this.showHelp = false;
                  if (this.type === EntryType.Bool) {
                    this.checked = this.value !== false;
                  } else if (this._isString(this.type)) {
                    this.arrayItems = [];
                    setTimeout(() => {
                      this.arrayItems = this.value.split(';');
                    }, 1);
                  }
                  this.modified = false;
                  this.initing = false;
                },
                getEnteredValue() {
                  return this.$.textInput.value;
                },
                _modifiedArrayItemValue() {
                  this.modified = true;
                  // Reconstitute the array items into a string
                  console.log('Rebuilding array');
                  const value = Array.from(this.querySelectorAll('.array-item'))
                    .map(el => el.value)
                    .filter(s => !!s.length)
                    .join(';');
                  console.log('Array content: ', value);
                  this.fire('modified', {
                    key: this.key,
                    value: value,
                    type: 'STRING',
                  });
                },
                _checkedChanged() {
                  if (!this.initing) {
                    this.fire('modified', {
                      key: this.key,
                      value: this.checked ? 'TRUE' : 'FALSE',
                      type: 'BOOL',
                    });
                  }
                }
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
                button {
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
                  this._modifications[det.key + ':' + det.type] = det.value;
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
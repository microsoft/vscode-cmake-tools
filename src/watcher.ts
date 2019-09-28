import * as vscode from 'vscode';
import * as fs from 'fs';

class ExternalFileWatcher implements vscode.FileSystemWatcher {
  constructor(path: string, ignoreCreateEvents?: boolean, ignoreChangeEvents?: boolean, ignoreDeleteEvents?: boolean) {
    this._watcher = fs.watch(path, this._eventHandler);
    if (ignoreCreateEvents) { this.ignoreCreateEvents = true; }
    if (ignoreDeleteEvents) { this.ignoreDeleteEvents = true; }
    if (ignoreChangeEvents) { this.ignoreChangeEvents = true; }
  }

  private readonly _watcher: fs.FSWatcher;

  ignoreCreateEvents: boolean = false;
  ignoreDeleteEvents: boolean = false;
  ignoreChangeEvents: boolean = false;

  private readonly _createEvent = new vscode.EventEmitter<vscode.Uri>();
  private readonly _deleteEvent = new vscode.EventEmitter<vscode.Uri>();
  private readonly _changeEvent = new vscode.EventEmitter<vscode.Uri>();

  private readonly _eventHandler = (event: string, filename: string) => {
    if (event === 'change') {
      if (!this.ignoreChangeEvents) { this._changeEvent.fire(vscode.Uri.parse(filename)); }
    }
    else {
      fs.access(filename, fs.constants.F_OK, error => {
        if (!error) {
          if (!this.ignoreCreateEvents) { this._changeEvent.fire(vscode.Uri.parse(filename)); }
        }
        else {
          if (!this.ignoreDeleteEvents) { this._deleteEvent.fire(vscode.Uri.parse(filename)); }
        }
      });
    }
  }

    onDidChange: vscode.Event < vscode.Uri > = this._changeEvent.event;
    onDidDelete: vscode.Event < vscode.Uri > = this._deleteEvent.event;
    onDidCreate: vscode.Event < vscode.Uri > = this._createEvent.event;

    dispose() {
      this._watcher.close();
      this._changeEvent.dispose();
      this._deleteEvent.dispose();
      this._createEvent.dispose();
    }
  }

class EventDispatcher implements vscode.Disposable {
  changeEvent = new vscode.EventEmitter<vscode.Uri>();
  deleteEvent = new vscode.EventEmitter<vscode.Uri>();
  createEvent = new vscode.EventEmitter<vscode.Uri>();
  disposeIndividualWatcherEvent = new vscode.EventEmitter<IndividualWatcher>();

  dispose() {
    this.createEvent.dispose();
    this.deleteEvent.dispose();
    this.changeEvent.dispose();
    this.disposeIndividualWatcherEvent.dispose();
  }
}

export class IndividualWatcher implements vscode.Disposable {
  private readonly _watcher: vscode.FileSystemWatcher;
  private readonly _changeSub = this._watcher.onDidChange(e => this._disp.changeEvent.fire(e));
  private readonly _delSub = this._watcher.onDidDelete(e => this._disp.deleteEvent.fire(e));
  private readonly _createSub = this._watcher.onDidCreate(e => this._disp.createEvent.fire(e));
  private readonly _inWorkSpace = true;

  constructor(private readonly _disp: EventDispatcher, private readonly _pattern: string, inWorkSpace?: boolean) {
    if (inWorkSpace) {
      this._inWorkSpace = true;
    }

    if (this._inWorkSpace) {
      this._watcher = vscode.workspace.createFileSystemWatcher(this._pattern);
    }
    else {
      this._watcher = new ExternalFileWatcher(this._pattern);
    }
  }

  dispose() {
    this._changeSub.dispose();
    this._delSub.dispose();
    this._createSub.dispose();
    this._watcher.dispose();
    this._disp.disposeIndividualWatcherEvent.fire(this);
  }
}

export class MultiWatcher implements vscode.Disposable {
  private readonly _watchers = new Set<IndividualWatcher>();
  private readonly _dispatcher = new EventDispatcher();
  private readonly _anyEventEmitter = new vscode.EventEmitter<vscode.Uri>();

  private readonly _unregisterSub
    = this._dispatcher.disposeIndividualWatcherEvent.event(indiv => { this._watchers.delete(indiv); });

  private readonly _createSub = this.onCreate(e => this._anyEventEmitter.fire(e));
  private readonly _delSub = this.onDelete(e => this._anyEventEmitter.fire(e));
  private readonly _changeSub = this.onChange(e => this._anyEventEmitter.fire(e));

  constructor(...patterns: string[]) {
    for (const pattern of patterns) {
      this.createWatcher(pattern);
    }
  }

  dispose() {
    this._changeSub.dispose();
    this._delSub.dispose();
    this._createSub.dispose();
    // We copy the watchers into an array so we can modify the set
    for (const indiv of Array.from(this._watchers)) {
      indiv.dispose();
    }
    console.assert(this._watchers.size == 0, 'Expected disposal of individual filesystem watchers');
    this._unregisterSub.dispose();
    this._anyEventEmitter.dispose();
    this._dispatcher.dispose();
  }

  get onChange() { return this._dispatcher.changeEvent.event; }
  get onDelete() { return this._dispatcher.deleteEvent.event; }
  get onCreate() { return this._dispatcher.createEvent.event; }
  get onAnyEvent() { return this._anyEventEmitter.event; }

  createWatcher(pattern: string): vscode.Disposable {
    const indiv = new IndividualWatcher(this._dispatcher, pattern);
    this._watchers.add(indiv);
    return indiv;
  }
}
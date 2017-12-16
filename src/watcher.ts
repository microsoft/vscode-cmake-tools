import * as vscode from 'vscode';

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
  private _watcher = vscode.workspace.createFileSystemWatcher(this._pattern);
  private _changeSub = this._watcher.onDidChange(e => this._disp.changeEvent.fire(e));
  private _delSub = this._watcher.onDidDelete(e => this._disp.deleteEvent.fire(e));
  private _createSub = this._watcher.onDidCreate(e => this._disp.createEvent.fire(e));

  constructor(private _disp: EventDispatcher, private _pattern: string) {}

  dispose() {
    this._changeSub.dispose();
    this._delSub.dispose();
    this._createSub.dispose();
    this._watcher.dispose();
    this._disp.disposeIndividualWatcherEvent.fire(this);
  }
}

export class MultiWatcher implements vscode.Disposable {
  private _watchers = new Set<IndividualWatcher>();
  private _dispatcher = new EventDispatcher();
  private _anyEventEmitter = new vscode.EventEmitter<vscode.Uri>();

  private _unregisterSub = this._dispatcher.disposeIndividualWatcherEvent.event(
      indiv => { this._watchers.delete(indiv); });

  private _createSub = this.onCreate(e => this._anyEventEmitter.fire(e));
  private _delSub = this.onCreate(e => this._anyEventEmitter.fire(e));
  private _changeSub = this.onChange(e => this._anyEventEmitter.fire(e));

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
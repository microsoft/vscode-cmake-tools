import * as vscode from 'vscode';
import * as fs from 'fs';

class EventDispatcher implements vscode.Disposable {
  changeEvent = new vscode.EventEmitter<string>();
  renameEvent = new vscode.EventEmitter<string>();
  disposeIndividualWatcherEvent = new vscode.EventEmitter<IndividualWatcher>();

  dispose() {
    this.renameEvent.dispose();
    this.changeEvent.dispose();
    this.disposeIndividualWatcherEvent.dispose();
  }
}

// ONLY SUPPORTS FILE because of limitations of fs
export class IndividualWatcher implements vscode.Disposable {
  private readonly _watcher: fs.FSWatcher | undefined;

  constructor(private readonly _disp: EventDispatcher, private readonly _filePath: string) {
    if (fs.existsSync(_filePath)) {
      // There's a 'filename' parameter in the listener but it's not always supported, so ignore it.
      this._watcher = fs.watch(_filePath, (event) => {
        if (event === 'change') {
          this._disp.changeEvent.fire(_filePath);
        } else if (event === 'rename') {
          this._disp.renameEvent.fire(_filePath);
        }
      });
    } else {
      fs.watchFile(_filePath, (curr, prev) => {
      });
    }
  }

  dispose() {
    if (this._watcher) {
      this._watcher.close();
    } else {
      fs.unwatchFile(this._filePath);
    }
    this._disp.disposeIndividualWatcherEvent.fire(this);
  }
}

// ONLY SUPPORTS FILES because of limitations of fs
export class MultiWatcher implements vscode.Disposable {
  private readonly _watchers = new Set<IndividualWatcher>();
  private readonly _dispatcher = new EventDispatcher();
  private readonly _anyEventEmitter = new vscode.EventEmitter<string>();

  private readonly _unregisterSub
      = this._dispatcher.disposeIndividualWatcherEvent.event(indiv => { this._watchers.delete(indiv); });

  private readonly _renameSub = this.onRename(e => this._anyEventEmitter.fire(e));
  private readonly _changeSub = this.onChange(e => this._anyEventEmitter.fire(e));

  constructor(...patterns: string[]) {
    for (const pattern of patterns) {
      this.createWatcher(pattern);
    }
  }

  dispose() {
    this._changeSub.dispose();
    this._renameSub.dispose();
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
  get onRename() { return this._dispatcher.renameEvent.event; }
  get onAnyEvent() { return this._anyEventEmitter.event; }

  createWatcher(pattern: string): vscode.Disposable {
    const indiv = new IndividualWatcher(this._dispatcher, pattern);
    this._watchers.add(indiv);
    return indiv;
  }
}
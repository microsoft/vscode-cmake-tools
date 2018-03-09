import * as vscode from 'vscode';

export class TestMemento implements vscode.Memento {

    public get<T>(key: string): T|undefined;
    public get<T>(key: string, defaultValue: T): T;
    public get(key: any, defaultValue?: any) {
      if (this.ContainsKey(key)) {
        return this.storage[key];
      } else {
        return defaultValue;
      }
    }
    public update(key: string, value: any): Thenable<void> { return this.storage[key] = value; }
    private readonly storage: {[key: string]: any} = {};

    public ContainsKey(key: string): boolean { return this.storage.hasOwnProperty(key); }
  }
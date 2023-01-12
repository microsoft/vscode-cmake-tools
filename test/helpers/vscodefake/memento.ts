import * as vscode from 'vscode';

export class TestMemento implements vscode.Memento {
    private readonly storage = new Map<string, any>();

    public get<T>(key: string): T | undefined;
    public get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this.storage.get(key) as T | undefined;
        if (value === undefined) {
            return defaultValue;
        }
        return value;
    }
    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }
    public update(key: string, value: any): Thenable<void> {
        this.storage.set(key, value);
        return Promise.resolve();
    }
    public containsKey(key: string): boolean {
        return this.storage.hasOwnProperty(key);
    }
    public clear() {
        this.storage.clear();
    }
}

export class StateMemento implements vscode.Memento {
    private storage: { [key: string]: any } = {};

    public get<T>(key: string): T | undefined;
    public get<T>(key: string, defaultValue: T): T;
    public get(key: any, defaultValue?: any) {
        if (this.containsKey(key)) {
            return this.storage[key];
        } else {
            return defaultValue;
        }
    }
    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }
    public update(key: string, value: any): Thenable<void> {
        return this.storage[key] = value;
    }
    public containsKey(key: string): boolean {
        return this.storage.hasOwnProperty(key);
    }
    public setKeysForSync(_keys: string[]): void {}
    public clear() {
        this.storage = {};
    }
}

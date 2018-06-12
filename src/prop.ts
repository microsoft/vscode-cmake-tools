/**
 * Module for a watchable property class
 */ /** */

import * as vscode from 'vscode';

export class Property<T> {
  constructor(private _value: T) {}

  private readonly _emitter = new vscode.EventEmitter<T>();

  get changeEvent() { return this._emitter.event; }

  get value() { return this._value; }
  set(v: T) {
    this._value = v;
    this._emitter.fire(this._value);
  }

  dispose() { this._emitter.dispose(); }
}
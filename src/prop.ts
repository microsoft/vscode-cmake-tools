/**
 * Module for a watchable property class
 */ /** */

import * as vscode from 'vscode';

enum FirePolicy {
    FireNow,
    FireLate,
}

export const FireNow = FirePolicy.FireNow;
export const FireLate = FirePolicy.FireLate;

type SubscriptionCallback<T> = (value: T) => void;
type SubscriberFunction<T> = (fire: FirePolicy, cb: SubscriptionCallback<T>) => vscode.Disposable;

export class Property<T> {
    constructor(private _value: T) {}

    private readonly _emitter = new vscode.EventEmitter<T>();

    get changeEvent(): SubscriberFunction<T> {
        return (policy, cb) => {
            const event = this._emitter.event;
            const ret = event(cb);
            switch (policy) {
                case FireNow:
                    cb(this._value);
                    break;
                case FireLate:
                    break;
            }
            return ret;
        };
    }

    get value() {
        return this._value;
    }
    set(v: T) {
        this._value = v;
        this._emitter.fire(this._value);
    }

    dispose() {
        this._emitter.dispose();
    }
}

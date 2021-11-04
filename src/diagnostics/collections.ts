/**
 * Memoizes the creation of diagnostic collections
 */ /** */

import * as vscode from 'vscode';

/**
 * A lazily constructed diagnostic collection object
 */
class LazyCollection implements vscode.Disposable {
    private _collection?: vscode.DiagnosticCollection;
    constructor(readonly name: string) {}

    /**
     * Get the collection
     */
    getOrCreate(): vscode.DiagnosticCollection {
        if (!this._collection) {
            this._collection = vscode.languages.createDiagnosticCollection(this.name);
        }
        return this._collection;
    }

    /**
     * Dispose of the collection
     */
    dispose() {
        if (this._collection) {
            this._collection.dispose();
        }
        this._collection = undefined;
    }
}

/**
 * Class stores the diagnostic collections used by CMakeTools
 */
class Collections {
    private readonly _cmake = new LazyCollection('cmake-configure-diags');
    private readonly _build = new LazyCollection('cmake-build-diags');

    /**
     * The `DiagnosticCollection` for the CMake configure diagnostics.
     */
    get cmake(): vscode.DiagnosticCollection {
        return this._cmake.getOrCreate();
    }

    /**
     * The `DiagnosticCollection` for build diagnostics
     */
    get build(): vscode.DiagnosticCollection {
        return this._build.getOrCreate();
    }

    reset() {
        this._cmake.dispose();
        this._build.dispose();
    }
}

export const collections = new Collections();
export default collections;

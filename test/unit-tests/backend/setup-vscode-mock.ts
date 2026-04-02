/**
 * Mocha setup hook that registers a mock 'vscode' module for backend tests
 * that need to import modules depending on vscode.
 *
 * Usage: mocha --require test/unit-tests/backend/setup-vscode-mock.ts
 */
import * as Module from 'module';
import { Position, Range, Uri } from './vscode-mock';

const originalResolveFilename = (Module as any)._resolveFilename;

(Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
    if (request === 'vscode') {
        return 'vscode';
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

const noop = () => {};
const noopObj: any = new Proxy({}, { get: () => noop });

const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
    if (request === 'vscode') {
        return {
            Position,
            Range,
            Uri,
            workspace: {
                getConfiguration: () => new Proxy({}, {
                    get: (_target: any, prop: string) => {
                        if (prop === 'get') {
                            return () => undefined;
                        }
                        return undefined;
                    }
                }),
                onDidChangeConfiguration: noop,
                onDidCreateFiles: noop,
                onDidDeleteFiles: noop,
                registerTextDocumentContentProvider: () => ({ dispose: noop })
            },
            window: {
                createOutputChannel: () => noopObj,
                showErrorMessage: noop,
                showWarningMessage: noop,
                showInformationMessage: noop,
                showQuickPick: noop,
                createTreeView: () => noopObj
            },
            languages: {
                match: () => 0
            },
            commands: {
                registerCommand: () => ({ dispose: noop }),
                executeCommand: noop
            },
            EventEmitter: class {
                event = () => {};
                fire() {}
                dispose() {}
            },
            Disposable: class {
                static from(..._d: any[]) {
                    return { dispose: noop };
                }
                dispose() {}
            },
            TreeItem: class {},
            TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
            ThemeIcon: class {
                constructor(public id: string) {}
            },
            extensions: { getExtension: () => undefined }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};


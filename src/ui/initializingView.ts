import * as vscode from 'vscode';

/**
 * A static, inert tree data provider for the transient `cmake.initializing`
 * placeholder view.
 *
 * It intentionally has no children — the visible content is supplied by the view's
 * `viewsWelcome` contribution in `package.json`. Its only purpose is to back the
 * `cmake.initializing` view so the CMake activity-bar container can appear
 * immediately during activation (via the `cmake:isInitializing` context key),
 * before the real project views are ready. The real views, commands, and status
 * bar remain gated on `cmake:enableFullFeatureSet`.
 */
export class InitializingViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {
        return [];
    }
}

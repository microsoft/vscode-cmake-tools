import * as vscode from "vscode";
import * as logging from "@cmt/logging";
import { TargetNode, BaseNode } from "@cmt/ui/projectOutline/projectOutline";

const log = logging.createLogger("bookmarks");

export interface BookmarkedTarget {
    id: string;
    name: string;
    projectName: string;
    folderPath: string;
    type: string;
    // Not persisted; reattached after reload
    targetNode?: TargetNode;
}

export class BookmarkNode extends BaseNode {
    constructor(public readonly bookmark: BookmarkedTarget, id: string) {
        super(id);
    }

    getChildren(): BaseNode[] {
        // Return the children from the original target node if it exists
        if (this.bookmark.targetNode) {
            return this.bookmark.targetNode.getChildren();
        }
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(
            `${this.bookmark.name} (${this.bookmark.projectName})`
        );

        // Set collapsible state based on whether there are children
        if (this.getChildren().length > 0) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        } else {
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        }

        item.tooltip = `${this.bookmark.name}\nProject: ${this.bookmark.projectName}\nType: ${this.bookmark.type}\nFolder: ${this.bookmark.folderPath}`;
        item.contextValue = `nodeType=bookmark;type=${this.bookmark.type}`;
        item.iconPath = new vscode.ThemeIcon("bookmark");
        return item;
    }

    getOrderTuple(): string[] {
        return [this.bookmark.name, this.bookmark.projectName];
    }
}
export class BookmarksProvider implements vscode.TreeDataProvider<BaseNode> {
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<BaseNode | null>();
    get onDidChangeTreeData() {
        return this._onDidChangeTreeData.event;
    }

    private bookmarks = new Map<string, BookmarkedTarget>();
    private resolveTargetById?: (id: string) => TargetNode | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.loadBookmarks();
    }

    private loadBookmarks() {
        const saved = this.context.workspaceState.get<{
            id: string;
            name: string;
            projectName: string;
            folderPath: string;
            type: string;
        }[]>("cmake.bookmarks", []);
        this.bookmarks.clear();
        for (const bookmark of saved) {
            this.bookmarks.set(bookmark.id, { ...bookmark });
        }
        log.info(`Loaded ${this.bookmarks.size} bookmarks`);
    }

    private async saveBookmarks() {
        // Persist only serializable fields
        const bookmarksArray = Array.from(this.bookmarks.values()).map((b) => ({
            id: b.id,
            name: b.name,
            projectName: b.projectName,
            folderPath: b.folderPath,
            type: b.type
        }));
        await this.context.workspaceState.update(
            "cmake.bookmarks",
            bookmarksArray
        );
        log.info(`Saved ${bookmarksArray.length} bookmarks`);
    }

    getTreeItem(element: BaseNode): vscode.TreeItem {
        return element.getTreeItem();
    }

    getChildren(element?: BaseNode): BaseNode[] {
        if (!element) {
            // Return root level bookmarks
            return Array.from(this.bookmarks.values()).map(
                (bookmark) => new BookmarkNode(bookmark, bookmark.id)
            );
        }

        // For any node (bookmark or its children), return its children
        return element.getChildren();
    }

    /** Provide a resolver to map TargetNode id -> TargetNode. Call this whenever the outline updates. */
    public setTargetResolver(resolver: (id: string) => TargetNode | undefined) {
        this.resolveTargetById = resolver;
        void this.reattachTargets();
    }

    /** Try to reattach saved bookmarks to live TargetNodes using the resolver. */
    public async reattachTargets() {
        if (!this.resolveTargetById) {
            return;
        }
        let changed = false;
        for (const [id, bm] of this.bookmarks) {
            const resolved = this.resolveTargetById(id);
            if (resolved && bm.targetNode !== resolved) {
                bm.targetNode = resolved;
                changed = true;
            }
        }
        if (changed) {
            this._onDidChangeTreeData.fire(null);
        }
    }

    async addBookmark(targetNode: TargetNode) {
        const bookmark: BookmarkedTarget = {
            id: targetNode.id,
            name: targetNode.name,
            projectName: targetNode.projectName,
            folderPath: targetNode.folder.uri.fsPath,
            type: (targetNode as any)._type || "UNKNOWN",
            targetNode: targetNode
        };

        this.bookmarks.set(bookmark.id, bookmark);
        await this.saveBookmarks();
        this._onDidChangeTreeData.fire(null);
        log.info(`Added bookmark: ${bookmark.name}`);
    }

    async removeBookmark(targetId: string) {
        if (this.bookmarks.has(targetId)) {
            const bookmark = this.bookmarks.get(targetId);
            this.bookmarks.delete(targetId);
            await this.saveBookmarks();
            this._onDidChangeTreeData.fire(null);
            log.info(`Removed bookmark: ${bookmark?.name}`);
            return true;
        }
        return false;
    }
    isBookmarked(targetId: string): boolean {
        return this.bookmarks.has(targetId);
    }

    async toggleBookmark(targetNode: TargetNode): Promise<boolean> {
        if (this.isBookmarked(targetNode.id)) {
            await this.removeBookmark(targetNode.id);
            return false; // Removed
        } else {
            await this.addBookmark(targetNode);
            return true; // Added
        }
    }

    async clearAllBookmarks() {
        const count = this.bookmarks.size;
        this.bookmarks.clear();
        await this.saveBookmarks();
        this._onDidChangeTreeData.fire(null);
        log.info(`Cleared ${count} bookmarks`);
    }

    getBookmark(targetId: string): BookmarkedTarget | undefined {
        return this.bookmarks.get(targetId);
    }

    getAllBookmarks(): BookmarkedTarget[] {
        return Array.from(this.bookmarks.values());
    }
}

import * as vscode from "vscode";
import * as logging from "@cmt/logging";
import { TargetNode, BaseNode, DirectoryNode, SourceFileNode } from "@cmt/ui/projectOutline/projectOutline";

const log = logging.createLogger("bookmarks");

export interface BookmarkedItem {
    id: string;
    name: string;
    projectName: string;
    folderName: string; // Store folder name instead of path for display
    type: string;
    sourceNode?: BaseNode; // Store original node reference (not persisted)
}

export class BookmarkNode extends BaseNode {
    constructor(public readonly bookmark: BookmarkedItem, id: string) {
        super(id);
    }

    getChildren(): BaseNode[] {
        // Return the children from the original node if it exists
        if (this.bookmark.sourceNode) {
            return this.bookmark.sourceNode.getChildren();
        }
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(
            `${this.bookmark.name} (${this.bookmark.projectName || this.bookmark.folderName})`
        );

        // Set collapsible state based on whether there are children
        if (this.getChildren().length > 0) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        } else {
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        }

        item.tooltip = `${this.bookmark.name}\nProject: ${this.bookmark.projectName || "N/A"}\nType: ${this.bookmark.type}\nFolder: ${this.bookmark.folderName}`;
        item.contextValue = `nodeType=bookmark;type=${this.bookmark.type}`;
        item.iconPath = new vscode.ThemeIcon("bookmark");
        return item;
    }

    getOrderTuple(): string[] {
        return [this.bookmark.name, this.bookmark.projectName || this.bookmark.folderName];
    }
}

export class BookmarksProvider implements vscode.TreeDataProvider<BaseNode> {
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<BaseNode | null>();
    get onDidChangeTreeData() {
        return this._onDidChangeTreeData.event;
    }

    private bookmarks = new Map<string, BookmarkedItem>();
    private resolveTargetById?: (id: string) => TargetNode | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.loadBookmarks();
    }

    private loadBookmarks() {
        const saved = this.context.workspaceState.get<{
            id: string;
            name: string;
            projectName: string;
            folderName: string;
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
            folderName: b.folderName,
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
            return Array.from(this.bookmarks.values())
                .map((bookmark) => new BookmarkNode(bookmark, bookmark.id))
                .sort((a, b) => a.bookmark.name.localeCompare(b.bookmark.name));
        }

        // For any node (bookmark or its children), return its children
        return element.getChildren();
    }

    /** Provide a resolver to map TargetNode id -> TargetNode. Call this whenever the outline updates. */
    public setTargetResolver(resolver: (id: string) => TargetNode | undefined) {
        this.resolveTargetById = resolver;
        void this.reattachTargets();
    }

    /** Try to reattach saved bookmarks to live nodes using the resolver. */
    public async reattachTargets() {
        if (!this.resolveTargetById) {
            return;
        }
        let changed = false;
        for (const [id, bm] of this.bookmarks) {
            if (bm.type === 'TARGET') {
                const resolved = this.resolveTargetById(id);
                if (resolved && bm.sourceNode !== resolved) {
                    bm.sourceNode = resolved;
                    changed = true;
                }
            }
        }
        if (changed) {
            this._onDidChangeTreeData.fire(null);
        }
    }

    async toggleBookmark(node: BaseNode): Promise<boolean> {
        if (!node) {
            return false;
        }

        let bookmark: BookmarkedItem;

        if (node instanceof TargetNode) {
            bookmark = {
                id: node.id,
                name: node.name,
                projectName: node.projectName,
                folderName: node.folder.name,
                type: 'TARGET',
                sourceNode: node
            };
        } else if (node instanceof SourceFileNode) {
            bookmark = {
                id: node.id,
                name: node.name,
                projectName: '',
                folderName: node.folder.name,
                type: 'FILE',
                sourceNode: node
            };
        } else if (node instanceof DirectoryNode) {
            // DirectoryNode doesn't have folder property directly
            // Extract folder name from workspace context or use pathPart
            bookmark = {
                id: node.id,
                name: node.pathPart,
                projectName: '',
                folderName: this.getFolderNameFromPath(node.pathPart),
                type: 'DIRECTORY',
                sourceNode: node
            };
        } else {
            return false;
        }

        if (this.isBookmarked(bookmark.id)) {
            await this.removeBookmark(bookmark.id);
            return false;
        } else {
            this.bookmarks.set(bookmark.id, bookmark);
            await this.saveBookmarks();
            this._onDidChangeTreeData.fire(null);
            return true;
        }
    }

    private getFolderNameFromPath(path: string): string {
        // Extract a folder name from a path
        const parts = path.split('/');
        return parts[parts.length - 1] || path;
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

    async clearAllBookmarks() {
        const count = this.bookmarks.size;
        this.bookmarks.clear();
        await this.saveBookmarks();
        this._onDidChangeTreeData.fire(null);
        log.info(`Cleared ${count} bookmarks`);
    }

    getBookmark(targetId: string): BookmarkedItem | undefined {
        return this.bookmarks.get(targetId);
    }

    getAllBookmarks(): BookmarkedItem[] {
        return Array.from(this.bookmarks.values());
    }
}

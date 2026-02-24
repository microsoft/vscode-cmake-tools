import CMakeProject from "@cmt/cmakeProject";
import * as codeModel from '@cmt/drivers/codeModel';
import * as vscode from 'vscode';
import { isFileInsideFolder, lightNormalizePath, platformNormalizePath, platformNormalizeUri, platformPathEquivalent, quickPick, splitPath } from "@cmt/util";
import path = require("path");
import rollbar from "@cmt/rollbar";
import * as minimatch from 'minimatch';
import { CMakeCache } from "@cmt/cache";
import { CMakeAST, CMakeParser, CommandInvocationAST, Token } from "@cmt/cmakeParser";
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const LIST_KEYWORDS = ['APPEND', 'PREPEND', 'INSERT'];

// Debounce interval for batching file events (in ms)
const FILE_EVENT_DEBOUNCE_MS = 300;

/**
 * Represents a single edit candidate with all necessary information for UI and application
 */
export interface CandidateEdit {
    /** The document URI to edit */
    uri: vscode.Uri;
    /** The range to modify (for deletions) or position to insert at */
    range: vscode.Range;
    /** The new text to insert (empty string for deletions) */
    newText: string;
    /** Short label for QuickPick display */
    label: string;
    /** Description for QuickPick */
    description: string;
    /** Detail text for QuickPick */
    detail: string;
    /** Sort priority (lower = better) */
    sortKeys: (number | string)[];
    /** Single-line preview of the change */
    previewSnippet: string;
    /** The source list this edit belongs to */
    sourceList?: SourceList;
    /** The target this edit relates to */
    target?: codeModel.CodeModelTarget;
    /** Whether this is a deletion or insertion */
    isDeletion: boolean;
    /** The source file being added/removed */
    sourceUri: vscode.Uri;
}

/**
 * Result of candidate collection
 */
interface AddCandidatesResult {
    candidates: CandidateEdit[];
    sourceList?: SourceList;
    /** Whether candidates are variable source lists (vs target source lists) */
    isVariableCandidate?: boolean;
    error?: string;
    info?: string;
}

/**
 * Structured error with optional file URI for "Open File" action
 */
interface EditError {
    message: string;
    fileUri?: vscode.Uri;
}

interface RemoveCandidatesResult {
    candidates: CandidateEdit[];
    errors: EditError[];
}

/**
 * Virtual document provider for showing diff previews
 */
class CMakeEditPreviewProvider implements vscode.TextDocumentContentProvider {
    private static instance: CMakeEditPreviewProvider;
    private pendingEdits = new Map<string, CandidateEdit[]>();
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

    public static readonly scheme = 'cmake-edit-preview';

    public readonly onDidChange = this.onDidChangeEmitter.event;

    public static getInstance(): CMakeEditPreviewProvider {
        if (!this.instance) {
            this.instance = new CMakeEditPreviewProvider();
        }
        return this.instance;
    }

    public setEdits(originalUri: vscode.Uri, edits: CandidateEdit[]): vscode.Uri {
        const key = originalUri.toString();
        this.pendingEdits.set(key, edits);
        const previewUri = vscode.Uri.parse(`${CMakeEditPreviewProvider.scheme}:${originalUri.path}?${encodeURIComponent(key)}`);
        this.onDidChangeEmitter.fire(previewUri);
        return previewUri;
    }

    public clearEdits(originalUri: vscode.Uri): void {
        this.pendingEdits.delete(originalUri.toString());
    }

    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const key = decodeURIComponent(uri.query);
        const edits = this.pendingEdits.get(key);
        if (!edits?.length) {
            return '';
        }

        // Get the original document
        const originalUri = vscode.Uri.parse(key);
        const originalDoc = await vscode.workspace.openTextDocument(originalUri);
        let content = originalDoc.getText();

        // Apply edits in reverse order (from end to start) to maintain offsets
        const sortedEdits = [...edits].sort((a, b) =>
            b.range.start.compareTo(a.range.start));

        for (const edit of sortedEdits) {
            const startOffset = originalDoc.offsetAt(edit.range.start);
            const endOffset = originalDoc.offsetAt(edit.range.end);
            content = content.slice(0, startOffset) + edit.newText + content.slice(endOffset);
        }

        return content;
    }
}

/**
 * The order of identifiers in the following identifier lists affect sort order
 * in QuickPicks. Lower indices get sorted earlier.
 */
const SOURCE_SCOPES = ['PRIVATE', 'INTERFACE', 'PUBLIC'];
const HEADER_SCOPES = ['PUBLIC', 'PRIVATE', 'INTERFACE'];

/* Language extensions from CMake latest docs: https://cmake.org/cmake/help/latest/prop_sf/LANGUAGE.html */
const LANGUAGE_EXTENSIONS: {[name: string]: {source: string[]; cxxModule?: string[]; header?: string[]}} = {
    'ASM': {
        source: [
            's', 'S', 'asm', 'abs', 'msa', 'nas', 's43', 's51', 's85', 's90',
            // ASM_NASM
            'nasm'
        ]
    },
    'C': {
        source: [ 'c', 'm' ],
        header: [ 'h', 'H' ]
    },
    'CXX': {
        source: [
            'C', 'c++', 'cc', 'cpp', 'cxx', 'CPP', 'M', 'm', 'mm', 'mpp'
        ],
        cxxModule: [
            'ixx', 'cppm', 'ccm', 'cxxm', 'c++m'
        ],
        header: ['inl', 'h', 'hpp', 'HPP', 'H']
    },
    'OBJC': {
        source: ['m'],
        header: ['h', 'H']
    },
    'OBJCXX': {
        source: ['M', 'm', 'mm'],
        header: ['inl', 'h', 'hpp', 'HPP', 'H']
    },
    'Fortran': {
        source: [
            'f', 'F', 'fpp', 'FPP', 'f77', 'F77', 'f90', 'F90',
            'for', 'For', 'FOR', 'f95', 'F95', 'f03', 'F03', 'f08', 'F08',
            'cuf', 'CUF'
        ],
        header: ['h', 'H']
    },
    'CUDA': { source: ['cu'] },
    'Java': { source: ['java'] },
    'CSharp': {
        source: ['cs'],
        header: ['inl', 'h', 'hpp', 'HPP', 'H']
    },
    'Swift': { source: ['swift'] },
    'SWIG': { source: ['.i', '.swg'] },
    'HIP': { source: ['hip'] },
    'ISPC': { source: ['ispc'] },
    'RC': { source: ['rc', 'RC'] }
};

export class CMakeListsModifier implements vscode.Disposable {
    private project?: CMakeProject;
    private documentSelector: vscode.DocumentFilter[] = [];
    private codeModelDisposables: vscode.Disposable[] = [];
    private previewProvider: CMakeEditPreviewProvider;
    private previewProviderRegistration?: vscode.Disposable;

    // Known source file extensions for path-based filtering (used for deleted files)
    private knownExtensions = new Set<string>();

    // Debounce state for batching file events
    private pendingAddFiles: vscode.Uri[] = [];
    private pendingDeleteFiles: vscode.Uri[] = [];
    private addDebounceTimer?: NodeJS.Timeout;
    private deleteDebounceTimer?: NodeJS.Timeout;

    constructor() {
        this.previewProvider = CMakeEditPreviewProvider.getInstance();
    }

    updateCodeModel(project: CMakeProject, cache: CMakeCache) {
        this.project = project;
        const model = project.codeModelContent;
        const languages = new Set<string>();
        if (model) {
            addAll(languages, ...modelLanguages(model));
        } else {
            // TODO: There's no support for editing list files without a code
            // model yet, so these fallbacks aren't really accomplishing
            // anything.
            const cacheLanguages = cacheCompilerLanguages(cache);
            addAll(languages, ...cacheLanguages);
            if (!cacheLanguages.length) {
                addAll(languages, 'C', 'CXX');
            }
        }
        const extensions = new Set<string>();
        // Add hard-coded extensions
        for (const lang of languages) {
            const langExtensionGroups = LANGUAGE_EXTENSIONS[lang];
            if (langExtensionGroups) {
                addAll(extensions, ...Object.values(langExtensionGroups).flat(1));
            }
        }
        // Add in any extensions explicitly mentioned by the toolchain.
        // Toolchains don't include header file extensions, so this can only
        // ever supplement hard-coded extensions.
        model?.toolchains?.forEach(toolchain => {
            const cmToolchain = toolchain ? toolchain as codeModel.CodeModelToolchain : toolchain;
            addAll(extensions, ...cmToolchain.sourceFileExtensions || []);
        });

        this.codeModelDispose();
        const extensionGlobs = Array.from(extensions).map(ext => `**/*.${ext}`);
        this.documentSelector = extensionGlobs.map(glob => ({ scheme: 'file', pattern: glob }));
        this.knownExtensions = extensions;

        // Register the preview provider if not already registered
        if (!this.previewProviderRegistration) {
            this.previewProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(
                CMakeEditPreviewProvider.scheme,
                this.previewProvider
            );
        }

        vscode.workspace.onDidCreateFiles(this.filesCreated, this, this.codeModelDisposables);
        vscode.workspace.onDidDeleteFiles(this.filesDeleted, this, this.codeModelDisposables);
    }

    private filesCreated(e: vscode.FileCreateEvent) {
        rollbar.invokeAsync(localize('add.newly.created.files', 'Add newly created files to CMakeLists.txt'), async () => {
            for (const uri of e.files) {
                if (await this.isSourceFile(uri)) {
                    this.pendingAddFiles.push(uri);
                }
            }

            // Debounce: wait for more files before processing
            if (this.addDebounceTimer) {
                clearTimeout(this.addDebounceTimer);
            }
            this.addDebounceTimer = setTimeout(() => {
                this.processPendingAddFiles().catch(err => rollbar.exception(localize('error.processing.add.files', 'Error processing added files'), err as Error));
            }, FILE_EVENT_DEBOUNCE_MS);
        });
    }

    private async processPendingAddFiles() {
        const files = [...this.pendingAddFiles];
        this.pendingAddFiles = [];

        if (files.length === 0) {
            return;
        }

        if (files.length === 1) {
            await this.addSourceFileToCMakeLists(files[0], this.project, false);
        } else {
            // Batch processing for multiple files
            await this.addMultipleSourceFilesToCMakeLists(files, this.project);
        }
    }

    private filesDeleted(e: vscode.FileDeleteEvent) {
        rollbar.invokeAsync(localize('remove.deleted.file', 'Remove a deleted file from CMakeLists.txt'), async () => {
            for (const uri of e.files) {
                // Filter by extension since we can't open deleted files
                const ext = path.extname(uri.fsPath).slice(1);
                if (ext && this.knownExtensions.has(ext)) {
                    this.pendingDeleteFiles.push(uri);
                }
            }

            // Debounce: wait for more files before processing
            if (this.deleteDebounceTimer) {
                clearTimeout(this.deleteDebounceTimer);
            }
            this.deleteDebounceTimer = setTimeout(() => {
                this.processPendingDeleteFiles().catch(err => rollbar.exception(localize('error.processing.delete.files', 'Error processing deleted files'), err as Error));
            }, FILE_EVENT_DEBOUNCE_MS);
        });
    }

    private async processPendingDeleteFiles() {
        const files = [...this.pendingDeleteFiles];
        this.pendingDeleteFiles = [];

        if (files.length === 0) {
            return;
        }

        if (files.length === 1) {
            await this.removeSourceFileFromCMakeLists(files[0], this.project, false);
        } else {
            // Batch processing for multiple files
            await this.removeMultipleSourceFilesFromCMakeLists(files, this.project);
        }
    }

    private async isSourceFile(uri: vscode.Uri) {
        const textDocument = await vscode.workspace.openTextDocument(uri);
        return vscode.languages.match(this.documentSelector, textDocument);
    }

    /**
     * Collect all candidate edits for adding a source file.
     * This separates discovery from interaction.
     */
    private async collectAddCandidates(
        newSourceUri: vscode.Uri,
        project: CMakeProject,
        settings: vscode.WorkspaceConfiguration
    ): Promise<AddCandidatesResult> {
        const model = project.codeModelContent;
        if (!model) {
            return { candidates: [], error: localize('add.file.no.code.model', 'Adding a file without a valid code model') };
        }

        const buildType = await project.currentBuildType();
        const newSourceFileName = path.basename(newSourceUri.fsPath);
        const cmakeListsASTs = await findCMakeLists(project, newSourceUri);

        function sourceListCompare(a: SourceList, b: SourceList) {
            return a.compare(newSourceUri, b);
        }

        // Try variable source lists first
        let varSourceLists = variableSourceLists(cmakeListsASTs, project, settings);
        varSourceLists.sort(sourceListCompare);
        if (settings.variableSelection === 'askFirstParentDir') {
            varSourceLists = varSourceLists.filter(sourceList => platformPathEquivalent(
                sourceList.document.fileName,
                varSourceLists[0].document.fileName
            ));
        }

        const tryVariables = varSourceLists.length && settings.variableSelection !== 'never';
        if (tryVariables) {
            // Check if source already in variable lists
            for (const sourceList of varSourceLists) {
                const err = checkSourceInInvocation(sourceList.invocation, sourceList.destination, newSourceUri);
                if (err) {
                    return { candidates: [], info: err };
                }
            }

            // Build candidates from variable source lists
            const candidates = varSourceLists.map(sourceList =>
                this.buildAddCandidate(sourceList, newSourceUri));

            return { candidates, sourceList: varSourceLists[0], isVariableCandidate: true };
        }

        // Try target source commands
        const allTargets = allBuildTargets(model, buildType);
        const references = sourceFileTargets(allTargets, newSourceUri);
        if (references.length) {
            const msg = localize('file.already.in.target', '{0} already in target {1}.', newSourceFileName, references[0].name);
            return { candidates: [], info: msg };
        }

        let targets = candidateTargetsForSource(allTargets, newSourceUri);
        targets.sort(targetCompare);
        if (settings.targetSelection === 'askNearestSourceDir') {
            targets = targets.filter(target => platformPathEquivalent(
                target.sourceDirectory as string,
                targets[0].sourceDirectory as string
            ));
        }
        if (!targets.length) {
            return {
                candidates: [],
                error: localize('no.targets.found', 'No targets found. {0} not added to build system.', newSourceFileName)
            };
        }

        // Collect candidates from all targets and invocations
        const candidates: CandidateEdit[] = [];
        for (const target of targets) {
            const invocations = (await targetSourceCommandInvocations(
                project, target, cmakeListsASTs, settings.targetSourceCommands))
                .filter(i =>
                    isFileInsideFolder(newSourceUri, path.dirname(i.document.fileName)));

            // Check if source already in invocations
            for (const invocation of invocations) {
                const err = checkSourceInInvocation(invocation, target.name, newSourceUri);
                if (err) {
                    // Return as info, not error - let caller decide severity based on 'always'
                    return { candidates: [], info: err };
                }
            }

            // Sort the invocations using the compare function
            const sortedInvocations = [...invocations].sort((a, b) =>
                targetSourceCommandInvocationCompare(settings.targetSourceCommands, a, b));

            for (const invocation of sortedInvocations) {
                const sourceLists = targetSourceListOptions(
                    project, target, invocation, newSourceUri, settings);
                sourceLists.sort(sourceListCompare);

                for (const sourceList of sourceLists) {
                    candidates.push(this.buildAddCandidate(sourceList, newSourceUri, target));
                }
            }
        }

        if (!candidates.length) {
            return {
                candidates: [],
                error: localize('no.source.command.invocations', 'No source command invocations found. {0} not added to build system.', newSourceFileName)
            };
        }

        // Sort all candidates
        candidates.sort((a, b) => compareSortKeys(a.sortKeys, b.sortKeys));

        return { candidates };
    }

    private buildAddCandidate(
        sourceList: SourceList,
        newSourceUri: vscode.Uri,
        target?: codeModel.CodeModelTarget
    ): CandidateEdit {
        const insertPos = sourceList.insertPosition;
        const indent = freshLineIndent(sourceList.invocation, insertPos);
        const newSourceArgument = quoteArgument(sourceList.relativePath(newSourceUri));
        const newText = `\n${indent}${newSourceArgument}`;

        const document = sourceList.document;
        const lineText = document.lineAt(insertPos.line).text;

        return {
            uri: document.uri,
            range: new vscode.Range(insertPos, insertPos),
            newText,
            label: sourceList.label,
            description: target?.name || sourceList.destination,
            detail: `${path.relative(path.dirname(document.fileName), document.fileName)}:${insertPos.line + 1}`,
            sortKeys: sourceList.getSortKeys(newSourceUri),
            previewSnippet: `${lineText.trim()} + ${newSourceArgument}`,
            sourceList,
            target,
            isDeletion: false,
            sourceUri: newSourceUri
        };
    }

    /**
     * Collect all candidate edits for removing a source file.
     */
    private async collectRemoveCandidates(
        deletedUri: vscode.Uri,
        project: CMakeProject,
        settings: vscode.WorkspaceConfiguration
    ): Promise<RemoveCandidatesResult> {
        const model = project.codeModelContent;
        if (!model) {
            return { candidates: [], errors: [{ message: localize('delete.file.no.code.model', 'Deleting a file without a valid code model') }] };
        }

        const buildType = await project.currentBuildType();
        const cmakeListsASTs = await findCMakeLists(project, deletedUri);
        const candidates: CandidateEdit[] = [];
        const errors: EditError[] = [];

        // Check variable source lists
        const varSourceLists = variableSourceLists(cmakeListsASTs, project, settings);
        const seen = new Set<string>();
        if (varSourceLists.length && settings.variableSelection !== 'never') {
            for (const sourceList of varSourceLists) {
                const key = `${sourceList.document.fileName}:${sourceList.invocation.offset}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                const deleteEdits = this.buildDeleteCandidates(
                    deletedUri, sourceList.invocation, sourceList.label);
                if (deleteEdits.dirtyError) {
                    errors.push(deleteEdits.dirtyError);
                }
                candidates.push(...deleteEdits.candidates);
            }
        }

        // Check target source lists
        const targets = sourceFileTargets(allBuildTargets(model, buildType), deletedUri);
        for (const target of targets) {
            const invocations = await targetSourceCommandInvocations(
                project, target, cmakeListsASTs, settings.targetSourceCommands);
            for (const invocation of invocations) {
                const deleteEdits = this.buildDeleteCandidates(
                    deletedUri, invocation, `target ${target.name} sources`, target);
                if (deleteEdits.dirtyError) {
                    errors.push(deleteEdits.dirtyError);
                }
                candidates.push(...deleteEdits.candidates);
            }
        }

        return { candidates, errors };
    }

    private buildDeleteCandidates(
        deletedUri: vscode.Uri,
        invocation: CommandInvocation,
        listDescription: string,
        target?: codeModel.CodeModelTarget
    ): { candidates: CandidateEdit[]; dirtyError?: EditError } {
        const basename = path.basename(deletedUri.fsPath);
        const { document, ast } = invocation;
        const argIndices = findSourceInArgs(deletedUri, invocation);

        if (argIndices.length && document.isDirty) {
            return {
                candidates: [],
                dirtyError: {
                    message: localize('not.modifying.unsaved.delete', 'Not modifying {0} to delete {1} because it has unsaved changes.', document.fileName, basename),
                    fileUri: document.uri
                }
            };
        }

        const candidates: CandidateEdit[] = [];
        for (const i of argIndices) {
            const arg = ast.args[i];
            const prevToken = i ? ast.args[i - 1] : ast.lparen;
            const delRange = new vscode.Range(
                document.positionAt(prevToken.endOffset),
                document.positionAt(arg.endOffset)
            );

            const lineText = document.lineAt(document.positionAt(arg.offset).line).text;

            candidates.push({
                uri: document.uri,
                range: delRange,
                newText: '',
                label: basename,
                description: listDescription,
                detail: `${path.basename(document.fileName)}:${document.positionAt(arg.offset).line + 1}`,
                sortKeys: [0],
                previewSnippet: lineText.trim(),
                target,
                isDeletion: true,
                sourceUri: deletedUri
            });
        }

        return { candidates };
    }

    /**
     * Pick the best candidate using QuickPick steps when needed.
     * Returns null if user cancels.
     */
    private async pickAddCandidate(
        candidates: CandidateEdit[],
        settings: vscode.WorkspaceConfiguration,
        newSourceFileName: string,
        isVariableCandidate: boolean
    ): Promise<CandidateEdit | null> {
        if (candidates.length === 0) {
            return null;
        }

        // Determine selection mode based on candidate source
        // Variable candidates obey variableSelection, target candidates obey targetSelection
        const selectionMode = isVariableCandidate
            ? settings.variableSelection as string
            : settings.targetSelection as string;

        if (candidates.length === 1) {
            return candidates[0];
        }

        // In 'auto' mode for variable candidates, auto-select the first
        if (isVariableCandidate && selectionMode === 'auto') {
            return candidates[0];
        }

        // For variable candidates, just show the variable list picker
        if (isVariableCandidate) {
            const varItems = candidates.map(c => ({
                label: c.label,
                description: c.description,
                detail: c.previewSnippet,
                payload: c
            }));

            return quickPick(varItems, {
                title: localize('add.to.which.variable', 'CMake: Add {0} to which variable?', newSourceFileName)
            });
        }

        // Group by unique targets
        const targetGroups = new Map<string, CandidateEdit[]>();
        for (const candidate of candidates) {
            const key = candidate.target?.name || candidate.sourceList?.destination || '';
            if (!targetGroups.has(key)) {
                targetGroups.set(key, []);
            }
            targetGroups.get(key)!.push(candidate);
        }

        let selectedCandidate = candidates[0];

        // If multiple targets, ask which target
        if (targetGroups.size > 1) {
            const targetItems = Array.from(targetGroups.entries()).map(([name, cands]) => ({
                label: name,
                description: cands[0].target?.type,
                detail: cands[0].detail,
                payload: cands[0]
            }));

            const selected = await quickPick(targetItems, {
                title: localize('add.to.which.target', 'CMake: Add {0} to which target?', newSourceFileName)
            });
            if (!selected) {
                return null;
            }
            selectedCandidate = selected;
        }

        // If multiple source lists within the selected target, ask which one
        const targetCandidates = candidates.filter(c =>
            (c.target?.name || c.sourceList?.destination) ===
            (selectedCandidate.target?.name || selectedCandidate.sourceList?.destination));

        if (targetCandidates.length > 1 && settings.scopeSelection !== 'auto') {
            const listItems = targetCandidates.map(c => ({
                label: c.label,
                description: c.description,
                detail: c.previewSnippet,
                payload: c
            }));

            const selected = await quickPick(listItems, {
                title: localize('add.to.which.scope.fileset.keyword', 'CMake: Add {0} to which Scope, File Set, or Keyword?', newSourceFileName)
            });
            if (!selected) {
                return null;
            }
            selectedCandidate = selected;
        }

        return selectedCandidate;
    }

    /**
     * Review and apply edits with diff-based preview.
     */
    private async reviewAndApply(
        edits: CandidateEdit[],
        settings: vscode.WorkspaceConfiguration,
        reviewMode: 'add' | 'remove'
    ): Promise<boolean> {
        if (edits.length === 0) {
            return false;
        }

        const askMode = reviewMode === 'add'
            ? settings.addNewSourceFiles
            : settings.removeDeletedSourceFiles;

        if (askMode !== 'ask') {
            // Apply directly without review
            return this.applyEdits(edits);
        }

        // Group edits by document
        const editsByDoc = new Map<string, CandidateEdit[]>();
        for (const edit of edits) {
            const key = edit.uri.toString();
            if (!editsByDoc.has(key)) {
                editsByDoc.set(key, []);
            }
            editsByDoc.get(key)!.push(edit);
        }

        // For single add edit, show a simple confirmation instead of a full diff
        if (edits.length === 1 && !edits[0].isDeletion) {
            const edit = edits[0];
            const apply = localize('apply', 'Apply');
            const openDiff = localize('review.diff', 'Review Diff');
            const discard = localize('discard', 'Discard');

            const sourceFileName = path.basename(edit.sourceUri.fsPath);
            const targetFileName = path.basename(edit.uri.fsPath);

            const result = await vscode.window.showInformationMessage(
                localize('confirm.add.source',
                    'Add {0} to {1} in {2}:{3}?',
                    sourceFileName,
                    edit.description || edit.label,
                    targetFileName,
                    edit.range.start.line + 1
                ),
                apply,
                openDiff,
                discard
            );

            if (result === apply) {
                return this.applyEdits([edit]);
            } else if (result === openDiff) {
                const confirmed = await this.showDiffAndConfirm(edit.uri, [edit]);
                if (confirmed) {
                    return this.applyEdits([edit]);
                }
            }
            return false;
        }

        // For single delete edit, show diff and confirm
        if (edits.length === 1) {
            const edit = edits[0];
            const confirmed = await this.showDiffAndConfirm(edit.uri, [edit]);
            if (confirmed) {
                return this.applyEdits([edit]);
            }
            return false;
        }

        // For multiple edits (especially deletions), use multi-select QuickPick
        if (reviewMode === 'remove') {
            return this.reviewRemoveEdits(edits);
        }

        // For multiple add edits, review each file
        for (const [uriStr, docEdits] of editsByDoc) {
            const uri = vscode.Uri.parse(uriStr);
            const confirmed = await this.showDiffAndConfirm(uri, docEdits);
            if (!confirmed) {
                return false;
            }
        }

        return this.applyEdits(edits);
    }

    /**
     * Show diff view and prompt for confirmation
     */
    private async showDiffAndConfirm(
        originalUri: vscode.Uri,
        edits: CandidateEdit[]
    ): Promise<boolean> {
        const previewUri = this.previewProvider.setEdits(originalUri, edits);

        try {
            // Open diff view
            await vscode.commands.executeCommand('vscode.diff',
                originalUri,
                previewUri,
                localize('cmake.edit.preview.title', 'CMake Edit Preview: {0}', path.basename(originalUri.fsPath)),
                { preview: true }
            );

            // Show modal confirmation
            const apply = localize('apply', 'Apply');
            const discard = localize('discard', 'Discard');

            const editSummary = edits.length === 1
                ? edits[0].isDeletion
                    ? localize('remove.summary', 'Remove {0}', edits[0].label)
                    : localize('add.summary', 'Add to {0}', edits[0].label)
                : localize('edit.count.summary', '{0} edits', edits.length);

            const result = await vscode.window.showInformationMessage(
                localize('confirm.cmake.edit', 'Confirm CMake edit: {0}', editSummary),
                { modal: true },
                apply,
                discard
            );

            return result === apply;
        } finally {
            // Clean up the preview provider state
            // Note: We don't close the diff editor automatically - let the user close it
            // Forcibly closing could close the wrong editor if user clicked around
            this.previewProvider.clearEdits(originalUri);
        }
    }

    /**
     * Review remove edits with multi-select QuickPick
     */
    private async reviewRemoveEdits(edits: CandidateEdit[]): Promise<boolean> {
        // Group by file for display
        const items: (vscode.QuickPickItem & { edit: CandidateEdit })[] = edits.map(edit => ({
            label: edit.label,
            description: edit.description,
            detail: `${path.basename(edit.uri.fsPath)}:${edit.range.start.line + 1} - ${edit.previewSnippet}`,
            picked: true, // Default all selected for deleted files
            edit
        }));

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            title: localize('select.removals', 'CMake: Select file references to remove'),
            placeHolder: localize('select.removals.placeholder', 'All references selected by default')
        });

        if (!selected || selected.length === 0) {
            return false;
        }

        const selectedEdits = selected.map(item => item.edit);

        // Show diffs for affected files if user wants to review
        const review = localize('review', 'Review Diffs');
        const applyNow = localize('apply.now', 'Apply Now');

        const reviewChoice = await vscode.window.showInformationMessage(
            localize('apply.removals', 'Apply {0} removal(s)?', selectedEdits.length),
            { modal: false },
            review,
            applyNow
        );

        if (reviewChoice === review) {
            // Show diffs for each affected file
            const editsByDoc = new Map<string, CandidateEdit[]>();
            for (const edit of selectedEdits) {
                const key = edit.uri.toString();
                if (!editsByDoc.has(key)) {
                    editsByDoc.set(key, []);
                }
                editsByDoc.get(key)!.push(edit);
            }

            for (const [uriStr, docEdits] of editsByDoc) {
                const uri = vscode.Uri.parse(uriStr);
                const confirmed = await this.showDiffAndConfirm(uri, docEdits);
                if (!confirmed) {
                    return false;
                }
            }
        } else if (reviewChoice !== applyNow) {
            return false;
        }

        return this.applyEdits(selectedEdits);
    }

    /**
     * Apply the edits to the workspace
     */
    private async applyEdits(edits: CandidateEdit[]): Promise<boolean> {
        if (edits.length === 0) {
            return false;
        }

        // Group edits by document URI
        const editsByDoc = new Map<string, { doc: vscode.TextDocument; edits: CandidateEdit[] }>();
        for (const edit of edits) {
            const key = edit.uri.toString();
            if (!editsByDoc.has(key)) {
                const doc = await vscode.workspace.openTextDocument(edit.uri);
                editsByDoc.set(key, { doc, edits: [] });
            }
            editsByDoc.get(key)!.edits.push(edit);
        }

        // Check for dirty documents - skip them and continue with clean ones
        const dirtyDocs: vscode.TextDocument[] = [];
        const cleanDocs: string[] = [];
        for (const [key, { doc }] of editsByDoc.entries()) {
            if (doc.isDirty) {
                dirtyDocs.push(doc);
            } else {
                cleanDocs.push(key);
            }
        }

        // If all docs are dirty, show error and bail
        if (cleanDocs.length === 0 && dirtyDocs.length > 0) {
            const open = localize('open.file', 'Open File');
            const choice = await vscode.window.showErrorMessage(
                localize('not.modifying.unsaved.files', 'Cannot modify {0} because it has unsaved changes.', dirtyDocs[0].fileName),
                open
            );
            if (choice === open) {
                await vscode.window.showTextDocument(dirtyDocs[0]);
            }
            return false;
        }

        // If some docs are dirty, warn and continue with clean ones
        if (dirtyDocs.length > 0) {
            void vscode.window.showWarningMessage(
                localize('skipping.unsaved.files', 'Skipping {0} file(s) with unsaved changes: {1}',
                    dirtyDocs.length, dirtyDocs.map(d => path.basename(d.fileName)).join(', ')));
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        const editedDocs = new Set<vscode.TextDocument>();

        // Process each clean document's edits
        for (const key of cleanDocs) {
            const { doc, edits: docEdits } = editsByDoc.get(key)!;

            // Sort edits by position descending (apply from end to start to preserve offsets)
            // For deletions, sort by end offset first for safety with adjacent ranges
            // For same position, sort by source filename for deterministic ordering
            const sortedEdits = [...docEdits].sort((a, b) => {
                // For deletions, compare end offset first
                if (a.isDeletion && b.isDeletion) {
                    const endCompare = b.range.end.compareTo(a.range.end);
                    if (endCompare !== 0) {
                        return endCompare;
                    }
                }
                const startCompare = b.range.start.compareTo(a.range.start);
                if (startCompare !== 0) {
                    return startCompare;
                }
                // Same position: sort by source file name for deterministic order
                return a.sourceUri.fsPath.localeCompare(b.sourceUri.fsPath);
            });

            // Combine inserts at the same position into a single insert
            const combinedEdits: CandidateEdit[] = [];
            for (const edit of sortedEdits) {
                const last = combinedEdits[combinedEdits.length - 1];
                if (last && !edit.isDeletion && !last.isDeletion &&
                    last.range.start.isEqual(edit.range.start)) {
                    // Combine: append this edit's text to maintain filename sort order
                    // (we sorted ascending by filename, so append preserves that order)
                    last.newText = last.newText + edit.newText;
                } else {
                    combinedEdits.push({ ...edit });
                }
            }

            // Apply combined edits
            for (const edit of combinedEdits) {
                if (edit.isDeletion) {
                    workspaceEdit.delete(edit.uri, edit.range, {
                        label: localize('edit.label.remove.source.file', 'CMake: Remove deleted source file'),
                        needsConfirmation: false
                    });
                } else {
                    workspaceEdit.insert(edit.uri, edit.range.start, edit.newText, {
                        label: localize('edit.label.add.source.file', 'CMake: Add new source file'),
                        needsConfirmation: false
                    });
                }
            }
            editedDocs.add(doc);
        }

        if (editedDocs.size === 0) {
            return false;
        }

        try {
            await vscode.workspace.applyEdit(workspaceEdit);
            await Promise.all(Array.from(editedDocs).map(doc => doc.save()));
            return true;
        } catch (e) {
            void vscode.window.showErrorMessage(`${e}`);
            return false;
        }
    }

    async addSourceFileToCMakeLists(uri?: vscode.Uri, project?: CMakeProject, always = true) {
        const settings = vscode.workspace.getConfiguration('cmake.modifyLists', uri);
        if (settings.addNewSourceFiles === 'no' && !always) {
            return;
        }

        uri = uri ?? vscode.window.activeTextEditor?.document.uri;
        project = project ?? this.project;

        if (uri?.scheme !== 'file') {
            void vscode.window.showErrorMessage(localize('not.local.file.add', '{0} is not a local file. Not adding to CMake lists.', uri?.toString()));
            return;
        }
        if (!project || !project.codeModelContent) {
            void vscode.window.showWarningMessage(localize('add.file.no.code.model', 'Adding a file without a valid code model'));
            return;
        }

        // For auto-triggered flow with 'ask' mode, show a non-blocking notification
        // first so the user can decide whether to proceed before any QuickPicks appear
        let userPreConsented = false;
        if (!always && settings.addNewSourceFiles === 'ask') {
            const addAction = localize('add.to.cmake.lists', 'Add to CMakeLists');
            const fileName = path.basename(uri.fsPath);
            const result = await vscode.window.showInformationMessage(
                localize('new.source.file.detected', 'New source file detected: {0}', fileName),
                addAction
            );
            if (result !== addAction) {
                return;
            }
            userPreConsented = true;
        }

        // Work around for focus race condition with Save As dialog closing
        await this.workAroundSaveAsFocusBug(uri);

        const newSourceUri = uri;
        const newSourceFileName = path.basename(newSourceUri.fsPath);

        // Step 1: Collect all candidates
        const result = await this.collectAddCandidates(newSourceUri, project, settings);

        if (result.error) {
            void vscode.window.showErrorMessage(result.error);
            return;
        }
        if (result.info) {
            if (always) {
                void vscode.window.showErrorMessage(result.info);
            } else {
                void vscode.window.showInformationMessage(result.info);
            }
            return;
        }
        if (result.candidates.length === 0) {
            void vscode.window.showErrorMessage(
                localize('no.candidates.found', 'No suitable locations found to add {0}.', newSourceFileName));
            return;
        }

        // Step 2: Pick candidate using QuickPick if needed
        const selectedCandidate = await this.pickAddCandidate(
            result.candidates, settings, newSourceFileName, result.isVariableCandidate ?? false);
        if (!selectedCandidate) {
            return;
        }

        // Check for dirty document before applying
        const doc = await vscode.workspace.openTextDocument(selectedCandidate.uri);
        if (doc.isDirty) {
            const open = localize('open.file', 'Open File');
            const choice = await vscode.window.showErrorMessage(
                localize('not.modifying.unsaved.add', 'Not modifying {0} to add {1} because it has unsaved changes.', doc.fileName, newSourceFileName),
                open
            );
            if (choice === open) {
                await vscode.window.showTextDocument(doc);
            }
            return;
        }

        // Step 3: Apply the edit
        // If user already consented via the notification, apply directly.
        // Otherwise go through the normal review flow.
        if (userPreConsented) {
            await this.applyEdits([selectedCandidate]);
        } else {
            await this.reviewAndApply([selectedCandidate], settings, 'add');
        }
    }

    /**
     * Add multiple source files to CMake lists (batch operation)
     */
    private async addMultipleSourceFilesToCMakeLists(uris: vscode.Uri[], project?: CMakeProject) {
        const settings = vscode.workspace.getConfiguration('cmake.modifyLists');
        if (settings.addNewSourceFiles === 'no') {
            return;
        }

        project = project ?? this.project;
        if (!project || !project.codeModelContent) {
            void vscode.window.showWarningMessage(localize('add.file.no.code.model', 'Adding files without a valid code model'));
            return;
        }

        // For 'ask' mode, show a non-blocking notification first
        // (this method is only called from the auto-triggered flow)
        let userPreConsented = false;
        if (settings.addNewSourceFiles === 'ask') {
            const fileNames = uris.map(u => path.basename(u.fsPath)).join(', ');
            const addAction = localize('add.to.cmake.lists', 'Add to CMakeLists');
            const result = await vscode.window.showInformationMessage(
                localize('new.source.files.detected', 'New source files detected: {0}', fileNames),
                addAction
            );
            if (result !== addAction) {
                return;
            }
            userPreConsented = true;
        }

        // Check if user settings require interactive selection
        // If so, fall back to per-file flow to respect user preferences
        const variableSelection = settings.variableSelection as string;
        const targetSelection = settings.targetSelection as string;
        const needsInteractiveSelection = variableSelection !== 'auto' || targetSelection !== 'auto';

        if (needsInteractiveSelection) {
            // Fall back to processing files one at a time so user can pick for each.
            // Pass always=true since user already consented via the notification.
            for (const uri of uris) {
                await this.addSourceFileToCMakeLists(uri, project, true);
            }
            return;
        }

        const allCandidates: CandidateEdit[] = [];
        const errors: string[] = [];

        for (const uri of uris) {
            if (uri.scheme !== 'file') {
                continue;
            }

            const result = await this.collectAddCandidates(uri, project, settings);
            if (result.error) {
                errors.push(result.error);
            } else if (result.candidates.length > 0) {
                // Pick the best candidate for each file automatically
                const best = result.candidates[0];
                allCandidates.push(best);
            }
        }

        if (allCandidates.length === 0) {
            if (errors.length > 0) {
                void vscode.window.showErrorMessage(errors[0]);
            }
            return;
        }

        // Apply directly — user already consented via the notification,
        // or setting is 'yes' (auto-apply)
        if (userPreConsented) {
            await this.applyEdits(allCandidates);
        } else {
            await this.reviewAndApply(allCandidates, settings, 'add');
        }
    }

    async removeSourceFileFromCMakeLists(uri?: vscode.Uri, project?: CMakeProject, always = true) {
        const settings = vscode.workspace.getConfiguration('cmake.modifyLists', uri);
        if (settings.removeDeletedSourceFiles === 'no' && !always) {
            return;
        }

        uri = uri ?? vscode.window.activeTextEditor?.document.uri;
        project = project ?? this.project;

        if (uri?.scheme !== 'file') {
            void vscode.window.showErrorMessage(localize('not.local.file.remove', '{0} is not a local file. Not removing from CMake lists.', uri?.toString()));
            return;
        }

        if (!project || !project.codeModelContent) {
            void vscode.window.showWarningMessage(localize('delete.file.no.code.model', 'Deleting a file without a valid code model'));
            return;
        }

        const deletedUri = uri;

        // Step 1: Collect all deletion candidates
        const result = await this.collectRemoveCandidates(deletedUri, project, settings);

        // Show any dirty file errors
        for (const error of result.errors) {
            const open = localize('open.file', 'Open File');
            const choice = await vscode.window.showErrorMessage(error.message, open);
            if (choice === open && error.fileUri) {
                try {
                    const doc = await vscode.workspace.openTextDocument(error.fileUri);
                    await vscode.window.showTextDocument(doc);
                } catch {
                    // Ignore if we can't open the file
                }
            }
        }

        if (result.candidates.length === 0) {
            if (always) {
                void vscode.window.showErrorMessage(localize('file.not.found.in.cmake.lists', '{0} not found in CMake lists.', path.basename(deletedUri.fsPath)));
            }
            return;
        }

        // Step 2: Review and apply
        await this.reviewAndApply(result.candidates, settings, 'remove');
    }

    /**
     * Remove multiple source files from CMake lists (batch operation)
     */
    private async removeMultipleSourceFilesFromCMakeLists(uris: vscode.Uri[], project?: CMakeProject) {
        const settings = vscode.workspace.getConfiguration('cmake.modifyLists');
        if (settings.removeDeletedSourceFiles === 'no') {
            return;
        }

        project = project ?? this.project;
        if (!project || !project.codeModelContent) {
            void vscode.window.showWarningMessage(localize('delete.file.no.code.model', 'Deleting files without a valid code model'));
            return;
        }

        const allCandidates: CandidateEdit[] = [];
        const allErrors: EditError[] = [];

        for (const uri of uris) {
            if (uri.scheme !== 'file') {
                continue;
            }

            const result = await this.collectRemoveCandidates(uri, project, settings);
            allCandidates.push(...result.candidates);
            allErrors.push(...result.errors);
        }

        // Report first error if no candidates
        if (allCandidates.length === 0 && allErrors.length > 0) {
            void vscode.window.showErrorMessage(allErrors[0].message);
            return;
        }

        if (allCandidates.length === 0) {
            return;
        }

        // Review and apply all at once
        await this.reviewAndApply(allCandidates, settings, 'remove');
    }

    private async workAroundSaveAsFocusBug(uri: vscode.Uri) {
        const textDocument = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(textDocument);
    }

    dispose() {
        this.codeModelDispose();
        this.previewProviderRegistration?.dispose();

        if (this.addDebounceTimer) {
            clearTimeout(this.addDebounceTimer);
        }
        if (this.deleteDebounceTimer) {
            clearTimeout(this.deleteDebounceTimer);
        }
    }

    private codeModelDispose() {
        this.codeModelDisposables.forEach(w => w.dispose());
        this.codeModelDisposables = [];

        // Clear any pending debounce timers to prevent stale callbacks
        if (this.addDebounceTimer) {
            clearTimeout(this.addDebounceTimer);
            this.addDebounceTimer = undefined;
        }
        if (this.deleteDebounceTimer) {
            clearTimeout(this.deleteDebounceTimer);
            this.deleteDebounceTimer = undefined;
        }
        this.pendingAddFiles = [];
        this.pendingDeleteFiles = [];
    }
}

function modelLanguages(model: codeModel.CodeModelContent) {
    return model.configurations.flatMap(configuration =>
        configuration.projects.flatMap(project =>
            project.targets.flatMap(target =>
                target.fileGroups === undefined ? []
                    : target.fileGroups.flatMap(fileGroup =>
                        fileGroup.language === undefined ? []
                            : fileGroup.language.startsWith('ASM')
                                ? 'ASM'
                                : fileGroup.language))));
}

function cacheCompilerLanguages(cache: CMakeCache) {
    return cache.allEntries.flatMap(({ key }) => {
        const match = key.match(/^CMAKE_(.*)_COMPILER$/);
        return match ? match[1] : [];
    });
}

/**
 * Check if source is already in invocation without showing a message.
 * Returns the error message string if found, or null if not found.
 */
function checkSourceInInvocation(
    invocation: CommandInvocation, destination: string, sourceUri: vscode.Uri
): string | null {
    const indices = findSourceInArgs(sourceUri, invocation);
    if (!indices.length) {
        return null;
    }
    const { document, ast: { args } } = invocation;
    const line = document.positionAt(args[indices[0]].offset).line;
    return localize('file.already.in.destination', '{0} already in {1} at {2}:{3}', sourceUri.fsPath, destination, document.fileName, line + 1);
}

async function targetSourceCommandInvocations(
    project: CMakeProject,
    target: codeModel.CodeModelTarget,
    cmakeListsASTs: CMakeAST[],
    builtins: string[]
) {
    if (target.backtraceGraph) {
        return sourceCommandInvocationsFromBacktrace(project, target, builtins);
    } else {
        return sourceCommandInvocationsFromCMakeLists(cmakeListsASTs, target, builtins);
    }
}

function sourceCommandInvocationsFromCMakeLists(
    cmakeListsASTs: CMakeAST[], target: codeModel.CodeModelTarget, builtins: string[]
) {
    return topLevelInvocations(invocationsFromCMakeASTs(cmakeListsASTs))
        .filter(invocation => builtins.includes(invocation.command)
            && invocation.ast.args.length > 0
            && invocation.ast.args[0].value === target.name);
}

/**
 * filter out invocations between function()/endfunction() or macro()/endmacro()
 */
function topLevelInvocations(allInvocations: CommandInvocation[]) {
    const topLevelInvocations: CommandInvocation[] = [];
    let depth = 0;
    for (const invocation of allInvocations) {
        if (['function', 'macro'].includes(invocation.command)) {
            depth++;
        } else if (['endfunction', 'endmacro'].includes(invocation.command)) {
            depth--;
        } else if (!depth) {
            topLevelInvocations.push(invocation);
        }
    }
    return topLevelInvocations;
}

async function findCMakeLists(project: CMakeProject, newSourceUri: vscode.Uri) {
    const cmakeListsASTs: CMakeAST[] = [];
    let cmlUri = vscode.Uri.joinPath(newSourceUri, '..', 'CMakeLists.txt');
    while (isFileInsideFolder(cmlUri, project.sourceDir)) {
        try {
            const cml = await vscode.workspace.openTextDocument(cmlUri);
            try {
                cmakeListsASTs.push(new CMakeParser(cml).parseDocument());
            } catch (e) {
                void vscode.window.showWarningMessage(localize('parse.error.examining.cmake.lists', 'Parse error while examining CMakeLists.txt files. Details: {0}', String(e)));
            }
        } catch (e) {}
        cmlUri = vscode.Uri.joinPath(cmlUri, '..', '..', 'CMakeLists.txt');
    }
    return cmakeListsASTs;
}

function variableSourceLists(
    cmakeListsASTs: CMakeAST[],
    project: CMakeProject,
    settings: vscode.WorkspaceConfiguration
): SourceList[] {
    const sourceVariables = settings.sourceVariables as string[];
    if (!sourceVariables.length) {
        return [];
    }

    function isSourceVariable(ident: string): boolean {
        return sourceVariables.some(pat => minimatch(ident, pat));
    }

    return topLevelInvocations(invocationsFromCMakeASTs(cmakeListsASTs))
        .flatMap(invocation =>
            SourceList.fromVariableCommandInvocation(project, invocation, settings))
        .filter(sourceList =>
            sourceList.destination && isSourceVariable(sourceList.destination));
}

function invocationsFromCMakeASTs(cmakeListsASTs: CMakeAST[]): CommandInvocation[] {
    function* generator(): Generator<CommandInvocation> {
        for (const cml of cmakeListsASTs) {
            for (const ast of cml.invocations) {
                yield new CommandInvocation(cml.document, ast);
            }
        }
    }
    return Array.from(generator());
}

function findSourceInArgs(
    sourceUri: vscode.Uri,
    invocation: CommandInvocation
): number[] {
    const { ast: { args } } = invocation;
    const sourcePath = platformNormalizeUri(sourceUri);
    const ret: number[] = [];
    for (let i = 0; i < args.length; i++) {
        const argPath = resolveNormalized(invocation.sourceDir, args[i].value);
        if (argPath === sourcePath) {
            ret.push(i);
        }
    }
    return ret;
}

function allBuildTargets(
    model: codeModel.CodeModelContent,
    buildType: string | null
): codeModel.CodeModelTarget[] {
    let configs = model.configurations;

    // If buildType is specified, filter to matching config
    // If no match found or buildType is null/empty, fall back to first config
    if (buildType) {
        const matching = configs.filter(c => c.name === buildType);
        if (matching.length) {
            configs = matching;
        }
    }
    if (!configs.length && model.configurations.length) {
        configs = [model.configurations[0]];
    }

    return configs
        .flatMap(c => c.projects.flatMap(p => p.targets))
        .filter(target => target.sourceDirectory);
}

function sourceFileTargets(
    targets: codeModel.CodeModelTarget[],
    sourceUri: vscode.Uri
) {
    const sourceFile = platformNormalizeUri(sourceUri);
    return targets.filter(target => {
        const sourceDir = target.sourceDirectory as string;
        if (!target.fileGroups) {
            return false;
        }
        const sourcePaths = target.fileGroups.flatMap(
            fileGroup => fileGroup.sources.map(
                fileGroupSource => resolveNormalized(sourceDir, fileGroupSource)));
        return sourcePaths.includes(sourceFile);
    });
}

/**
 * Filter targets for insertion viability.
 *
 * A target is a viable option if it is a non-utility target with a source
 * directory that is the same as, or a parent of, the source directory of the
 * file.
 */
function candidateTargetsForSource(
    targets: codeModel.CodeModelTarget[],
    newSourceUri: vscode.Uri) {
    return targets.filter(target =>
        isFileInsideFolder(newSourceUri, target.sourceDirectory as string));
}

function targetCompare(a: codeModel.CodeModelTarget, b: codeModel.CodeModelTarget): number {
    const [aKeys, bKeys] = [a, b].map(targetSortKeys);
    return compareSortKeys(aKeys, bKeys);
}

function targetSortKeys(target: codeModel.CodeModelTarget): (number|string)[] {
    const { type, sourceDirectory, fileGroups } = target;
    const nSources =
        fileGroups?.reduce((accum, group) => accum + group.sources.length, 0);
    return [
        // Utility targets to the back of the line
        Number(type === 'UTILITY'),
        // Longer source path = more specific target = winner
        sourceDirectory ? -splitNormalizedPath(sourceDirectory).length : 0,
        // "bigger" targets beat smaller ones
        nSources ? -nSources : 0,
        // Break ties with target name
        target.name
    ];
}

class CommandInvocation {
    public readonly sourceDir;
    public readonly builtin;

    constructor(
        public document: vscode.TextDocument,
        public ast: CommandInvocationAST,
        builtin?: string,
        sourceDir?: string
    ) {
        this.builtin = builtin ?? ast.command.value;
        this.sourceDir = sourceDir ?? path.dirname(document.fileName);
    }

    public get offset(): number {
        return this.ast.command.offset;
    }

    public get command(): string {
        return this.ast.command.value;
    }

    public get line(): number {
        return this.document.positionAt(this.offset).line;
    }
}

async function sourceCommandInvocationsFromBacktrace(
    project: CMakeProject,
    target: codeModel.CodeModelTarget,
    builtins: string[]
): Promise<CommandInvocation[]> {
    // TODO: Filter out generated cmake files. Requires additional info
    // from the File API that isn't currently available.
    const backtraceGraph = target.backtraceGraph as codeModel.BacktraceGraph;
    const builtinSourceCommandIndices = backtraceGraph.commands
        .map((command, index) => ({ command, index }))
        .filter(({ command }) => builtins.includes(command))
        .map(({ index }) => index);
    const sourceCommandInvocationPromises = backtraceGraph.nodes.map(async (node) => {
        if (node.command === undefined || !builtinSourceCommandIndices.includes(node.command)) {
            return;
        }
        const builtin = backtraceGraph.commands[node.command];
        if (!builtin) {
            return;
        }

        const callNode = outermostCallNode(backtraceGraph.nodes, node);
        if (callNode?.line === undefined || callNode?.command === undefined) {
            return;
        }
        const command = backtraceGraph.commands[callNode.command];
        const listFile = backtraceGraph.files[callNode.file];
        if (!command || !listFile) {
            return;
        }
        const listUri = vscode.Uri.file(path.resolve(project.sourceDir, listFile));
        if (!isFileInsideFolder(listUri, project.sourceDir)) {
            return;
        }
        const subdirListNode = subdirectoryListNode(backtraceGraph.nodes, callNode);
        if (!subdirListNode) {
            return;
        }

        const document = await vscode.workspace.openTextDocument(listUri);
        const line = callNode.line - 1;
        const offset = document.offsetAt(new vscode.Position(line, 0));
        let ast;
        try {
            ast = new CMakeParser(document, offset).parseCommandInvocation();
        } catch (e) {
            void vscode.window.showWarningMessage(localize('parse.error.finding.invocations', 'Parse error while finding command invocations to add to. CMake file modified since last configure? Details: {0}', String(e)));
            return;
        }

        if (command !== ast.command.value) {
            void vscode.window.showWarningMessage(localize('unexpected.command.found', 'Found "{0}", expected "{1}". CMake file modified since last configure? Details: {2}:{3}', ast.command.value, command, document.fileName, line + 1));
            return;
        }

        const subdirListFile = backtraceGraph.files[subdirListNode.file];
        const sourceDir = path.dirname(path.resolve(project.sourceDir, subdirListFile));
        return new CommandInvocation(document, ast, builtin, sourceDir);
    });
    const sourceCommandInvocations = (
        await Promise.all(sourceCommandInvocationPromises))
        .flatMap(i => i === undefined ? [] : i);
    return sourceCommandInvocations;
}

/**
 * Walk the backtrace to the node representing the outermost function or macro
 * invocation.
 */
function outermostCallNode(
    nodes: codeModel.BacktraceGraphNode[],
    node: codeModel.BacktraceGraphNode
): codeModel.BacktraceGraphNode | undefined {
    if (node.parent === undefined) {
        return undefined;
    }
    const parent = nodes[node.parent];
    if (parent.command === undefined) {
        return node;
    }
    return outermostCallNode(nodes, parent);
}

/**
 * Since include() doesn't change CMAKE_SOURCE_DIR, we also need to know the
 * inner-most CMakeLists.txt added with add_subdirectory() so relative path
 * determination can work correctly.
 */
function subdirectoryListNode(
    nodes: codeModel.BacktraceGraphNode[],
    node: codeModel.BacktraceGraphNode
): codeModel.BacktraceGraphNode | undefined {
    if (node.parent === undefined) {
        return node;
    }
    return subdirectoryListNode(nodes, nodes[node.parent]);
}

function targetSourceCommandInvocationCompare(
    builtins: string[], a: CommandInvocation, b: CommandInvocation
): number {
    const [aKeys, bKeys] = [a, b].map(v => targetSourceCommandInvocationSortKeys(builtins, v));
    return compareSortKeys(aKeys, bKeys);
}

function targetSourceCommandInvocationSortKeys(builtins: string[], invocation: CommandInvocation): (number|string)[] {
    const {
        builtin, document, line,
        document: { uri }, ast: { args }
    } = invocation;
    const normalizedPath = platformNormalizeUri(uri);

    return [
        // Longest path wins
        -splitPath(normalizedPath).length,
        // CMakeLists.txt in a dir take precedence over other included list files
        Number(path.basename(normalizedPath).toLowerCase() !== 'cmakelists.txt'),
        path.basename(normalizedPath),
        // Indented lines lose to less indented lines
        document.lineAt(line).firstNonWhitespaceCharacterIndex,
        // longer argument lists beat shorter ones
        -args.length,
        // target_sources beats add_executable / add_library
        builtins.findIndex(pat => minimatch(builtin, pat)),
        // Earlier calls in the same file beat later ones
        normalizedPath,
        line
    ];
}

function targetSourceListOptions(
    project: CMakeProject,
    target: codeModel.CodeModelTarget,
    invocation: CommandInvocation,
    newSourceUri: vscode.Uri,
    settings: vscode.WorkspaceConfiguration
) {
    return SourceList.fromCommandInvocation(project, invocation, target, settings)
        .filter(sourceList => sourceList.canContain(newSourceUri));
}

abstract class SourceList {
    constructor(
        public insertOffset: number,
        public invocation: CommandInvocation,
        /**
         * for target source lists, the target name. For variable source lists,
         * the variable name
         * */
        public destination: string
    ) { }

    public get insertPosition() {
        return this.invocation.document.positionAt(this.insertOffset);
    }

    public get commandStartLine() {
        return this.invocation.line;
    }

    public get document() {
        return this.invocation.document;
    }

    public relativePath(uri: vscode.Uri): string {
        return lightNormalizePath(path.relative(this.invocation.sourceDir, uri.fsPath));
    }

    public quickPickItem(file: string): vscode.QuickPickItem & { payload: SourceList } {
        return {
            label: this.label,
            description: this.description(file),
            detail: this.details(file),
            payload: this
        };
    }

    public abstract get label(): string;
    protected description(_file: string): string {
        return '';
    }
    protected details(_file: string): string {
        return '';
    }

    public canContain(_uri: vscode.Uri): boolean {
        return true;
    }

    public compare(uri: vscode.Uri, other: SourceList): number {
        const aKeys = this.sortKeys(uri);
        const bKeys = other.sortKeys(uri);
        return compareSortKeys(aKeys, bKeys);
    }

    /**
     * Public accessor for sort keys
     */
    public getSortKeys(uri: vscode.Uri): (number|string)[] {
        return this.sortKeys(uri);
    }

    protected sortKeys(_uri: vscode.Uri): (number|string)[] {
        return [
            // The longer the list, the more likely it wants to grow
            -(this.insertOffset - this.invocation.ast.command.offset),
            // fall back to file and line, latest first
            platformNormalizeUri(this.document.uri),
            -this.insertOffset
        ];
    }

    static fromCommandInvocation(
        project: CMakeProject,
        invocation: CommandInvocation,
        target: codeModel.CodeModelTarget | undefined,
        settings: vscode.WorkspaceConfiguration
    ): SourceList[] {
        const { command, args } = invocation.ast;

        // First, check if this is a variable assignment or modification
        if (settings && command.value === 'set') {
            return [ new SetSourceList(invocation, project.sourceDir, settings) ];
        }
        if (settings && command.value === 'list' && args.length > 0 && LIST_KEYWORDS.includes(args[0].value)) {
            return [ new ListAppendSourceList(invocation, project.sourceDir, settings) ];
        }
        if (!target) {
            // Without a target, can't try to interpret invocation as a target source command
            return [];
        }

        // Otherwise, assume this is a target source list command of some kind
        const scopeIndices = findIndices(args, v => SOURCE_SCOPES.includes(v.value));
        if (scopeIndices.length) {
            return scopeIndices.map(index => new ScopeSourceList(invocation, index, target.name));
        }

        let optionIndices;
        const sourceListKeywords = settings.sourceListKeywords as string[];
        if (sourceListKeywords?.length) {
            optionIndices = findIndices(args,
                v => sourceListKeywords.some(pat => minimatch(v.value, pat)));
        } else {
            optionIndices = findIndices(args, v => !!(v.value.match(/^[A-Z_]+$/)));
        }
        if (optionIndices.length) {
            return optionIndices.map(index => new MultiValueSourceList(invocation, sourceListKeywords, index, target.name));
        }
        return [ new SimpleSourceList(invocation, target.name) ];
    }

    /**
     * Just a wrapper to make the code clearer at the call site.
     */
    static fromVariableCommandInvocation(
        project: CMakeProject, invocation: CommandInvocation, settings: vscode.WorkspaceConfiguration
    ): SourceList[] {
        return this.fromCommandInvocation(project, invocation, undefined, settings);
    }
}

class ScopeSourceList extends SourceList {
    public scope: string;
    public fileSet?: {
        name: string;
        type?: string;
        baseDirs: string[];
    };

    constructor(invocation: CommandInvocation, index: number, private target: string) {
        const { args } = invocation.ast;
        const scope = args[index++].value;
        let fileSetName: string | undefined;
        let fileSetType: string | undefined;
        const baseDirs = [];

        // Parse FILE_SET header if present
        if (index < args.length && args[index].value === 'FILE_SET') {
            index++;
            if (index < args.length) {
                fileSetName = args[index++].value;
            }
            if (index < args.length && args[index].value === 'TYPE') {
                index++;
                if (index < args.length) {
                    fileSetType = args[index++].value;
                }
            }
            if (index < args.length && args[index].value === 'BASE_DIRS') {
                index++;
                while (index < args.length && args[index].value !== 'FILES') {
                    const arg = args[index++].value;
                    const argPath = path.resolve(invocation.sourceDir, arg);
                    baseDirs.push(argPath);
                }
                if (index < args.length) {
                    index++;
                }
            }
        }

        super(findEndOfSourceList(args, index) as number, invocation, target);
        this.scope = scope;
        if (fileSetName) {
            this.fileSet = {
                name: fileSetName,
                type: fileSetType,
                baseDirs: baseDirs
            };
        }
    }

    private scopeDetails(target: string, file: string): string {
        switch (this.scope) {
            case 'PRIVATE': return localize('scope.private.detail', '{0} will be used to build {1}', file, target);
            case 'PUBLIC': return localize('scope.public.detail', '{0} will be used to build both {1} and targets that use {1}', file, target);
            case 'INTERFACE': return localize('scope.interface.detail', '{0} will be used to build targets that use {1}', file, target);
        }
        throw Error('scopeDetails() called with unrecognized scope name');
    }

    private fileSetDetails(file: string) {
        switch (this.resolveFileSetType()) {
            case 'HEADERS': return localize('fileset.headers.detail', '{0} will be used via a language\'s #include mechanism', file);
            case 'CXX_MODULES': return localize('fileset.cxx.modules.detail', '{0} contains C++ interface module or partition units.', file);
        }
        throw Error('fileSetDetails() called on scope list with missing or unrecognized FILE_SET');
    }

    public get label(): string {
        if (this.fileSet?.name) {
            return localize('label.fileset', '{0} File Set', this.fileSet.name);
        } else {
            return localize('label.scope', '{0} Scope', this.scope);
        }
    }

    protected description(file: string): string {
        const descParts = [];

        if (this.fileSet) {
            if (this.fileSet.type) {
                descParts.push(localize('fileset.type', 'Type: {0}', this.fileSet.type));
            }
            descParts.push(this.fileSetDetails(file));
        }
        return descParts.join('; ');
    }

    protected details(file: string): string {
        if (this.fileSet?.name) {
            return localize('scope.with.fileset.detail', '{0} Scope: {1}', this.scope, this.scopeDetails(this.target, file));
        } else {
            return this.scopeDetails(this.target, file);
        }
    }

    public canContain(uri: vscode.Uri): boolean {
        return this.baseDirsCanContain(uri) && this.fileSetTypeCanContain(uri);
    }

    private baseDirsCanContain(uri: vscode.Uri): boolean {
        if (!this.fileSet?.baseDirs?.length) {
            return true;
        }
        return this.fileSet?.baseDirs.some(baseDir =>
            isFileInsideFolder(uri, baseDir));
    }

    private resolveFileSetType() {
        return this.fileSet?.type ?? this.fileSet?.name;
    }

    private fileSetTypeCanContain(uri: vscode.Uri): boolean {
        const hasFileSet = !!this.fileSet?.name;
        if (isHeader(uri)) {
            return true;
        } else if (isCxxModule(uri)) {
            // "This file set type may not have an INTERFACE scope except on
            // IMPORTED targets."
            return !hasFileSet || this.scope !== 'INTERFACE';
        } else {
            return !hasFileSet;
        }
    }

    protected sortKeys(uri: vscode.Uri): (number|string)[] {
        const scopePriorities =
            isHeader(uri) || isCxxModule(uri) ? HEADER_SCOPES : SOURCE_SCOPES;
        return [
            -Number(!!this.fileSet),
            this.fileSet ? this.fileSet?.name : '',
            scopePriorities.indexOf(this.scope)
        ].concat(super.sortKeys(uri));
    }
}

class MultiValueSourceList extends SourceList {
    public readonly keyword: string;

    constructor(
        invocation: CommandInvocation,
        protected sourceListKeywords: string[],
        index: number,
        target: string
    ) {
        const { args } = invocation.ast;
        const keyword = args[index++].value;
        super(findEndOfSourceList(args, index) as number, invocation, target);
        this.keyword = keyword;
    }

    public get label(): string {
        return `${this.keyword}`;
    }

    protected description(_file: string): string {
        return localize('keyword.of.command', 'Keyword of {0} command', this.invocation.command);
    }

    protected sortKeys(uri: vscode.Uri): (number | string)[] {
        return ([
            this.sourceListKeywords.findIndex(pat => minimatch(this.keyword, pat))
        ] as (number|string)[]).concat(super.sortKeys(uri));
    }
}

class SimpleSourceList extends SourceList {
    constructor(invocation: CommandInvocation, target: string) {
        const { lparen, args } = invocation.ast;
        const insertOffset = findEndOfSourceList(args, 0) ?? lparen.endOffset;
        super(insertOffset, invocation, target);
    }

    public get label(): string {
        return localize('command.label', '{0} Command', this.invocation.command);
    }

    protected description(file: string): string {
        return localize('add.to.command.arguments', 'Add {0} to the list of arguments to {1} command', file, this.invocation.command);
    }
}

abstract class VariableSourceList extends SourceList {
    protected variable: string;
    protected sourceVariables: string[];

    constructor(
        invocation: CommandInvocation,
        protected projectDir: string,
        settings: vscode.WorkspaceConfiguration,
        variableIndex: number,
        listIndex: number
    ) {
        const { args } = invocation.ast;
        const variable = args[variableIndex].value;
        const insertOffset = findEndOfSourceList(args, listIndex) as number;
        super(insertOffset, invocation, variable);
        this.variable = variable;
        this.sourceVariables = settings.sourceVariables;
    }

    protected description(_file: string): string {
        const pos = this.invocation.document.positionAt(this.invocation.ast.command.offset);
        return this.invocation.document.lineAt(pos.line).text;
    }

    protected details(_file: string): string {
        const pos = this.invocation.document.positionAt(this.invocation.ast.command.offset);
        const relPath = path.relative(this.projectDir, this.invocation.document.fileName);
        return `${relPath}:${pos.line + 1}`;
    }

    protected sortKeys(uri: vscode.Uri): (number|string)[] {
        return ([
            // More specific CMakeLists.txt beat less specific ones
            -splitNormalizedPath(this.document.fileName).length,
            // Sort order depends on user configuration
            this.sourceVariables.findIndex(pat => minimatch(this.variable, pat))
        ] as (number|string)[]).concat(super.sortKeys(uri));
    }
}

class SetSourceList extends VariableSourceList {
    constructor(invocation: CommandInvocation, projectDir: string, settings: vscode.WorkspaceConfiguration
    ) {
        super(invocation, projectDir, settings, 0, 1);
    }

    public get label(): string {
        return `${this.variable} (set)`;
    }
}

class ListAppendSourceList extends VariableSourceList {
    private readonly subcommand: string;

    constructor(invocation: CommandInvocation, projectDir: string, settings: vscode.WorkspaceConfiguration
    ) {
        const subcommand = invocation.ast.args[0].value;
        super(invocation, projectDir, settings, 1, 2);
        this.subcommand = subcommand;
    }

    public get label(): string {
        return `${this.variable} (${this.subcommand.toLowerCase()})`;
    }
}

function isHeader(uri: vscode.Uri): boolean {
    const ext = extension(uri);
    return Object.values(LANGUAGE_EXTENSIONS).some(({ header }) =>
        header?.includes(ext));
}

function isCxxModule(uri: vscode.Uri): boolean {
    const ext = extension(uri);
    return Object.values(LANGUAGE_EXTENSIONS).some(({ cxxModule }) =>
        cxxModule?.includes(ext)
    );
}

function findEndOfSourceList(args: Token[], index: number) {
    while (index < args.length && !args[index].value.match(/^[A-Z_]+$/)) {
        index++;
    }
    if (!index) {
        return null;
    }
    const finalToken = args[index - 1];
    return finalToken.endOffset;
}

function freshLineIndent(invocation: CommandInvocation, insertPos: vscode.Position) {
    const currentLine = invocation.document.lineAt(insertPos.line);
    const currentLineIndent =
        currentLine.text.slice(0, currentLine.firstNonWhitespaceCharacterIndex);

    if (invocation.line !== insertPos.line) {
        // Just keep the current indentation
        return currentLineIndent;
    }

    const guessed = guessIndentConfig(invocation.document);
    const currentLineIndentSize = Array.from(currentLineIndent)
        .reduce((n, c) => n + (c === '\t' ? guessed.tabSize : 1), 0);
    const freshLineIndentSize = currentLineIndentSize + guessed.indentSize;

    if (guessed.insertSpaces) {
        return ' '.repeat(freshLineIndentSize);
    }

    const tabs = Math.floor(freshLineIndentSize / guessed.tabSize);
    const spaces = freshLineIndentSize % guessed.tabSize;
    return '\t'.repeat(tabs) + ' '.repeat(spaces);
}

interface IndentConfig {
    tabSize: number;
    indentSize: number;
    insertSpaces: boolean;
}

function guessIndentConfig(document: vscode.TextDocument): IndentConfig {
    const { tabSize, indentSize, insertSpaces } = indentSettings(document);

    let tabs = false;
    let minSpaces = 0; let maxSpaces = 0;
    for (const line of documentLines(document)) {
        const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
        if (indent.startsWith('\t')) {
            tabs = true;
        } else if (indent.startsWith(' ')) {
            const matches = indent.match('^( *)') as RegExpMatchArray;
            const spacesSize = matches[1].length;
            if (!minSpaces || spacesSize < minSpaces) {
                minSpaces = spacesSize;
            }
            if (spacesSize > maxSpaces) {
                maxSpaces = spacesSize;
            }
        }
    }

    const spaces = !!maxSpaces;

    if (spaces && tabs) {
        return {
            tabSize: maxSpaces + minSpaces,
            indentSize: minSpaces,
            insertSpaces: false
        };
    }
    if (spaces && !tabs) {
        return {
            tabSize,
            indentSize: minSpaces,
            insertSpaces: true
        };
    }
    if (!spaces && tabs) {
        return {
            tabSize,
            indentSize,
            insertSpaces: false
        };
    }

    // document contained no indented lines, fall back to workspace settings
    return {
        tabSize,
        indentSize,
        insertSpaces
    };
}

/**
 * Get the IndentConfig from the workspace configuration
 */
function indentSettings(document: vscode.TextDocument, languageId: string = 'cmake'): IndentConfig {
    const config = vscode.workspace.getConfiguration(
        'editor', { uri: document.uri, languageId });
    const tabSize = config.get<number>('tabSize', 8);
    const indentSizeRaw = config.get<number|'tabSize'>('indentSize', 4);
    const indentSize = indentSizeRaw === 'tabSize' ? tabSize : indentSizeRaw;
    const insertSpaces = config.get<boolean>('insertSpaces', false);

    return { tabSize, indentSize, insertSpaces };
}

function* documentLines(document: vscode.TextDocument): Generator<vscode.TextLine> {
    for (let i = 0; i < document.lineCount; i++) {
        yield document.lineAt(i);
    }
}

export function compareSortKeys(aKeys: (number|string)[], bKeys: (number|string)[]): number {
    const n = Math.min(aKeys.length, bKeys.length);

    for (let i = 0; i < n; i++) {
        const [a, b] = [aKeys[i], bKeys[i]];
        const compare = typeof a === 'number'
            ? a - (b as number)
            : a.localeCompare(String(b));
        if (compare) {
            return compare;
        }
    }

    return aKeys.length - bKeys.length;
}

export function resolveNormalized(base: string, inpath: string) {
    return platformNormalizePath(path.resolve(base, inpath));
}

function splitNormalizedPath(p: string): string[] {
    return splitPath(platformNormalizePath(p));
}

function extension(uri: vscode.Uri): string {
    return path.extname(uri.fsPath).slice(1);
}

export function quoteArgument(s: string): string {
    if (!s.match(/[\s()#"\\]/)) {
        return s;
    }
    s = s.replace(/\t/g, '\\t');
    s = s.replace(/\r/g, '\\r');
    s = s.replace(/\n/g, '\\n');
    s = s.replace(/"/g, '\\"');
    return `"${s}"`;
}

function addAll<T>(s: Set<T>, ...i: T[]) {
    i.forEach(e => s.add(e));
}

function findIndices<T>(array: T[], predicate: (e: T) => boolean): number[] {
    const indices: number[] = [];
    array.forEach((value, index) => {
        if (predicate(value)) {
            indices.push(index);
        }
    });

    return indices;
}

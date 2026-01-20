import CMakeProject from "@cmt/cmakeProject";
import * as codeModel from '@cmt/drivers/codeModel';
import * as vscode from 'vscode';
import { isFileInsideFolder, lightNormalizePath, platformNormalizePath, splitPath } from "./util";
import path = require("path");
import rollbar from "./rollbar";
import * as minimatch from 'minimatch';
import { CMakeCache } from "./cache";
import { CMakeAST, CMakeParser, CommandInvocationAST, Token } from "./cmakeParser";
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const LIST_KEYWORDS = ['APPEND', 'PREPEND', 'INSERT'];

/**
 * The order of identifiers in the following identifier lists affect sort order
 * in QuickPicks. Lower indices get sorted earlier.
 */
const SOURCE_SCOPES = ['PRIVATE', 'INTERFACE', 'PUBLIC'];
const HEADER_SCOPES = ['PUBLIC', 'PRIVATE', 'INTERFACE'];

/* Taken from CMake v3.30.2 */
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
        vscode.workspace.onDidCreateFiles(this.filesCreated, this, this.codeModelDisposables);
        vscode.workspace.onDidDeleteFiles(this.filesDeleted, this, this.codeModelDisposables);
    }

    private filesCreated(e: vscode.FileCreateEvent) {
        rollbar.invokeAsync(localize('add.newly.created.files', 'Add newly created files to CMakeLists.txt'), async () => {
            for (const uri of e.files) {
                if (await this.isSourceFile(uri)) {
                    await this.addSourceFileToCMakeLists(uri, this.project, false);
                }
            }
        });
    }

    private filesDeleted(e: vscode.FileDeleteEvent) {
        rollbar.invokeAsync(localize('remove.deleted.file', 'Remove a deleted file from CMakeLists.txt'), async () => {
            for (const uri of e.files) {
                await this.removeSourceFileFromCMakeLists(uri, this.project, false);
            }
        });
    }

    private async isSourceFile(uri: vscode.Uri) {
        const textDocument = await vscode.workspace.openTextDocument(uri);
        return vscode.languages.match(this.documentSelector, textDocument);
    }

    async addSourceFileToCMakeLists(uri?: vscode.Uri, project?: CMakeProject, always=true) {
        const settings = vscode.workspace.getConfiguration('cmake.modifyLists', uri);
        if (settings.addNewSourceFiles === 'no' && !always) {
            return;
        }

        uri = uri ?? vscode.window.activeTextEditor?.document.uri;
        project = project ?? this.project;
        const model = project?.codeModelContent;

        if (uri?.scheme !== 'file') {
            void vscode.window.showErrorMessage(localize('not.local.file.add', '{0} is not a local file. Not adding to CMake lists.', uri?.toString()));
            return;
        }
        if (!project || !model) {
            void vscode.window.showWarningMessage(localize('add.file.no.code.model', 'Adding a file without a valid code model'));
            return;
        }
        // Work around for focus race condition with Save As dialog closing
        await this.workAroundSaveAsFocusBug(uri);

        const newSourceUri = uri;
        const buildType = await project.currentBuildType();
        const newSourceFileName = path.basename(newSourceUri.fsPath);
        const cmakeListsASTs = await findCMakeLists(project, newSourceUri);

        function sourceListCompare(a: SourceList, b: SourceList) {
            return a.compare(newSourceUri, b);
        }

        let sourceList: SourceList;

        let varSourceLists = variableSourceLists(cmakeListsASTs, project, settings);
        varSourceLists.sort(sourceListCompare);
        if (settings.variableSelection === 'askFirstParentDir') {
            varSourceLists = varSourceLists.filter(sourceList => sameFile(
                sourceList.document.fileName,
                varSourceLists[0].document.fileName
            ));
        }

        const tryVariables = varSourceLists.length && settings.variableSelection !== 'never';
        if (tryVariables) {
            if (infoIfSourceInSourceLists(varSourceLists, newSourceUri)) {
                return;
            }

            let variableSourceList: SourceList | null = null;
            if (settings.variableSelection === 'auto' || varSourceLists.length < 2) {
                variableSourceList = varSourceLists[0];
            } else {
                variableSourceList = await showVariableSourceListOptions(
                    varSourceLists, newSourceFileName);
            }
            if (!variableSourceList) {
                return;
            }
            sourceList = variableSourceList;
        } else {
            const allTargets = allBuildTargets(model, buildType);
            const references = sourceFileTargets(allTargets, newSourceUri);
            if (references.length) {
                const msg = localize('file.already.in.target', '{0} already in target {1}.', newSourceFileName, references[0].name);
                if (always) {
                    void vscode.window.showErrorMessage(msg);
                } else {
                    void vscode.window.showInformationMessage(msg);
                }
                return;
            }

            let targets = candidateTargetsForSource(allTargets, newSourceUri);
            targets.sort(targetCompare);
            if (settings.targetSelection === 'askNearestSourceDir') {
                targets = targets.filter(target => sameFile(
                    target.sourceDirectory as string,
                    targets[0].sourceDirectory as string
                ));
            }
            if (!targets.length) {
                void vscode.window.showErrorMessage(
                    localize('no.targets.found', 'No targets found. {0} not added to build system.', newSourceFileName));
                return;
            }
            let target: codeModel.CodeModelTarget | null;
            if (settings.targetSelection === 'auto' || targets.length < 2) {
                target = targets[0];
            } else {
                target = await showTargetOptions(targets, project, newSourceFileName);
            }
            if (!target) {
                return;
            }

            const invocationSelection = settings.targetCommandInvocationSelection;
            function invocationCompare(a: CommandInvocation, b: CommandInvocation) {
                return targetSourceCommandInvocationCompare(settings.targetSourceCommands, a, b);
            }
            let invocations = (await targetSourceCommandInvocations(
                project, target, cmakeListsASTs, settings.targetSourceCommands))
                .filter(i =>
                    isFileInsideFolder(newSourceUri, path.dirname(i.document.fileName)));
            if (errorIfSourceInInvocations(invocations, target.name, newSourceUri)) {
                return;
            }
            invocations.sort(invocationCompare);
            if (invocationSelection === 'askFirstParentDir') {
                invocations = invocations.filter(invocation => sameFile(
                    invocation.document.fileName,
                    invocations[0].document.fileName));
            }

            if (!invocations.length) {
                void vscode.window.showErrorMessage(
                    localize('no.source.command.invocations', 'No source command invocations found for {0}. {1} not added to build system.', target.name, newSourceFileName)
                );
                return;
            }

            let invocation: CommandInvocation | null = null;
            if (invocationSelection === 'auto' || invocations.length < 2) {
                invocation = invocations[0];
            } else {
                invocation = await showCommandInvocationOptions(
                    invocations, project, target, newSourceFileName);
            }
            if (!invocation) {
                return;
            }

            if (invocation.document.isDirty) {
                void vscode.window.showErrorMessage(
                    localize('not.modifying.unsaved.add', 'Not modifying {0} to add {1} because it has unsaved changes.', invocation.document.fileName, newSourceFileName));
                return;
            }

            const sourceLists = targetSourceListOptions(
                project, target, invocation, newSourceUri, settings);
            sourceLists.sort(sourceListCompare);

            let targetSourceList: SourceList | null;
            if (settings.scopeSelection === 'auto' || sourceLists.length < 2) {
                targetSourceList = sourceLists[0];
            } else {
                targetSourceList = await showTargetSourceListOptions(
                    sourceLists, newSourceFileName, invocation);
            }
            if (!targetSourceList) {
                return;
            }
            sourceList = targetSourceList;
        }

        const cmakeDocument = sourceList.document;
        const insertPos = sourceList.insertPosition;
        const indent = freshLineIndent(sourceList.invocation, insertPos);
        const newSourceArgument = quoteArgument(sourceList.relativePath(newSourceUri));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(
            cmakeDocument.uri, insertPos, `\n${indent}${newSourceArgument}`,
            {
                label: localize('edit.label.add.source.file', 'CMake: Add new source file'),
                needsConfirmation: settings.addNewSourceFiles === 'ask'
            });
        try {
            await vscode.workspace.applyEdit(edit);
            await cmakeDocument.save();
        } catch (e) {
            void vscode.window.showErrorMessage(`${e}`);
        }

        // TODO: Allow adding new scopes, new file sets, new target_sources
        // (if there's only an add_library/add_executable), CMakeFiles.txt

        // TODO: Test with single-config generator, incl. with no buildType
    }

    async removeSourceFileFromCMakeLists(uri?: vscode.Uri, project?: CMakeProject, always=true) {
        const settings = vscode.workspace.getConfiguration('cmake.modifyLists', uri);
        if (settings.removeDeletedSourceFiles === 'no' && !always) {
            return;
        }
        const needsConfirmation = settings.removeDeletedSourceFiles === 'ask';

        uri = uri ?? vscode.window.activeTextEditor?.document.uri;
        project = project ?? this.project;
        const model = this.project?.codeModelContent;

        if (uri?.scheme !== 'file') {
            void vscode.window.showErrorMessage(localize('not.local.file.remove', '{0} is not a local file. Not removing from CMake lists.', uri?.toString()));
            return;
        }

        if (!project || !model) {
            void vscode.window.showWarningMessage(localize('delete.file.no.code.model', 'Deleting a file without a valid code model'));
            return;
        }

        const deletedUri = uri;
        const buildType = await project.currentBuildType();
        const cmakeListsASTs = await findCMakeLists(project, deletedUri);

        const edit = new vscode.WorkspaceEdit();
        const edited = new Set<vscode.TextDocument>();

        const varSourceLists: SourceList[] =
            variableSourceLists(cmakeListsASTs, project, settings);
        const seen = new Set<SourceList>();
        if (varSourceLists.length && settings.variableSelection !== 'never') {
            for (const sourceList of varSourceLists) {
                if (seen.has(sourceList)) {
                    // At time of writing, no two VariableSourceLists can have
                    // the same invocation.ast, because `set()` and
                    // `list(APPEND/PREPEND/INSERT)` each only modify one
                    // variable with one list. This check is out of an abundance
                    // of caution, so that we don't accidentally try to edit the
                    // same line twice if that assumption ever stopped holding.
                    continue;
                }
                seen.add(sourceList);
                addDeletionsForInvocation(
                    edit, edited, deletedUri, sourceList.invocation,
                    `${sourceList.label}`,
                    needsConfirmation
                );
            }
        }

        const targets =
            sourceFileTargets(allBuildTargets(model, buildType), deletedUri);
        for (const target of targets) {
            const invocations = await targetSourceCommandInvocations(
                project, target, cmakeListsASTs, settings.targetSourceCommands);
            for (const invocation of invocations) {
                addDeletionsForInvocation(
                    edit, edited, deletedUri, invocation,
                    `target ${target.name} sources`,
                    needsConfirmation
                );
            }
        }

        if (!edit.size && always) {
            void vscode.window.showErrorMessage(localize('file.not.found.in.cmake.lists', '{0} not found in CMake lists.', path.basename(deletedUri.fsPath)));
            return;
        }

        try {
            await vscode.workspace.applyEdit(edit, {isRefactoring: false});
            await Promise.all(Array.from(edited).map(async d => d.save()));
        } catch (e) {
            console.error(`${e}`);
        }
    }

    private async workAroundSaveAsFocusBug(uri: vscode.Uri) {
        const textDocument = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(textDocument);
    }

    dispose() {
        this.codeModelDispose();
    }

    private codeModelDispose() {
        this.codeModelDisposables.forEach(w => w.dispose());
        this.codeModelDisposables = [];
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

function infoIfSourceInSourceLists(
    sourceLists: SourceList[], sourceUri: vscode.Uri
): boolean {
    for (const sourceList of sourceLists) {
        const err = messageIfSourceInInvocation(
            sourceList.invocation, sourceList.destination, sourceUri, 'info');
        if (err) {
            return err;
        }
    }
    return false;
}

function errorIfSourceInInvocations(
    invocations: CommandInvocation[], destination: string, sourceUri: vscode.Uri
): boolean {
    for (const invocation of invocations) {
        const err = messageIfSourceInInvocation(
            invocation, destination, sourceUri, 'error');
        if (err) {
            return err;
        }
    }
    return false;
}

function messageIfSourceInInvocation(
    invocation: CommandInvocation, destination: string, sourceUri: vscode.Uri,
    type: 'info' | 'error'
): boolean {
    const indices = findSourceInArgs(sourceUri, invocation);
    if (!indices.length) {
        return false;
    }
    const { document, ast: { args } } = invocation;
    const line = document.positionAt(args[indices[0]].offset).line;
    const message = localize('file.already.in.destination', '{0} already in {1} at {2}:{3}', sourceUri.fsPath, destination, document.fileName, line + 1);
    if (type === 'error') {
        void vscode.window.showErrorMessage(message);
    } else {
        void vscode.window.showInformationMessage(message);
    }
    return true;
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
    function *generator(): Generator<CommandInvocation> {
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

async function showVariableSourceListOptions(
    sourceLists: SourceList[], newSourceFileName: string
): Promise<SourceList | null> {
    return await quickPick(
        sourceLists.map(c => c.quickPickItem(newSourceFileName)),
        { title: localize('add.to.which.variable', 'CMake: Add {0} to which variable?', newSourceFileName) }
    ) as SourceList | null;
}

function allBuildTargets(
    model: codeModel.CodeModelContent,
    buildType: string | null
): codeModel.CodeModelTarget[] {
    return model.configurations
        .filter(c => c.name === buildType)
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

async function showTargetOptions(
    targets: codeModel.CodeModelTarget[],
    project: CMakeProject, newSourceFileName: string
) {
    const binDir = await project.binaryDir;
    const targetQPTitle = localize('add.to.which.target', 'CMake: Add {0} to which target?', newSourceFileName);
    const targetQPItems = targets.map(target => {
        const artifacts = target.artifacts?.map(
            artifact => path.relative(binDir, artifact));
        return {
            label: target.name,
            description: target.type,
            detail: artifacts?.join(', ') || target.fullName,
            payload: target
        };
    });
    return quickPick(targetQPItems, { title: targetQPTitle });
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

async function showCommandInvocationOptions(
    sourceCommandInvocations: CommandInvocation[],
    project: CMakeProject,
    target: codeModel.CodeModelTarget,
    newSourceFileName: string
) {
    const commandInvocationQPTitle = localize('add.to.which.command.invocation', 'CMake: Add {0} to which command invocation of {1}?', newSourceFileName, target.name);
    const commandInvocationQPItems = sourceCommandInvocations.map(invocation => ({
        label: invocation.document.lineAt(invocation.line).text,
        detail: `${path.relative(project.sourceDir, invocation.document.fileName)}:${invocation.line}`,
        description: invocation.command !== invocation.builtin
            ? invocation.builtin : '',
        payload: invocation
    }));
    const selectedCommandInvocation = await quickPick(
        commandInvocationQPItems,
        {
            title: commandInvocationQPTitle,
            matchOnDescription: true, matchOnDetail: true
        }
    );
    return selectedCommandInvocation;
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

async function showTargetSourceListOptions(
    sourceLists: SourceList[],
    newSourceFilename: string,
    invocation: CommandInvocation
): Promise<SourceList | null> {
    const title =
        localize('add.to.which.scope.fileset.keyword', 'CMake: Add {0} to which Scope, File Set, or Keyword of {1}?', newSourceFilename, invocation.command);
    const items = sourceLists.map(sourceList =>
        sourceList.quickPickItem(newSourceFilename));

    return quickPick(items, { title: title });
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
        return `${relPath}:${pos.line}`;
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

function addDeletionsForInvocation(
    edit: vscode.WorkspaceEdit,
    editedDocuments: Set<vscode.TextDocument>,
    deletedSourceUri: vscode.Uri,
    invocation: CommandInvocation,
    listDescription: string,
    needsConfirmation: boolean
) {
    const basename = path.basename(deletedSourceUri.fsPath);
    const { document, ast } = invocation;
    const argIndices = findSourceInArgs(deletedSourceUri, invocation);
    if (argIndices.length && document.isDirty) {
        void vscode.window.showErrorMessage(
            localize('not.modifying.unsaved.delete', 'Not modifying {0} to delete {1} because it has unsaved changes.', invocation.document.fileName, basename));
        return;
    }
    for (const i of argIndices) {
        const arg = ast.args[i];
        const prevToken = i ? ast.args[i - 1] : ast.lparen;
        const delRange = new vscode.Range(
            document.positionAt(prevToken.endOffset),
            document.positionAt(arg.endOffset)
        );
        const editDesc =
            localize('remove.from.list.description', 'CMake: Remove {0} from {1}', basename, listDescription);
        edit.delete(
            document.uri, delRange,
            {
                label: localize('edit.label.remove.source.file', 'CMake: Remove deleted source file'),
                needsConfirmation: needsConfirmation,
                description: editDesc
            }
        );
        editedDocuments.add(document);
    }
}

async function quickPick<T>(
    items: (vscode.QuickPickItem & { payload: T })[],
    options: vscode.QuickPickOptions
): Promise<T | null> {
    const selected = await vscode.window.showQuickPick(items, options);
    if (!selected) {
        return null;
    }
    return selected.payload;
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

function compareSortKeys(aKeys: (number|string)[], bKeys: (number|string)[]): number {
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

export function sameFile(a: string, b: string): boolean {
    return platformNormalizePath(a) === platformNormalizePath(b);
}

export function platformNormalizeUri(uri: vscode.Uri): string {
    return platformNormalizePath(uri.fsPath);
}

function splitNormalizedPath(p: string): string[] {
    return splitPath(platformNormalizePath(p));
}

function extension(uri: vscode.Uri): string {
    return path.extname(uri.fsPath).slice(1);
}

function quoteArgument(s: string): string {
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

'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as proc from 'child_process';
import * as os from 'os';
import * as yaml from 'js-yaml';
import * as ajv from 'ajv';
import * as vscode from 'vscode';

import * as async from './async';
import * as environment from './environment';
import * as ctest from './ctest';
import {FileDiagnostic,
        DiagnosticParser,
        diagnosticParsers,
        } from './diagnostics';
import * as util from './util';
import {CompilationDatabase} from './compdb';
import * as api from './api';
import {config} from './config';

import {CommonCMakeToolsBase} from './common';

type Maybe<T> = util.Maybe<T>;

const CMAKETOOLS_HELPER_SCRIPT =
`
get_cmake_property(is_set_up _CMAKETOOLS_SET_UP)
if(NOT is_set_up)
    set_property(GLOBAL PROPERTY _CMAKETOOLS_SET_UP TRUE)
    macro(_cmt_invoke fn)
        file(WRITE "\${CMAKE_BINARY_DIR}/_cmt_tmp.cmake" "
            set(_args \\"\${ARGN}\\")
            \${fn}(\\\${_args})
        ")
        include("\${CMAKE_BINARY_DIR}/_cmt_tmp.cmake" NO_POLICY_SCOPE)
    endmacro()

    set(_cmt_add_executable add_executable)
    set(_previous_cmt_add_executable _add_executable)
    while(COMMAND "\${_previous_cmt_add_executable}")
        set(_cmt_add_executable "_\${_cmt_add_executable}")
        set(_previous_cmt_add_executable _\${_previous_cmt_add_executable})
    endwhile()
    macro(\${_cmt_add_executable} target)
        _cmt_invoke(\${_previous_cmt_add_executable} \${ARGV})
        get_target_property(is_imported \${target} IMPORTED)
        if(NOT is_imported)
            file(APPEND
                "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                "executable;\${target};$<TARGET_FILE:\${target}>\n"
                )
            _cmt_generate_system_info()
        endif()
    endmacro()

    set(_cmt_add_library add_library)
    set(_previous_cmt_add_library _add_library)
    while(COMMAND "\${_previous_cmt_add_library}")
        set(_cmt_add_library "_\${_cmt_add_library}")
        set(_previous_cmt_add_library "_\${_previous_cmt_add_library}")
    endwhile()
    macro(\${_cmt_add_library} target)
        _cmt_invoke(\${_previous_cmt_add_library} \${ARGV})
        get_target_property(type \${target} TYPE)
        if(NOT type MATCHES "^(INTERFACE_LIBRARY|OBJECT_LIBRARY)$")
            get_target_property(imported \${target} IMPORTED)
            get_target_property(alias \${target} ALIAS)
            if(NOT imported AND NOT alias)
                file(APPEND
                    "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                    "library;\${target};$<TARGET_FILE:\${target}>\n"
                    )
            endif()
        else()
            file(APPEND
                "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                "interface-library;\${target}\n"
                )
        endif()
        _cmt_generate_system_info()
    endmacro()

    if({{{IS_MULTICONF}}})
        set(condition CONDITION "$<CONFIG:Debug>")
    endif()

    file(WRITE "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt" "")
    file(GENERATE
        OUTPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.txt"
        INPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
        \${condition}
        )

    function(_cmt_generate_system_info)
        get_property(done GLOBAL PROPERTY CMT_GENERATED_SYSTEM_INFO)
        if(NOT done)
            file(APPEND "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
    "system;\${CMAKE_HOST_SYSTEM_NAME};\${CMAKE_SYSTEM_PROCESSOR};\${CMAKE_CXX_COMPILER_ID}\n")
        endif()
        set_property(GLOBAL PROPERTY CMT_GENERATED_SYSTEM_INFO TRUE)
    endfunction()
endif()
`;

const open = require('open') as ((url: string, appName?: string, callback?: Function) => void);

export class CacheEntry implements api.CacheEntry {
    private _type: api.EntryType = api.EntryType.Uninitialized;
    private _docs: string = '';
    private _key: string = '';
    private _value: any = null;

    public get type() {
        return this._type;
    }

    public get helpString() {
        return this._docs;
    }

    public get key() {
        return this._key;
    }

    public get value() {
        return this._value;
    }

    public as<T>(): T { return this.value; }

    constructor(key: string, value: string, type: api.EntryType, docs: string) {
        this._key = key ;
        this._value = value;
        this._type = type;
        this._docs = docs;
    }
    public advanced: boolean = false;
};

export class CMakeCache {
    private _entries: Map<string, CacheEntry>;

    public static async fromPath(path: string): Promise<CMakeCache> {
        const exists = await async.exists(path);
        if (exists) {
            const content = await async.readFile(path);
            const entries = await CMakeCache.parseCache(content.toString());
            return new CMakeCache(path, exists, entries);
        } else {
            return new CMakeCache(path, exists, new Map());
        }
    }

    constructor(path: string, exists: boolean, entries: Map<string, CacheEntry>) {
        this._entries = entries;
        this._path = path;
        this._exists = exists;
    }

    private _exists: boolean = false;
    public get exists() {
        return this._exists;
    }

    private _path: string = '';
    public get path() {
        return this._path;
    }

    public getReloaded(): Promise<CMakeCache> {
        return CMakeCache.fromPath(this.path);
    }

    public static parseCache(content: string): Map<string, CacheEntry> {
        const lines = content.split(/\r\n|\n|\r/)
            .filter(line => !!line.length)
            .filter(line => !/^\s*#/.test(line));

        const entries = new Map<string, CacheEntry>();
        let docs_acc = '';
        for (const line of lines) {
            if (line.startsWith('//')) {
                docs_acc += /^\/\/(.*)/.exec(line)![1] + ' ';
            } else {
                const match = /^(.*?):(.*?)=(.*)/.exec(line);
                console.assert(!!match, "Couldn't handle reading cache entry: " + line);
                const [_, name, typename, valuestr] = match!;
                if (!name || !typename)
                    continue;
                if (name.endsWith('-ADVANCED') && valuestr === '1') {
                    // We skip the ADVANCED property variables. They're a little odd.
                } else {
                    const key = name;
                    const type: api.EntryType = {
                        BOOL: api.EntryType.Bool,
                        STRING: api.EntryType.String,
                        PATH: api.EntryType.Path,
                        FILEPATH: api.EntryType.FilePath,
                        INTERNAL: api.EntryType.Internal,
                        UNINITIALIZED: api.EntryType.Uninitialized,
                        STATIC: api.EntryType.Static,
                    }[typename];
                    const docs = docs_acc.trim();
                    docs_acc = '';
                    let value: any = valuestr;
                    if (type === api.EntryType.Bool)
                        value = util.isTruthy(value);

                    console.assert(type !== undefined, `Unknown cache entry type: ${type}`);
                    entries.set(name, new CacheEntry(key, value, type, docs));
                }
            }
        }

        return entries;
    }

    public get(key: string, defaultValue?: any): Maybe<CacheEntry> {
        return this._entries.get(key) || null;
    }
}

class CMakeTargetListParser extends util.OutputParser {
    private _accumulatedLines: string[] = [];

    public parseLine(line: string): Maybe<number> {
        this._accumulatedLines.push(line);
        return null;
    }

    public getTargets(generator: string) {
        const important_lines = (generator.endsWith('Makefiles')
            ? this._accumulatedLines.filter(l => l.startsWith('... '))
            : this._accumulatedLines.filter(l => l.indexOf(': ') !== -1))
                .filter(l => !l.includes('All primary targets'));
        const targets = important_lines
            .map(l => generator.endsWith('Makefiles')
                ? l.substr(4)
                : l)
            .map(l => / /.test(l) ? l.substr(0, l.indexOf(' ')) : l)
            .map(l => l.replace(':', ''));
        // Sometimes the 'all' target isn't there. Not sure when or why, but we
        // can just patch around it
        if (targets.indexOf('all') < 0) {
            targets.push('all');
        }
        return targets;
    }
}

class BuildParser extends util.OutputParser {
    private _accumulatedDiags: Map<string, Map<string, vscode.Diagnostic>>;
    private _lastFile: Maybe<string>;

    private _progressParser(line): Maybe<number> { return null; };
    private _activeParser: Maybe<DiagnosticParser>;
    private _parserCollection: Set<DiagnosticParser>;

    constructor(binaryDir: string, parsers: Maybe<string[]>, generator: Maybe<string>) {
        super();
        this._accumulatedDiags = new Map();
        this._lastFile = null;
        this._activeParser = null;
        this._parserCollection = new Set();
        if (parsers) {
            for (let parser of parsers) {
                if (parser in diagnosticParsers) {
                    this._parserCollection.add(new diagnosticParsers[parser](binaryDir));
                }
            }
        } else {
            /* No parser specified. Use all implemented. */
            for (let parser in diagnosticParsers) {
                this._parserCollection.add(new diagnosticParsers[parser](binaryDir));
            }
        }
    }

    private parseBuildProgress(line): Maybe<number> {
        // Parses out a percentage enclosed in square brackets Ignores other
        // contents of the brackets
        const percent_re = /\[.*?(\d+)\%.*?\]/;
        const res = percent_re.exec(line);
        if (res) {
            const [total] = res.splice(1);
            return Math.floor(parseInt(total));
        }
        return null;
    }

    private parseDiagnosticLine(line: string): Maybe<FileDiagnostic> {
        if (this._activeParser) {
            var {lineMatch, diagnostic} = this._activeParser.parseLine(line);
            if (lineMatch) {
                return diagnostic;
            }
        }

        for (let parser of this._parserCollection.values()) {
            if (parser !== this._activeParser) {
                var {lineMatch, diagnostic} = parser.parseLine(line);
                if (lineMatch) {
                    this._activeParser = parser;
                    return diagnostic;
                }
            }
        }
        /* Most likely new generator progress message or new compiler command. */
        return null;
    }

    public fillDiagnosticCollection(diagset: vscode.DiagnosticCollection) {
        diagset.clear();
        for (const [filepath, diags] of this._accumulatedDiags) {
            diagset.set(vscode.Uri.file(filepath), [...diags.values()]);
        }
    }

    public parseLine(line: string): Maybe<number> {
        const progress = this.parseBuildProgress(line);
        if (null === progress) {
            const diag = this.parseDiagnosticLine(line);
            if (diag) {
                if (!this._accumulatedDiags.has(diag.filepath)) {
                    // First diagnostic of this file. Add a new map to hold our diags
                    this._accumulatedDiags.set(diag.filepath, new Map());
                }
                const diags = this._accumulatedDiags.get(diag.filepath) !;
                diags.set(diag.key, diag.diag);
            }
        }
        return progress;
    }
}


export class CMakeTools extends CommonCMakeToolsBase implements api.CMakeToolsAPI {
    private _lastConfigureSettings = {};
    private _variantWatcher: vscode.FileSystemWatcher;
    private _compilationDatabase: Promise<Maybe<CompilationDatabase>> = Promise.resolve(null);
    public os: Maybe<string> = null;
    public systemProcessor: Maybe<string> = null;
    public compilerId: Maybe<string> = null;

    private _targets: api.NamedTarget[] = [];
    get targets() { return this._targets; }

    public markDirty() {
        this._needsReconfigure = true;
    }

    private _cmakeCache: CMakeCache;
    public get cmakeCache() {
        return this._cmakeCache;
    }
    public set cmakeCache(cache: CMakeCache) {
        this._cmakeCache = cache;
        this._statusBar.projectName = this.projectName;
    }

    public cacheEntry(name: string) {
        return this.cmakeCache.get(name);
    }

    public get diagnostics(): vscode.DiagnosticCollection {
        return this._diagnostics;
    }

    private _initFinished : Promise<CMakeTools>;
    public get initFinished() : Promise<CMakeTools> {
        return this._initFinished;
    }

    private _needsReconfigure : boolean;
    public get needsReconfigure() : boolean {
        return this._needsReconfigure;
    }
    public set needsReconfigure(v : boolean) {
        this._needsReconfigure = v;
    }

    private async reloadCMakeCache() {
        if (this.cmakeCache && this.cmakeCache.path === this.cachePath) {
            this.cmakeCache = await this.cmakeCache.getReloaded();
        } else {
            this.cmakeCache = await CMakeCache.fromPath(this.cachePath);
        }
        this._statusBar.projectName = this.projectName;
        return this.cmakeCache;
    }

    private _executableTargets: api.ExecutableTarget[] = [];
    public get executableTargets() {
        return this._executableTargets;
    }

    public set executableTargets(value: api.ExecutableTarget[]) {
        this._executableTargets = value;
        if (!value) {
            this.currentDebugTarget = null;
            return;
        }
        // Check if the currently selected debug target is no longer a target
        if (value.findIndex(e => e.name === this.currentDebugTarget) < 0) {
            if (value.length) {
                this.currentDebugTarget = value[0].name;
            } else {
                this.currentDebugTarget = null;
            }
        }
        // If we didn't have a debug target, set the debug target to the first target
        if (this.currentDebugTarget === null && value.length) {
            this.currentDebugTarget = value[0].name;
        }
    }

    /**
     * @brief Reload the list of CTest tests
     */
    private async _refreshTests(): Promise<api.Test[]> {
        const ctest_file = path.join(this.binaryDir, 'CTestTestfile.cmake');
        if (!(await async.exists(ctest_file))) {
            return this.tests = [];
        }
        const bt = this.selectedBuildType || 'Debug';
        const result = await async.execute('ctest', ['-N', '-C', bt], {cwd: this.binaryDir});
        if (result.retc !== 0) {
            // There was an error running CTest. Odd...
            this._channel.appendLine('[vscode] There was an error running ctest to determine available test executables');
            return this.tests = [];
        }
        const tests = result.stdout.split('\n')
            .map(l => l.trim())
            .filter(l => /^Test\s*#(\d+):\s(.*)/.test(l))
            .map(l => /^Test\s*#(\d+):\s(.*)/.exec(l)!)
            .map(([_, id, tname]) => ({
                id: parseInt(id!),
                name: tname!
            }));
        const tagfile = path.join(this.binaryDir, 'Testing', 'TAG');
        const tag = (await async.exists(tagfile)) ? (await async.readFile(tagfile)).toString().split('\n')[0].trim() : null;
        const tagdir = tag ? path.join(this.binaryDir, 'Testing', tag) : null;
        const results_file = tagdir ? path.join(tagdir, 'Test.xml') : null;
        if (results_file && await async.exists(results_file)) {
            await this._refreshTestResults(results_file);
        } else {
            this.testResults = null;
        }
        return this.tests = tests;
    }

    private _failingTestDecorations : ctest.FailingTestDecoration[] = [];
    clearFailingTestDecorations() {
        this.failingTestDecorations = [];
    }
    addFailingTestDecoration(dec: ctest.FailingTestDecoration) {
        this._failingTestDecorations.push(dec);
        this._refreshActiveEditorDecorations();
    }
    public get failingTestDecorations() : ctest.FailingTestDecoration[] {
        return this._failingTestDecorations;
    }
    public set failingTestDecorations(v : ctest.FailingTestDecoration[]) {
        this._failingTestDecorations = v;
        for (const editor of vscode.window.visibleTextEditors) {
            this._refreshEditorDecorations(editor);
        }
    }

    private _refreshActiveEditorDecorations() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // Seems that sometimes the activeTextEditor is undefined. A VSCode bug?
            this._refreshEditorDecorations(vscode.window.activeTextEditor);
        }
    }

    private _refreshEditorDecorations(editor: vscode.TextEditor) {
        const to_apply: vscode.DecorationOptions[] = [];
        for (const decor of this.failingTestDecorations) {
            const editor_file = util.normalizePath(editor.document.fileName);
            const decor_file = util.normalizePath(
                path.isAbsolute(decor.fileName)
                    ? decor.fileName
                    : path.join(this.binaryDir, decor.fileName)
            );
            if (editor_file !== decor_file) {
                continue;
            }
            const file_line = editor.document.lineAt(decor.lineNumber);
            const range = new vscode.Range(decor.lineNumber, file_line.firstNonWhitespaceCharacterIndex, decor.lineNumber, file_line.range.end.character);
            to_apply.push({
                hoverMessage: decor.hoverMessage,
                range: range,
            });
        }
        editor.setDecorations(this._failingTestDecorationType, to_apply);
    }

    private async _refreshTestResults(test_xml: string): Promise<void> {
        this.testResults = await ctest.readTestResultsFile(test_xml);
        const failing = this.testResults.Site.Testing.Test.filter(t => t.Status === 'failed');
        this.clearFailingTestDecorations();
        let new_decors = [] as ctest.FailingTestDecoration[];
        for (const t of failing) {
            new_decors.push(...await ctest.parseTestOutput(t.Output));
        }
        this.failingTestDecorations = new_decors;
    }

    private async _reloadMetaData() {
        if (await async.exists(this.metaPath)) {
            const buffer = await async.readFile(this.metaPath);
            const content = buffer.toString();
            const tuples = content
                .split('\n')
                .map(l => l.trim())
                .filter(l => !!l.length)
                .map(l => l.split(';'));
            this.executableTargets = tuples
                .filter(tup => tup[0] === 'executable')
                .map(tup => ({
                    name: tup[1],
                    path: tup[2],
                }));
            const [_, os, proc, cid] = tuples.find(tup => tup[0] === 'system')!;
            this.os = os || null;
            this.systemProcessor = proc || null;
            this.compilerId = cid || null;
        } else {
            this.executableTargets = [];
            this.os = null;
            this.systemProcessor = null;
            this.compilerId = null;
        }
    }

    private _reloadConfiguration() {
        const new_settings = config.configureSettings;
        this._needsReconfigure = JSON.stringify(new_settings) !== JSON.stringify(this._lastConfigureSettings);
        this._lastConfigureSettings = new_settings;
        // A config change could require reloading the CMake Cache (ie. changing the build path)
        this._setupCMakeCacheWatcher();
        // Use may have disabled build diagnostics.
        if (!config.parseBuildDiagnostics) {
            this._diagnostics.clear();
        }
        if (!this._metaWatcher) {
            this._setupMetaWatcher();
        }
        this._reloadVariants();
        this.testHaveCommand(config.cmakePath).then(exists => {
            if (!exists) {
                vscode.window.showErrorMessage(
                    `Bad CMake executable "${config.cmakePath}". Is it installed and a valid executable?`
                );
            }
        });
    }

    private async _refreshWorkspaceCacheContent() {
        // this._workspaceCacheContent = await WorkspaceCacheFile.readCache(this._workspaceCachePath, {variant:null});
        // this._writeWorkspaceCacheContent();
        this._setupCMakeCacheWatcher();
        if (this._workspaceCacheContent.variant) {
            this.activeVariantCombination = this._workspaceCacheContent.variant;
        }
    }

    private _cmCacheWatcher: vscode.FileSystemWatcher;

    private _setupCMakeCacheWatcher() {
        if (this._cmCacheWatcher) {
            this._cmCacheWatcher.dispose();
        }
        this._cmCacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);
        this._cmCacheWatcher.onDidChange(this.reloadCMakeCache.bind(this));
        this._cmCacheWatcher.onDidCreate(this.reloadCMakeCache.bind(this));
        this._cmCacheWatcher.onDidDelete(() => {
            this.reloadCMakeCache().then(() => {
                this._statusBar.projectName = this.projectName;
            });
        });
        return this.reloadCMakeCache();
    }

    private _metaWatcher: vscode.FileSystemWatcher;
    private _setupMetaWatcher() {
        if (this._metaWatcher) {
            this._metaWatcher.dispose();
        }
        this._metaWatcher = vscode.workspace.createFileSystemWatcher(this.metaPath);
        this._metaWatcher.onDidChange(this._reloadMetaData.bind(this));
        this._metaWatcher.onDidCreate(this._reloadMetaData.bind(this));
        this._metaWatcher.onDidDelete(this._reloadMetaData.bind(this));
        this._reloadMetaData();
    }

    protected async _init(): Promise<CMakeTools> {
        await this.reloadCMakeCache();
        // Initialize the base class for common tools
        await super._init();

        vscode.window.onDidChangeActiveTextEditor(_ => {
            this._refreshActiveEditorDecorations();
        });

        // Load up the CMake cache
        await this._setupCMakeCacheWatcher();
        this._setupMetaWatcher();
        this._reloadConfiguration();

        await this._refreshTests();
        await this._refreshTargetList();
        this.statusMessage = 'Ready';

        this._lastConfigureSettings = config.configureSettings;
        this._needsReconfigure = true;
        vscode.workspace.onDidChangeConfiguration(() => {
            console.log('Reloading CMakeTools after configuration change');
            this._reloadConfiguration();
        });

        if (config.initialBuildType !== null) {
            vscode.window.showWarningMessage('The "cmake.initialBuildType" setting is now deprecated and will no longer be used.');
        }

        const last_nag_time = this._context.globalState.get('feedbackWanted.lastNagTime', 0);
        const now = new Date().getTime();
        const time_since_nag = now - last_nag_time;
        // Ask for feedback once every thirty days
        const do_nag = time_since_nag > 1000 * 60 * 60 * 24 * 30;
        if (do_nag && Math.random() < 0.1) {
            this._context.globalState.update('feedbackWanted.lastNagTime', now);
            vscode.window.showInformationMessage<{title: string, action?: () => void, isCloseAffordance?: boolean}>(
                'Like CMake Tools? I need your feedback to help make this extension better! Submitting feedback should only take a few seconds.',
                {
                    title: 'I\'ve got a few seconds',
                    action: () => {
                        open('https://github.com/vector-of-bool/vscode-cmake-tools/issues?q=is%3Aopen+is%3Aissue+label%3A%22feedback+wanted%21%22');
                    },
                },
                {
                    title: 'Not now',
                    isCloseAffordance: true,
                }).then(chosen => {
                    if (chosen.action) {
                        chosen.action();
                    }
                });
        }

        return this;
    }

    constructor(ctx: vscode.ExtensionContext) {
        super(ctx);
        this._initFinished = this._init();
    }

    public async compilationInfoForFile(filepath: string): Promise<api.CompilationInfo|null> {
        const db = await this._compilationDatabase;
        if (!db) {
            return null;
        }
        return db.getCompilationInfoForUri(vscode.Uri.file(filepath));
    }

    private async _refreshAll() {
        await this.reloadCMakeCache();
        await this._refreshTargetList();
        await this._reloadMetaData();
        await this._refreshTests();
        this._compilationDatabase = CompilationDatabase.fromFilePath(path.join(this.binaryDir, 'compile_commands.json'));
    }

    /**
     * @brief Reload the list of available targets
     */
    private async _refreshTargetList(): Promise<api.NamedTarget[]> {
        this._targets = [];
        if (!this.cmakeCache.exists) {
            return this.targets;
        }
        this.statusMessage = 'Refreshing targets...';
        const generator = this.activeGenerator;
        if (generator && /(Unix|MinGW|NMake) Makefiles|Ninja/.test(generator)) {
            const parser = new CMakeTargetListParser();
            await this.executeCMakeCommand(['--build', this.binaryDir, '--target', 'help'], {
                silent: true,
                environment: {}
            }, parser);
            this._targets = parser.getTargets(generator).map(
                t => ({type: 'named' as 'named', name: t}));
        }
        this.statusMessage = 'Ready';
        return this.targets;
    }

    public replaceVars(str: string): string {
        const replacements = [
            ['${buildType}', this.selectedBuildType || 'Unknown'],
            ['${workspaceRoot}', vscode.workspace.rootPath],
            ['${workspaceRootFolderName}', path.basename(vscode.workspace.rootPath)]
        ] as [string, string][];
        return replacements.reduce(
            (accdir, [needle, what]) => util.replaceAll(accdir, needle, what),
            str,
        );
    }

    /**
     * @brief Get the path to the metadata file
     */
    public get metaPath(): string {
        const meta = path.join(this.binaryDir, 'CMakeToolsMeta.txt');
        return util.normalizePath(meta);
    }

    public get activeGenerator(): Maybe<string> {
        const gen = this.cmakeCache.get('CMAKE_GENERATOR');
        return gen
            ? gen.as<string>()
            : null;
    }

    public executeCMakeCommand(args: string[],
                               options: api.ExecuteOptions = {silent: false, environment: {}},
                               parser: util.OutputParser = new util.NullParser)
    : Promise<api.ExecutionResult> {
        console.info('Execute cmake with arguments:', args);
        return this.execute(config.cmakePath, args, options, parser);
    }

    /**
     * @brief Execute a CMake command. Resolves to the result of the execution.
     */
    public execute(program: string,
                   args: string[],
                   options: api.ExecuteOptions = {
                       silent: false,
                       environment: {},
                       collectOutput: false
                    },
                   parser: util.OutputParser = new util.NullParser())
    : Promise<api.ExecutionResult> {
        const silent: boolean = options && options.silent || false;
        const final_env = Object.assign(
            {
                // We set NINJA_STATUS to force Ninja to use the format
                // that we would like to parse
                NINJA_STATUS: '[%f/%t %p] '
            },
            options.environment,
            config.environment,
            this.currentEnvironmentVariables,
        );
        const info = util.execute(
            program, args, final_env, options.workingDirectory, parser);
        const pipe = info.process;
        if (!silent) {
            this.currentChildProcess = pipe;
            this._channel.appendLine(
                '[vscode] Executing command: '
                // We do simple quoting of arguments with spaces.
                // This is only shown to the user,
                // and doesn't have to be 100% correct.
                + [program].concat(args)
                    .map(a => a.replace('"', '\"'))
                    .map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a)
                    .join(' ')
            );
        }

        pipe.stdout.on('line', (line: string) => {
            console.log(program + ' [stdout]: ' + line);
            const progress = parser.parseLine(line);
            if (!silent) {
                if (progress) this.buildProgress = progress;
                this._channel.appendLine(line);
            }
        });
        pipe.stderr.on('line', (line: string) => {
            console.log(program + ' [stderr]: ' + line);
            const progress = parser.parseLine(line);
            if (!silent) {
                if (progress) this.buildProgress = progress;
                this._channel.appendLine(line);
            }
        });

        pipe.on('close', (retc: number) => {
            // Reset build progress to null to disable the progress bar
            this.buildProgress = null;
            if (parser instanceof BuildParser) {
                parser.fillDiagnosticCollection(this._diagnostics);
            }
            if (silent) {
                return;
            }
            const msg = `${program} existed with status ${retc}`;
            this._channel.appendLine('[vscode] ' + msg);
            if (retc !== null) {
                vscode.window.setStatusBarMessage(msg, 4000);
                if (retc !== 0) {
                    this._statusBar.showWarningMessage(`${program} failed with status ${retc}. See CMake/Build output for details.`)
                }
            }

            this.currentChildProcess = null;
        });
        return info.onComplete;
    };

    // Test that a command exists
    public async testHaveCommand(command, args: string[] = ['--version']): Promise<Boolean> {
        return await new Promise<Boolean>((resolve, _) => {
            const pipe = proc.spawn(command, args);
            pipe.on('error', () => resolve(false));
            pipe.on('exit', () => resolve(true));
        });
    }

    // Given a list of CMake generators, returns the first one available on this system
    public async pickGenerator(candidates: string[]): Promise<Maybe<string>> {
        // The user can override our automatic selection logic in their config
        const generator = config.generator;
        if (generator) {
            // User has explicitly requested a certain generator. Use that one.
            return generator;
        }
        for (const gen of candidates) {
            const delegate = {
                Ninja: async function () {
                    return await this.testHaveCommand('ninja-build') || await this.testHaveCommand('ninja');
                },
                "MinGW Makefiles": async function () {
                    return process.platform === 'win32' && await this.testHaveCommand('make');
                },
                "NMake Makefiles": async function () {
                    return process.platform === 'win32' && await this.testHaveCommand('nmake', ['/?']);
                },
                'Unix Makefiles': async function () {
                    return process.platform !== 'win32' && await this.testHaveCommand('make');
                }
            }[gen];
            if (delegate === undefined) {
                const vsMatcher = /^Visual Studio (\d{2}) (\d{4})($|\sWin64$|\sARM$)/;
                if (vsMatcher.test(gen) && process.platform === 'win32')
                    return gen;
                vscode.window.showErrorMessage('Unknown CMake generator "' + gen + '"');
                continue;
            }
            if (await delegate.bind(this)())
                return gen;
            else
                console.log('Generator "' + gen + '" is not supported');
        }
        return null;
    }

    private async _prebuild(): Promise<boolean> {
        if (config.clearOutputBeforeBuild) {
            this._channel.clear();
        }

        if (config.saveBeforeBuild && vscode.workspace.textDocuments.some(doc => doc.isDirty)) {
            this._channel.appendLine("[vscode] Saving unsaved text documents...");
            const is_good = await vscode.workspace.saveAll();
            if (!is_good) {
                const chosen = await vscode.window.showErrorMessage<vscode.MessageItem>(
                    'Not all open documents were saved. Would you like to build anyway?',
                    {
                        title: 'Yes',
                        isCloseAffordance: false,
                    },
                    {
                        title: 'No',
                        isCloseAffordance: true,
                    });
                return chosen.title === 'Yes';
            }
        }
        return true;
    }

    public get numJobs(): number {
        const jobs = config.parallelJobs;
        if (!!jobs) {
            return jobs;
        }
        return os.cpus().length + 2;
    }

    public get numCTestJobs(): number {
        const ctest_jobs = config.ctest_parallelJobs;
        if (!ctest_jobs) {
            return this.numJobs;
        }
        return ctest_jobs;
    }

    public async configure(extra_args: string[] = [], run_prebuild = true): Promise<Number> {
        if (this.isBusy) {
            vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to configure.');
            return -1;
        }

        if (!this.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return -1;
        }

        const cmake_list = this.mainListFile;
        if (!(await async.exists(cmake_list))) {
            const do_quickstart = !!(
                await vscode.window.showErrorMessage(
                    'You do not have a CMakeLists.txt',
                    "Quickstart a new CMake project"
                )
            );
            if (do_quickstart)
                await this.quickStart();
            return -1;
        }

        if (!this.activeVariantCombination) {
            const ok = await this.setBuildTypeWithoutConfigure();
            if (!ok) {
                return -1;
            }
        }

        if (run_prebuild) {
            const ok = await this._prebuild();
            if (!ok) {
                return -1;
            }
        }

        const cmake_cache = this.cachePath;
        this._channel.show();

        if (!(await async.exists(cmake_cache))
         || (this.cmakeCache.exists && this.cachePath !== this.cmakeCache.path)) {
            await this.reloadCMakeCache();
        }

        const settings_args: string[] = [];
        let is_multi_conf = this.isMultiConf;
        if (!this.cmakeCache.exists) {
            this._channel.appendLine("[vscode] Setting up new CMake configuration");
            const generator = await this.pickGenerator(config.preferredGenerators);
            if (generator) {
                this._channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
                is_multi_conf = util.isMultiConfGenerator(generator);
            } else {
                console.error("None of the preferred generators was selected");
            }
        }

        const toolset = config.toolset;
        if (toolset) {
            settings_args.push('-T' + toolset);
        }

        if (!is_multi_conf) {
            settings_args.push('-DCMAKE_BUILD_TYPE=' + this.selectedBuildType);
        }

        const settings = Object.assign({}, config.configureSettings);
        settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;

        const variant = this.activeVariant;
        if (variant) {
            Object.assign(settings, variant.settings || {});
            settings.BUILD_SHARED_LIBS = variant.linkage === 'shared';
        }

        if (!(await async.exists(this.binaryDir))) {
            await util.ensureDirectory(this.binaryDir);
        }

        const cmt_dir = path.join(this.binaryDir, 'CMakeTools');
        if (!(await async.exists(cmt_dir))) {
            await util.ensureDirectory(cmt_dir);
        }

        const helpers = path.join(cmt_dir, 'CMakeToolsHelpers.cmake');
        const helper_content = util.replaceAll(CMAKETOOLS_HELPER_SCRIPT,
                                        '{{{IS_MULTICONF}}}',
                                        is_multi_conf
                                            ? '1'
                                            : '0'
                                        );
        await util.writeFile(helpers, helper_content);
        const old_path = settings['CMAKE_PREFIX_PATH'] as Array<string> || [];
        settings['CMAKE_MODULE_PATH'] = Array.from(old_path).concat([
            cmt_dir.replace(/\\/g, path.posix.sep)
        ]);
        const initial_cache_content = [
            '# This file is generated by CMake Tools! DO NOT EDIT!',
            'cmake_policy(PUSH)',
            'if(POLICY CMP0053)',
            '   cmake_policy(SET CMP0053 NEW)',
            'endif()',
        ];

        for (const key in settings) {
            let value = settings[key];
            let typestr = 'UNKNOWN';
            if (value === true || value === false) {
                typestr = 'BOOL';
                value = value ? "TRUE" : "FALSE";
            }
            if (typeof(value) === 'string') {
                typestr = 'STRING';
                value = this.replaceVars(value)
                value = util.replaceAll(value, ';', '\\;');
            }
            if (value instanceof Number || typeof value === 'number') {
                typestr = 'STRING';
            }
            if (value instanceof Array) {
                typestr = 'STRING';
                value = value.join(';');
            }
            initial_cache_content.push(`set(${key} "${value.toString().replace(/"/g, '\\"')}" CACHE ${typestr} "Variable supplied by CMakeTools. Value is forced." FORCE)`);
        }
        initial_cache_content.push('cmake_policy(POP)')
        const init_cache_path = path.join(this.binaryDir, 'CMakeTools', 'InitializeCache.cmake');
        await util.writeFile(init_cache_path, initial_cache_content.join('\n'));
        let prefix = config.installPrefix;
        if (prefix && prefix !== "") {
            prefix = this.replaceVars(prefix);
            settings_args.push("-DCMAKE_INSTALL_PREFIX=" + prefix);
        }

        const binary_dir = this.binaryDir;
        this.statusMessage = 'Configuring...';
        const result = await this.executeCMakeCommand(
            ['-H' + this.sourceDir.replace(/\\/g, path.posix.sep),
             '-B' + binary_dir.replace(/\\/g, path.posix.sep),
             '-C' + init_cache_path]
                .concat(settings_args)
                .concat(extra_args)
                .concat(config.configureArgs),
            {
                silent: false,
                environment: config.configureEnvironment,
            },
            new BuildParser(this.binaryDir, null, this.activeGenerator)
        );
        this.statusMessage = 'Ready';
        if (!result.retc) {
            await this._refreshAll();
            await this._reloadConfiguration();
            this._needsReconfigure = false;
        }
        return result.retc;
    }

    public async build(target_: Maybe<string> = null): Promise<Number> {
        let target = target_;
        if (!target_) {
            target = this.defaultBuildTarget || this.allTargetName;
        }
        if (!this.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return -1;
        }

        if (this.isBusy) {
            vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to build.');
            return -1;
        }

        const cachepath = this.cachePath;
        if (!(await async.exists(cachepath))) {
            const retc = await this.configure();
            if (retc !== 0) {
                return retc;
            }
            await this.reloadCMakeCache();
            // We just configured which may change what the "all" target is.
            if (!target_) {
                target = this.defaultBuildTarget || this.allTargetName;
            }
        }
        if (!target) {
            throw new Error('Unable to determine target to build. Something has gone horribly wrong!');
        }
        const ok = await this._prebuild();
        if (!ok) {
            return -1;
        }
        if (this._needsReconfigure) {
            const retc = await this.configure([], false);
            if (!!retc)
                return retc;
        }
        // Pass arguments based on a particular generator
        const gen = this.activeGenerator;
        const generator_args = (() => {
            if (!gen)
                return [];
            else if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean')
                return ['-j', this.numJobs.toString()];
            else if (/Visual Studio/.test(gen))
                return ['/m', '/property:GenerateFullPaths=true'];
            else
                return [];
        })();
        this._channel.show();
        this.statusMessage = `Building ${target}...`;
        const result = await this.executeCMakeCommand([
            '--build', this.binaryDir,
            '--target', target,
            '--config', this.selectedBuildType || 'Debug',
        ]
            .concat(config.buildArgs)
            .concat([
                '--'
            ]
                .concat(generator_args)
                .concat(config.buildToolArgs)
            ),
            {
                silent: false,
                environment: config.buildEnvironment,
            },
            (config.parseBuildDiagnostics
                ? new BuildParser(this.binaryDir,
                                  config.enableOutputParsers,
                                  this.activeGenerator)
                : new util.NullParser())
        );
        this.statusMessage = 'Ready';
        if (!result.retc) {
            await this._refreshAll();
        }
        return result.retc;
    }

    public install() {
        return this.build('install');
    }

    public clean() {
        return this.build('clean');
    }

    public async cleanConfigure(): Promise<Number> {
        const build_dir = this.binaryDir;
        const cache = this.cachePath;
        const cmake_files = path.join(build_dir, 'CMakeFiles');
        if (await async.exists(cache)) {
            this._channel.appendLine('[vscode] Removing ' + cache);
            await async.unlink(cache);
        }
        if (await async.exists(cmake_files)) {
            this._channel.appendLine('[vscode] Removing ' + cmake_files);
            await util.rmdir(cmake_files);
        }
        return await this.configure();
    }

    public async jumpToCacheFile(): Promise<Maybe<vscode.TextEditor>> {
        if (!(await async.exists(this.cachePath))) {
            const do_conf = !!(await vscode.window.showErrorMessage('This project has not yet been configured.', 'Configure Now'));
            if (do_conf) {
                if (await this.configure() !== 0)
                    return null;
            }
        }

        const cache = await vscode.workspace.openTextDocument(this.cachePath);
        return await vscode.window.showTextDocument(cache);
    }

    public async cleanRebuild(): Promise<Number> {
        const clean_result = await this.clean();
        if (clean_result)
            return clean_result;
        return await this.build();
    }

    public async buildWithTarget(): Promise<Number> {
        const target = await this.showTargetSelector();
        if (target === null || target === undefined)
            return -1;
        return await this.build(target);
    }

    public async setDefaultTarget() {
        const new_default = await this.showTargetSelector();
        if (!new_default)
            return;
        this.defaultBuildTarget = new_default;
    }

    public async setBuildTypeWithoutConfigure(): Promise<boolean> {
        const variants =
            Array.from(this.buildVariants.entries()).map(
                ([key, variant]) =>
                    Array.from(variant.choices.entries()).map(
                        ([value_name, value]) => ({
                            settingKey: key,
                            settingValue: value_name,
                            settings: value
                        })
                    )
            );
        const product = util.product(variants);
        const items = product.map(
            optionset => ({
                label: optionset.map(
                    o => o.settings['oneWordSummary$']
                        ? o.settings['oneWordSummary$']
                        : `${o.settingKey}=${o.settingValue}`
                ).join('+'),
                keywordSettings: new Map<string, string>(
                    optionset.map(
                        param => [param.settingKey, param.settingValue] as [string, string]
                    )
                ),
                description: optionset.map(o => o.settings['description$']).join(' + '),
            })
        );
        const chosen: util.VariantCombination = await vscode.window.showQuickPick(items);
        if (!chosen)
            return false; // User cancelled
        this.activeVariantCombination = chosen;
        const old_build_path = this.binaryDir;
        if (this.binaryDir !== old_build_path) {
            await this._setupCMakeCacheWatcher();
        }
        return true;
    }

    public async setBuildType(): Promise<Number> {
        const do_configure = await this.setBuildTypeWithoutConfigure();
        if (do_configure) {
            return await this.configure();
        } else {
            return -1;
        }
    }

    public async debugTarget() {
        if (!this.executableTargets.length) {
            vscode.window.showWarningMessage('No targets are available for debugging. Be sure you have included CMakeToolsHelpers in your CMake project.');
            return;
        }
        const target = this.executableTargets.find(e => e.name === this.currentDebugTarget);
        if (!target) {
            vscode.window.showErrorMessage(`The current debug target "${this.currentDebugTarget}" no longer exists. Select a new target to debug.`);
            return;
        }
        const build_retc = await this.build(target.name);
        if (build_retc !== 0)
            return;
        const real_config = {
            name: `Debugging Target ${target.name}`,
            type: (this.compilerId && this.compilerId.includes('MSVC'))
                ? 'cppvsdbg'
                : 'cppdbg',
            request: 'launch',
            cwd: '${workspaceRoot}',
            args: [],
            MIMode: process.platform === 'darwin' ? 'lldb' : 'gdb',
        };
        const user_config = config.debugConfig;
        Object.assign(real_config, user_config);
        real_config['program'] = target.path;
        console.log(JSON.stringify(real_config));
        return vscode.commands.executeCommand('vscode.startDebug', real_config);
    }

    public async selectDebugTarget() {
        if (!this.executableTargets) {
            vscode.window.showWarningMessage('No targets are available for debugging. Be sure you have included the CMakeToolsProject in your CMake project.');
            return;
        }
        const target = await vscode.window.showQuickPick(
            this.executableTargets.map(e => ({
                label: e.name,
                description: e.path,
            })));
        if (!target) {
            return;
        }
        this.currentDebugTarget = target.label;
    }

    public async ctest(): Promise<Number> {
        this._channel.show();
        this.failingTestDecorations = [];
        const build_retc = await this.build();
        if (build_retc !== 0) {
            return build_retc;
        }
        const retc = (
            await this.executeCMakeCommand(
                [
                    '-E', 'chdir', this.binaryDir,
                    'ctest', '-j' + this.numCTestJobs,
                    '-C', this.selectedBuildType || 'Debug',
                    '-T', 'test',
                    '--output-on-failure',
                ].concat(config.ctestArgs),
                {
                    silent: false,
                    environment: config.testEnvironment,
                },
                (config.parseBuildDiagnostics
                    ? new BuildParser(this.binaryDir,
                                      ["cmake"],
                                      this.activeGenerator)
                    : new util.NullParser())
            )
        ).retc;
        await this._refreshTests();
        this._ctestChannel.clear();
        if (this.testResults) {
            for (const test of this.testResults.Site.Testing.Test.filter(t => t.Status === 'failed')) {
                this._ctestChannel.append(
                    `The test "${test.Name}" failed with the following output:\n` +
                    '----------' + '-----------------------------------' + Array(test.Name.length).join('-') +
                    `\n${test.Output.trim().split('\n').map(line => '    ' + line).join('\n')}\n`
                );
                // Only show the channel when a test fails
                this._ctestChannel.show();
            }
        }
        return retc;
    }

    public async quickStart(): Promise<Number> {
        if (await async.exists(this.mainListFile)) {
            vscode.window.showErrorMessage('This workspace already contains a CMakeLists.txt!');
            return -1;
        }

        const project_name = await vscode.window.showInputBox({
            prompt: 'Enter a name for the new project',
            validateInput: (value: string): string => {
                if (!value.length)
                    return 'A project name is required';
                return '';
            },
        });
        if (!project_name)
            return -1;

        const target_type = (await vscode.window.showQuickPick([
            {
                label: 'Library',
                description: 'Create a library',
            }, {
                label: 'Executable',
                description: 'Create an executable'
            }
        ]));

        if (!target_type)
            return -1;

        const type = target_type.label;

        const init = [
            'cmake_minimum_required(VERSION 3.0.0)',
            `project(${project_name} VERSION 0.0.0)`,
            '',
            'include(CTest)',
            'enable_testing()',
            '',
            {
                Library: `add_library(${project_name} ${project_name}.cpp)`,
                Executable: `add_executable(${project_name} main.cpp)`,
            }[type],
            '',
            'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
            'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
            'include(CPack)',
            '',
        ].join('\n');

        if (type === 'Library') {
            if (!(await async.exists(path.join(this.sourceDir, project_name + '.cpp')))) {
                await util.writeFile(
                    path.join(this.sourceDir, project_name + '.cpp'),
                    [
                        '#include <iostream>',
                        '',
                        `void say_hello(){ std::cout << "Hello, from ${project_name}!\\n"; }`,
                        '',
                    ].join('\n')
                );
            }
        } else {
            if (!(await async.exists(path.join(this.sourceDir, 'main.cpp')))) {
                await util.writeFile(
                    path.join(this.sourceDir, 'main.cpp'),
                    [
                        '#include <iostream>',
                        '',
                        'int main(int, char**)',
                        '{',
                        '   std::cout << "Hello, world!\\n";',
                        '}',
                        '',
                    ].join('\n')
                );
            }
        }
        await util.writeFile(this.mainListFile, init);
        const doc = await vscode.workspace.openTextDocument(this.mainListFile);
        await vscode.window.showTextDocument(doc);
        return this.configure();
    }

    public async stop(): Promise<boolean> {
        const child = this.currentChildProcess;
        if (!child)
            return false;
        // Stopping the process isn't as easy as it may seem. cmake --build will
        // spawn child processes, and CMake won't forward signals to its
        // children. As a workaround, we list the children of the cmake process
        // and also send signals to them.
        await this._killTree(child.pid);
        return true;
    }

    public async _killTree(pid: number) {
        if (process.platform !== 'win32') {
            let children: number[] = [];
            const stdout = (await async.execute('pgrep', ['-P', pid.toString()])).stdout.trim();
            if (!!stdout.length) {
                children = stdout.split('\n').map(line => Number.parseInt(line));
            }
            for (const other of children) {
                if (other)
                    await this._killTree(other);
            }
            process.kill(pid, 'SIGINT');
        } else {
            // Because reasons, Node's proc.kill doesn't work on killing child
            // processes transitively. We have to do a sad and manually kill the
            // task using taskkill.
            proc.exec('taskkill /pid ' + pid.toString() + ' /T /F');
        }
    }
}

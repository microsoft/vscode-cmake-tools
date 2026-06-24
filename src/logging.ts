/**
 * Logging utilities
 */ /** */

import * as node_fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/** Logging levels */
enum LogLevel {
    Trace,
    Debug,
    Info,
    Note,
    Warning,
    Error,
    Fatal,
}

export type RevealLogKey = 'always' | 'never' | 'focus' | 'error';

/**
 * Get the name of a logging level
 * @param level A logging level
 */
function levelName(level: LogLevel): LogLevelKey {
    switch (level) {
        case LogLevel.Trace:
            return 'trace';
        case LogLevel.Debug:
            return 'debug';
        case LogLevel.Info:
            return 'info';
        case LogLevel.Note:
            return 'note';
        case LogLevel.Warning:
            return 'warning';
        case LogLevel.Error:
            return 'error';
        case LogLevel.Fatal:
            return 'fatal';
    }
}

/**
 * Determine if logging is enabled for the given LogLevel
 * @param level The log level to check
 */
function levelEnabled(level: LogLevel): boolean {
    const strlevel = vscode.workspace.getConfiguration('cmake').get<LogLevelKey>('loggingLevel', 'info');
    switch (strlevel) {
        case 'trace':
            return level >= LogLevel.Trace;
        case 'debug':
            return level >= LogLevel.Debug;
        case 'info':
            return level >= LogLevel.Info;
        case 'note':
            return level >= LogLevel.Note;
        case 'warning':
            return level >= LogLevel.Warning;
        case 'error':
            return level >= LogLevel.Error;
        case 'fatal':
            return level >= LogLevel.Fatal;
        default:
            console.error('Invalid logging level in settings.json');
            return true;
    }
}

/**
 * Manages output channels.
 *
 * Ask the output channel manager when you want to get an output channel for a
 * particular name.
 */
class OutputChannelManager implements vscode.Disposable {
    /**
     * Channels that this manager knows about
     */
    private readonly _channels = new Map<string, vscode.OutputChannel>();

    /**
     * Get the single instance of a channel with the given name. If the channel
     * doesn't exist, it will be created and returned.
     * @param name The name of the channel to obtain
     */
    get(name: string) {
        const channel = this._channels.get(name);
        if (!channel) {
            const new_channel = vscode.window.createOutputChannel(name);
            this._channels.set(name, new_channel);
            return new_channel;
        }
        return channel;
    }

    /**
     * Dispose all channels created by this manager
     */
    dispose() {
        util.map(this._channels.values(), c => c.dispose());
    }
}

export const channelManager = new OutputChannelManager();

interface Stringable {
    toString(): string;
    toLocaleString(): string;
}

let _LOGGER: NodeJS.WritableStream;

function logFilePath(): string {
    return path.join(paths.dataDir, 'log.txt');
}

async function _openLogFile() {
    if (!_LOGGER) {
        const fpath = logFilePath();
        await fs.mkdir_p(path.dirname(fpath));
        if (await fs.exists(fpath)) {
            _LOGGER = node_fs.createWriteStream(fpath, { flags: 'r+' });
        } else {
            _LOGGER = node_fs.createWriteStream(fpath, { flags: 'w' });
        }
    }
    return _LOGGER;
}

/**
 * Manages and controls logging
 */
class SingletonLogger {
    private readonly _logStream = _openLogFile();

    private get _channel() {
        return channelManager.get(`CMake/${localize("build.logging.title", "Build")}`);
    }

    private _log(level: LogLevel, ...args: Stringable[]) {
        this._emit(level, true, args);
    }

    /** Like the level methods, but writes to the file/console only — never the Output channel. */
    infoFileOnly(...args: Stringable[]) {
        this._emit(LogLevel.Info, false, args);
    }
    errorFileOnly(...args: Stringable[]) {
        this._emit(LogLevel.Error, false, args);
    }

    private _emit(level: LogLevel, toChannel: boolean, args: Stringable[]) {
        const trace = vscode.workspace.getConfiguration('cmake').get('enableTraceLogging', false);
        if (level === LogLevel.Trace && !trace) {
            return;
        }
        const user_message = args.map(a => a.toString()).join(' ');
        const prefix = new Date().toISOString() + ` [${levelName(level)}]`;
        const raw_message = `${prefix} ${user_message}`;
        switch (level) {
            case LogLevel.Trace:
            case LogLevel.Debug:
            case LogLevel.Info:
            case LogLevel.Note:
                if (process.env['CMT_QUIET_CONSOLE'] !== '1') {
                    console.info('[CMakeTools]', raw_message);
                }
                break;
            case LogLevel.Warning:
                console.warn('[CMakeTools]', raw_message);
                break;
            case LogLevel.Error:
            case LogLevel.Fatal:
                console.error('[CMakeTools]', raw_message);
                break;
        }
        // Write to the logfile asynchronously.
        this._logStream.then(strm => strm.write(raw_message + '\n')).catch(e => {
            console.error('Unhandled error while writing CMakeTools log file', e);
        });
        // Write to our output channel (skipped for file-only messages).
        if (toChannel && levelEnabled(level)) {
            const showTimestamps = vscode.workspace.getConfiguration('cmake').get('showTimestampsInOutput', false);
            this._channel.appendLine(showTimestamps ? raw_message : user_message);
        }
    }

    trace(...args: Stringable[]) {
        this._log(LogLevel.Trace, ...args);
    }
    debug(...args: Stringable[]) {
        this._log(LogLevel.Debug, ...args);
    }
    info(...args: Stringable[]) {
        this._log(LogLevel.Info, ...args);
    }
    note(...args: Stringable[]) {
        this._log(LogLevel.Note, ...args);
    }
    warning(...args: Stringable[]) {
        this._log(LogLevel.Warning, ...args);
    }
    error(...args: Stringable[]) {
        this._log(LogLevel.Error, ...args);
    }
    fatal(...args: Stringable[]) {
        this._log(LogLevel.Fatal, ...args);
    }

    clearOutputChannel(): void {
        this._channel.clear();
    }

    showChannel(preserveFocus?: boolean): void {
        this._channel.show(preserveFocus);
    }

    private static _inst: SingletonLogger | null = null;

    static instance(): SingletonLogger {
        if (SingletonLogger._inst === null) {
            SingletonLogger._inst = new SingletonLogger();
        }
        return SingletonLogger._inst;
    }
}

export class Logger {
    constructor(readonly _tag: string) {}
    get tag() {
        return `[${this._tag}]`;
    }
    trace(...args: Stringable[]) {
        SingletonLogger.instance().trace(this.tag, ...args);
    }
    debug(...args: Stringable[]) {
        SingletonLogger.instance().debug(this.tag, ...args);
    }
    info(...args: Stringable[]) {
        SingletonLogger.instance().info(this.tag, ...args);
    }
    note(...args: Stringable[]) {
        SingletonLogger.instance().note(this.tag, ...args);
    }
    warning(...args: Stringable[]) {
        SingletonLogger.instance().warning(this.tag, ...args);
    }
    error(...args: Stringable[]) {
        SingletonLogger.instance().error(this.tag, ...args);
    }
    /** Log at Info/Error level to the file and developer console only — never the Output channel. */
    infoFileOnly(...args: Stringable[]) {
        SingletonLogger.instance().infoFileOnly(this.tag, ...args);
    }
    errorFileOnly(...args: Stringable[]) {
        SingletonLogger.instance().errorFileOnly(this.tag, ...args);
    }
    fatal(...args: Stringable[]) {
        SingletonLogger.instance().fatal(this.tag, ...args);
    }

    clearOutputChannel() {
        SingletonLogger.instance().clearOutputChannel();
    }

    showChannel(error_to_show?: boolean, isAutomatic?: boolean) {
        const config = vscode.workspace.getConfiguration('cmake');
        const reveal_log = config.get<RevealLogKey>('revealLog', 'always');
        const reveal_on_automatic = config.get<boolean>('revealLogOnAutomaticTrigger', false);

        const decision = decideReveal(reveal_log, error_to_show, isAutomatic ?? false, reveal_on_automatic);
        if (decision.shouldShow) {
            SingletonLogger.instance().showChannel(decision.preserveFocus);
        }
    }

    static logTestName(suite?: string, test?: string) {
        SingletonLogger.instance().info('-----------------------------------------------------------------------');
        SingletonLogger.instance().info(`Beginning test: ${suite ?? 'unknown suite'} - ${test ?? 'unknown test'}`);
    }
}

export function createLogger(tag: string) {
    return new Logger(tag);
}

/**
 * Decide, based on the `cmake.revealLog` setting, whether a surface (the Output
 * channel or the colorized build terminal) should be revealed, and whether it
 * should take focus, returning the colorized-build-terminal friendly `{ show, focus }`
 * shape. Thin wrapper over {@link decideReveal} (which the Output-channel reveal in
 * `showChannel` also uses), so the terminal honors `cmake.revealLog` and
 * `cmake.revealLogOnAutomaticTrigger` exactly as the Output channel does.
 */
export function revealLogDecision(error_to_show?: boolean, isAutomatic: boolean = false): { show: boolean; focus: boolean } {
    const config = vscode.workspace.getConfiguration('cmake');
    const reveal_log = config.get<RevealLogKey>('revealLog', 'always');
    const reveal_on_automatic = config.get<boolean>('revealLogOnAutomaticTrigger', false);
    const decision = decideReveal(reveal_log, error_to_show, isAutomatic, reveal_on_automatic);
    return { show: decision.shouldShow, focus: !decision.preserveFocus };
}

/**
 * Pure decision logic for revealing the CMake output, factored out so it can be
 * unit-tested without a VS Code instance.
 *
 * @param revealLog The `cmake.revealLog` value, controlling *how* a reveal happens.
 * @param errorToShow When defined, indicates a build/configure result: `true` for failure.
 *                    A failure reveal (`true`) always surfaces and is never gated.
 * @param isAutomatic Whether the operation was triggered automatically/programmatically
 *                    (e.g. configure-on-open, auto-reconfigure, or a build/test invoked through
 *                    the CMake Tools API by another extension such as the C/C++ DevTools
 *                    companion acting for Copilot) rather than by an explicit user action.
 * @param revealOnAutomatic The `cmake.revealLogOnAutomaticTrigger` value. When `false`,
 *                    automatic/programmatic proactive reveals are suppressed so they don't
 *                    switch the panel away from a terminal the user is working in.
 */
export function decideReveal(revealLog: RevealLogKey, errorToShow: boolean | undefined, isAutomatic: boolean, revealOnAutomatic: boolean): { shouldShow: boolean; preserveFocus: boolean } {
    const isFailureReveal = errorToShow === true;
    // Suppress the proactive reveal for automatic/programmatic operations unless the user
    // opts in. Failures (errorToShow === true) always surface so errors are never hidden.
    if (isAutomatic && !isFailureReveal && !revealOnAutomatic) {
        return { shouldShow: false, preserveFocus: true };
    }

    let shouldShow: boolean = false;
    if (revealLog === 'always') {
        shouldShow = true;
    }
    // won't show if no target information
    if (revealLog === 'error' && errorToShow !== undefined) {
        shouldShow = errorToShow;
    }
    const shouldFocus = (revealLog === 'focus');
    if (shouldFocus) {
        shouldShow = true;
    }
    return { shouldShow, preserveFocus: !shouldFocus };
}

export async function showLogFile(): Promise<void> {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(logFilePath()));
}

// The imports aren't needed immediately, so we can drop them all the way down
// here since we may have circular imports
import * as util from './util';
import { fs } from './pr';
import { LogLevelKey } from './config';
import paths from './paths';

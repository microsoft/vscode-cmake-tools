/* eslint-disable no-unused-expressions */

/**
 * Wrappers and utilities around the NodeJS `child_process` module.
 */

import * as proc from 'child_process';
import * as iconv from 'iconv-lite';

import { createLogger } from './logging';
import rollbar from './rollbar';
import * as util from './util';
import * as nls from 'vscode-nls';
import { Environment, EnvironmentUtils } from './environmentVariables';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('proc');

/**
 * Return value for items that have progress information
 */
export interface ProgressData {
    /**
     * Minimum progress value
     */
    minimum: number;

    /**
     * Maximum progress value
     */
    maximum: number;

    /**
     * The current progress value. Should be in [minimum, maximum)
     */
    value: number;
}

/**
 * Interface for objects that can consume line-based output
 */
export interface OutputConsumer {
    /**
     * Handle a line of output
     *
     * @param line The line of output to process
     */
    output(line: string): void;

    /**
     * Handle a line of error
     *
     * @param error the line of stderr to process
     */
    error(error: string): void;
}

/**
 * Represents an executing subprocess
 */
export interface Subprocess {
    result: Promise<ExecutionResult>;
    child: proc.ChildProcess | undefined;
}

export interface BuildCommand {
    command: string;
    args?: string[];
    build_env?: Environment;
}

export interface DebuggerEnvironmentVariable { name: string; value: string }

/**
 * The result of executing a program.
 */
export interface ExecutionResult {
    /**
     * The return code of the program.
     */
    retc: number | null;
    /**
     * The full standard output of the program. May be `` if standard out
     * was not captured.
     */
    stdout: string;
    /**
     * Standard error output of the program. May be `` if standard error was
     * not captured
     */
    stderr: string;
}

export interface ExecutionOptions {
    environment?: Environment;
    shell?: boolean | string;
    silent?: boolean;
    cwd?: string;
    encoding?: BufferEncoding;
    outputEncoding?: string;
    overrideLocale?: boolean;
    timeout?: number;
    showOutputOnError?: boolean;
}

export function buildCmdStr(command: string, args?: string[]): string {
    let cmdarr = [command];
    if (args) {
        cmdarr = cmdarr.concat(args);
    }
    return cmdarr.map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a).join(' ');
}

export function determineShell(command: string): string | boolean {
    if (command.endsWith('.cmd') || command.endsWith('.bat')) {
        return 'cmd';
    }

    if (command.endsWith('.ps1')) {
        return 'powershell';
    }

    return false;
}

/**
 * Execute a command and return the result
 * @param command The binary to execute
 * @param args The arguments to pass to the binary
 * @param outputConsumer An output consumer for the command execution
 * @param options Additional execution options
 *
 * @note Output from the command is accumulated into a single buffer: Commands
 * which produce a lot of output should be careful about memory constraints.
 */
export function execute(command: string, args?: string[], outputConsumer?: OutputConsumer | null, options?: ExecutionOptions): Subprocess {
    if (!options) {
        options = {};
    }
    const localeOverride = EnvironmentUtils.create({
        LANG: "C",
        LC_ALL: "C"
    });
    const final_env = EnvironmentUtils.merge([
        process.env,
        options.environment,
        options.overrideLocale ? localeOverride : {}]);

    const cmdstr = buildCmdStr(command, args);
    if (options && options.silent !== true) {
        log.info(// We do simple quoting of arguments with spaces.
            // This is only shown to the user,
            // and doesn't have to be 100% correct.
            localize('executing.command', 'Executing command: {0}', cmdstr));
        if (options.environment) {
            log.debug(localize('execution.environment', '  with environment: {0}', JSON.stringify(final_env)));
        }
    }

    if (process.platform === "win32" && options.shell === undefined) {
        options.shell = determineShell(command);
    }

    const spawn_opts: proc.SpawnOptions = {
        env: final_env,
        shell: !!options.shell
    };
    if (options?.cwd !== undefined) {
        util.createDirIfNotExistsSync(options.cwd);
        spawn_opts.cwd = options.cwd;
    }
    if (options?.timeout) {
        spawn_opts.timeout = options.timeout;
    }

    let child: proc.ChildProcess | undefined;

    // Since we won't be sending anything to this process, close its stdin.
    spawn_opts.stdio = ['ignore', 'pipe', 'pipe'];
    try {
        child = proc.spawn(command, args ?? [], spawn_opts);
    } catch {
        child = undefined;
    }
    if (!child) {
        return {
            child: undefined,
            result: Promise.resolve({
                retc: -1,
                stdout: "",
                stderr: ""
            })
        };
    }

    if (options.encoding) {
        child.stdout?.setEncoding(options.encoding);
    }

    const encoding = options.outputEncoding && iconv.encodingExists(options.outputEncoding) ? options.outputEncoding : 'utf8';
    const accumulate = (str1: string, str2: string) => {
        try {
            return str1 + str2;
        } catch {
            // If the resulting string is longer than can be represented by `string.length`, an exception will be thrown.
            // Don't accumulate any more content at this point.
            return str1;
        }
    };

    const result = new Promise<ExecutionResult>(resolve => {
        let stdout_acc = '';
        let line_acc = '';
        let stderr_acc = '';
        let stderr_line_acc = '';
        child?.on('error', err => {
            log.warning(localize({key: 'process.error', comment: ['The space before and after all placeholders should be preserved.']}, 'The command: {0} failed with error: {1}', `${cmdstr}`, `${err}`));
        });
        child?.on('exit', (code, signal) => {
            if (code !== 0) {
                if (signal !== null && signal !== undefined) {
                    log.warning(localize({key: 'process.exit.with.signal', comment: ['The space before and after all placeholders should be preserved.']}, 'The command: {0} exited with code: {1} and signal: {2}', `${cmdstr}`, `${code}`, `${signal}`));
                } else {
                    log.warning(localize({key: 'process.exit', comment: ['The space before and after all placeholders should be preserved.']}, 'The command: {0} exited with code: {1}', `${cmdstr}`, `${code}`));
                }
                if (options?.showOutputOnError) {
                    if (stdout_acc) {
                        const output = stdout_acc.trimEnd().replace(/\n/g, '\n\t');
                        log.warning(localize('process.exit.stdout', 'Command output on standard out: {0}', `${output}`));
                    }
                    if (stderr_acc) {
                        const output = stderr_acc.trimEnd().replace(/\n/g, '\n\t');
                        log.warning(localize('process.exit.stderr', 'Command output on standard error: {0}', `${output}`));
                    }
                }
            }
        });
        child?.stdout?.on('data', (data: Uint8Array) => {
            rollbar.invoke(localize('processing.data.event.stdout', 'Processing {0} event from proc stdout', "\"data\""), { data, command, args }, () => {
                const str = iconv.decode(Buffer.from(data), encoding);
                const lines = str.split('\n').map(l => l.endsWith('\r') ? l.substr(0, l.length - 1) : l);
                while (lines.length > 1) {
                    line_acc = accumulate(line_acc, lines[0]);
                    if (outputConsumer) {
                        outputConsumer.output(line_acc);
                    } else if (util.isTestMode()) {
                        log.info(line_acc);
                    }
                    line_acc = '';
                    // Erase the first line from the list
                    lines.splice(0, 1);
                }
                console.assert(lines.length, 'Invalid lines', JSON.stringify(lines));
                line_acc = accumulate(line_acc, lines[0]);
                stdout_acc = accumulate(stdout_acc, str);
            });
        });
        child?.stderr?.on('data', (data: Uint8Array) => {
            rollbar.invoke(localize('processing.data.event.stderr', 'Processing {0} event from proc stderr', "\"data\""), { data, command, args }, () => {
                const str = iconv.decode(Buffer.from(data), encoding);
                const lines = str.split('\n').map(l => l.endsWith('\r') ? l.substr(0, l.length - 1) : l);
                while (lines.length > 1) {
                    stderr_line_acc = accumulate(stderr_line_acc, lines[0]);
                    if (outputConsumer) {
                        outputConsumer.error(stderr_line_acc);
                    } else if (util.isTestMode() && stderr_line_acc) {
                        log.info(stderr_line_acc);
                    }
                    stderr_line_acc = '';
                    // Erase the first line from the list
                    lines.splice(0, 1);
                }
                console.assert(lines.length, 'Invalid lines', JSON.stringify(lines));
                stderr_line_acc = accumulate(stderr_line_acc, lines[0]);
                stderr_acc = accumulate(stderr_acc, str);
            });
        });
        // The 'close' event is emitted after a process has ended and the stdio streams of a child process have been closed.
        // This is distinct from the 'exit' event, since multiple processes might share the same stdio streams.
        // The 'close' event will always emit after 'exit' was already emitted, or 'error' if the child failed to spawn.
        child?.on('close', retc => {
            try {
                rollbar.invoke(localize('resolving.close.event', 'Resolving process on {0} event', "\"close\""), { line_acc, stderr_line_acc, command, retc }, () => {
                    if (line_acc && outputConsumer) {
                        outputConsumer.output(line_acc);
                    }
                    if (stderr_line_acc && outputConsumer) {
                        outputConsumer.error(stderr_line_acc);
                    }
                    resolve({ retc, stdout: stdout_acc, stderr: stderr_acc });
                });
            } catch (e: any) {
                resolve({ retc, stdout: stdout_acc, stderr: stderr_acc });
            }
        });
    });

    return { child, result };
}

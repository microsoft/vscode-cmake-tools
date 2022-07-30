/* eslint-disable no-unused-expressions */

/**
 * Wrappers and utilities around the NodeJS `child_process` module.
 */

import * as proc from 'child_process';
import * as iconv from 'iconv-lite';

import { createLogger } from './logging';
import rollbar from './rollbar';
import * as util from './util';

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ExecutionResult } from './api';
import { Environment, EnvironmentUtils } from './environmentVariables';
export { ExecutionResult } from './api';

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

export interface ExecutionOptions {
    environment?: Environment;
    shell?: boolean;
    silent?: boolean;
    cwd?: string;
    encoding?: BufferEncoding;
    outputEncoding?: string;
    useTask?: boolean;
    overrideLocale?: boolean;
    timeout?: number;
}

export function buildCmdStr(command: string, args?: string[]): string {
    let cmdarr = [command];
    if (args) {
        cmdarr = cmdarr.concat(args);
    }
    return cmdarr.map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a).join(' ');
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
    const cmdstr = buildCmdStr(command, args);
    if (options && options.silent !== true) {
        log.info(// We do simple quoting of arguments with spaces.
            // This is only shown to the user,
            // and doesn't have to be 100% correct.
            localize('executing.command', 'Executing command: {0}', cmdstr));
    }
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

    const spawn_opts: proc.SpawnOptions = {
        env: final_env,
        shell: !!options.shell
    };
    if (options && options.cwd) {
        spawn_opts.cwd = options.cwd;
    }
    let child: proc.ChildProcess | undefined;
    let result: Promise<ExecutionResult>;
    const useTask = (options && options.useTask) ? options.useTask : false;
    if (useTask) {
        // child = undefined;
        // const term = vscode.window.createTerminal("Cmake Build");
        // term.show(true);
        // term.sendText(cmdstr);

        void vscode.commands.executeCommand("workbench.action.tasks.build");

        result = new Promise<ExecutionResult>((resolve) => {
            resolve({ retc: 0, stdout: '', stderr: '' });
        });
    } else {
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
        const child2: proc.ChildProcess = child;

        // Since we won't be sending anything to this process, close stdin.
        child2.stdin?.end();

        if (options.encoding) {
            child2.stdout?.setEncoding(options.encoding);
        }

        const encoding = options.outputEncoding && iconv.encodingExists(options.outputEncoding) ? options.outputEncoding : 'utf8';

        result = new Promise<ExecutionResult>(resolve => {
            let stdout_acc = '';
            let line_acc = '';
            let stderr_acc = '';
            let stderr_line_acc = '';
            let timeoutId: NodeJS.Timeout;
            let withinStdoutData: boolean = false;
            let withinStderrData: boolean = false;
            let startedStdoutData: boolean = false;
            let startedStderrData: boolean = false;
            let startedLamba1: boolean = false;
            let startedLamba2: boolean = false;
            if (options?.timeout) {
                timeoutId = setTimeout(() => {
                    log.warning(localize('process.timeout', 'The command timed out: {0}', `${cmdstr}`));
                    if (startedStderrData) {
                        log.warning('stderr had started before timeout');
                    }
                    if (startedStdoutData) {
                        log.warning('stdout had started before timeout');
                    }
                    if (withinStderrData) {
                        log.warning('stderr incomplete');
                    }
                    if (withinStdoutData) {
                        log.warning('stdout incomplete');
                    }
                    if (startedLamba1) {
                        log.warning('lambda 1 ran');
                    } else {
                        log.warning('lambda 1 never ran');
                    }
                    if (startedLamba2) {
                        log.warning('lambda 2 ran');
                    } else {
                        log.warning('lambda 2 never ran');
                    }
                    child2.kill("SIGKILL");
                    log.warning('after process is killed');
                    log.warning(`timeout << stdout: ${stdout_acc} , stderr: ${stderr_acc} >>`);
                    resolve({retc: -1, stdout: stdout_acc, stderr: stderr_acc });
                }, options?.timeout);
            }
            child2.on('error', err => {
                log.warning(localize('process.error', 'The command threw error: {0}', `${cmdstr}`));
                resolve({ retc: -1, stdout: "", stderr: err.message ?? '' });
            });
            child2.on('exit', (code, signal) => {
                if (code !== 0) {
                    log.warning(localize('process.stopped', 'The command: {0} exited with code: {1} and signal: {2}', `${cmdstr}`, `${code}`, `${signal}`));
                    log.warning(`exit << stdout: ${stdout_acc} , stderr: ${stderr_acc} >>`);
                }
                if (options?.timeout) {
                    clearTimeout(timeoutId);
                }
                resolve({retc: code, stdout: stdout_acc, stderr: stderr_acc });
            });
            child2.stdout?.on('data', (data: Uint8Array) => {
                withinStdoutData = true;
                startedStdoutData = true;
                try {
                    rollbar.invoke(localize('processing.data.event.stdout', 'Processing "data" event from proc stdout'), { data, command, args }, () => {
                        startedLamba1 = true;
                        try {
                            const str = iconv.decode(Buffer.from(data), encoding);
                            const lines = str.split('\n').map(l => l.endsWith('\r') ? l.substr(0, l.length - 1) : l);
                            while (lines.length > 1) {
                                line_acc += lines[0];
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
                            line_acc += lines[0];
                            stdout_acc += str;
                        } catch (err: any) {
                            log.warning(`caught an exception in rollbar.invoke() lambda 1:  ${err}`);
                        }
                    });
                } catch (err: any) {
                    log.warning(`2 close stdout rollbar error:  ${err}`);
                }
                withinStdoutData = false;
            });
            child2.stderr?.on('data', (data: Uint8Array) => {
                withinStderrData = true;
                startedStderrData = true;
                try {
                    rollbar.invoke(localize('processing.data.event.stderr', 'Processing "data" event from proc stderr'), { data, command, args }, () => {
                        startedLamba2 = true;
                        try {
                            const str = iconv.decode(Buffer.from(data), encoding);
                            const lines = str.split('\n').map(l => l.endsWith('\r') ? l.substr(0, l.length - 1) : l);
                            while (lines.length > 1) {
                                stderr_line_acc += lines[0];
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
                            stderr_line_acc += lines[0];
                            stderr_acc += str;
                        } catch (err: any) {
                            log.warning(`caught an exception in rollbar.invoke() lambda 2:  ${err}`);
                        }
                    });
                } catch (err: any) {
                    log.warning(`2 close stderr rollbar error:  ${err}`);
                }
                withinStderrData = false;
            });
            // Don't stop until the child stream is closed, otherwise we might not read
            // the whole output of the command.
            child2.on('close', retc => {
                try {
                    if (options?.timeout) {
                        clearTimeout(timeoutId);
                    }
                    rollbar.invoke(localize('resolving.close.event', 'Resolving process on "close" event'), { line_acc, stderr_line_acc, command, retc }, () => {
                        if (line_acc && outputConsumer) {
                            outputConsumer.output(line_acc);
                        }
                        if (stderr_line_acc && outputConsumer) {
                            outputConsumer.error(stderr_line_acc);
                        }
                        resolve({ retc, stdout: stdout_acc, stderr: stderr_acc });
                    });
                } catch (err: any) {
                    log.warning(`2 close rollbar error:  ${err}`);
                    resolve({ retc, stdout: stdout_acc, stderr: stderr_acc });
                }
            });
        });
    }
    return { child, result };
}

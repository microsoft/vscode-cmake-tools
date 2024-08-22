/**
 * Wrapper around Rollbar, for error reporting.
 */

import * as logging from './logging';
import * as nls from 'vscode-nls';
import * as path from 'path';
import { logEvent } from './telemetry';
import * as lodash from "lodash";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('rollbar');

function stringifyReplacer(key: any, value: any) {
    if (key === "extensionContext") {
        return undefined;
    }

    return value;
}

/**
 * Remove filesystem information from stack traces before logging telemetry
 * @param stack The call stack string
 * @returns A cleaned stack trace with only file names (no full paths)
 */
export function cleanStack(stack?: string): string {
    if (!stack) {
        return "(no callstack)";
    }
    // Most source references are within parenthesis
    stack = stack.replace(/\(([^\n]+)\)/g, (match: string, fileInfo: string) => {
        const fileName = fileInfo.replace(/:\d+(:\d+)?$/, "");
        const name: string = path.basename(fileName);
        return match.replace(fileName, name);
    });
    // Some are direct references to main.js without parenthesis
    stack = stack.replace(/at( async | )([^\n]+main.js(:\d+(:\d+)?)?)$/gm, (match: string, _unused: string, fileInfo: string, lineColumn: string) => match.replace(fileInfo, `main.js${lineColumn}`));
    // As a last resort, remove anything that looks like it could be a path.
    const strings: string[] = stack.split('\n');
    strings.forEach((value, index, array) => {
        array[index] = cleanString(value);
    });
    return strings.join('\n');
}

/**
 * Find the beginning of a potential absolute path and cut off everything after it
 * @param message The (single-line) string to clean
 * @returns A string with no potential absolute file paths in it
 */
export function cleanString(message?: string): string {
    if (!message) {
        return 'No message provided';
    }
    const backSlash = message.indexOf('\\');
    const slash = message.indexOf('/');
    let first = backSlash === -1 ? slash : slash === -1 ? backSlash : backSlash < slash ? backSlash : slash;
    if (first > 0) {
        first = message.lastIndexOf(' ', first);
        return message.substr(0, first) + " <path removed>";
    }
    return message;
}

/**
 * The wrapper around Rollbar. Presents a nice functional API.
 */
class RollbarController {
    /**
     * Log an exception with Rollbar.
     * @param what A message about what we were doing when the exception happened
     * @param exception The exception object
     * @param additional Additional items in the payload
     * @returns The LogResult if we are enabled. `null` otherwise.
     */
    exception(what: string, exception: Error, additional: object = {}): void {
        try {
            log.fatal(localize('unhandled.exception', 'Unhandled exception: {0}', what), exception, JSON.stringify(additional, (key, value) => stringifyReplacer(key, value)));
        } catch (e) {
            log.fatal(localize('unhandled.exception', 'Unhandled exception: {0}', what), exception, lodash.toString(additional));
        }
        const callstack = cleanStack(exception.stack);
        const message = cleanString(exception.message);
        logEvent('exception2', { message, callstack });
        console.error(exception);
        // debugger;
    }

    /**
     * Log an error with Rollbar
     * @param what A message about what we were doing when the error happened
     * @param additional Additional items in the payload
     * @returns The LogResult if we are enabled. `null` otherwise.
     */
    error(what: string, additional: object = {}): void {
        log.error(what, JSON.stringify(additional, (key, value) => stringifyReplacer(key, value)));
        debugger;
    }

    info(what: string, additional: object = {}): void {
        log.info(what, JSON.stringify(additional, (key, value) => stringifyReplacer(key, value)));
    }

    /**
     * Invoke an asynchronous function, and catch any promise rejects.
     * @param what Message about what we are doing
     * @param additional Additional data to log
     * @param func The block to call
     */
    invokeAsync<T>(what: string, additional: object, func: () => Thenable<T>): void;
    invokeAsync<T>(what: string, func: () => Thenable<T>): void;
    invokeAsync<T>(what: string, additional: object, func?: () => Thenable<T>): void {
        if (!func) {
            func = additional as () => Thenable<T>;
            additional = {};
        }
        log.trace(localize('invoking.async.function.rollbar', 'Invoking async function [{0}] with Rollbar wrapping [{1}]', func.name, what));
        const pr = func();
        this.takePromise(what, additional, pr);
    }

    /**
     * Invoke a synchronous function, and catch and log any unhandled exceptions
     * @param what Message about what we are doing
     * @param additional Additional data to log
     * @param func The block to call
     */
    invoke<T>(what: string, additional: object, func: () => T): T;
    invoke<T>(what: string, func: () => T): T;
    invoke<T>(what: string, additional: object, func?: () => T): T {
        if (!func) {
            func = additional as () => T;
            additional = {};
        }
        try {
            log.trace(localize('invoking.function.rollbar', 'Invoking function [${0}] with Rollbar wrapping [${1}]', func.name, what));
            return func();
        } catch (e) {
            this.exception(localize('unhandled.exception', 'Unhandled exception: {0}', what), e as Error, additional);
            throw e;
        }
    }

    takePromise<T>(what: string, additional: object, pr: Thenable<T>): void {
        pr.then(
            () => {},
            e => this.exception(localize('unhandled.promise.rejection', 'Unhandled Promise rejection: {0}', what), e, additional)
        );
    }
}

const rollbar = new RollbarController();
export default rollbar;

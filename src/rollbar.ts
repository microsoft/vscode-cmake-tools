/**
 * Wrapper around Rollbar, for error reporting.
 */

import * as logging from './logging';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('rollbar');

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
    log.fatal(localize('unhandled.exception', 'Unhandled exception: {0}', what), exception, JSON.stringify(additional));
    // tslint:disable-next-line
    console.error(exception);
    debugger;
  }

  /**
   * Log an error with Rollbar
   * @param what A message about what we were doing when the error happened
   * @param additional Additional items in the payload
   * @returns The LogResult if we are enabled. `null` otherwise.
   */
  error(what: string, additional: object = {}): void {
    log.error(what, JSON.stringify(additional));
    debugger;
  }

  info(what: string, additional: object = {}): void {
    log.info(what, JSON.stringify(additional));
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
      this.exception(localize('unhandled.exception', 'Unhandled exception: {0}', what), e, additional);
      throw e;
    }
  }

  takePromise<T>(what: string, additional: object, pr: Thenable<T>): void {
    pr.then(
        () => {},
        e => { this.exception(localize('unhandled.promise.rejection', 'Unhandled Promise rejection: {0}', what), e, additional); },
    );
  }
}

const rollbar = new RollbarController();
export default rollbar;

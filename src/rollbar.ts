/**
 * Wrapper around Rollbar, for error reporting.
 */ /** */

import * as vscode from 'vscode';
import Rollbar = require('rollbar');

import * as logging from './logging';

const log = logging.createLogger('rollbar');

/**
 * The wrapper around Rollbar. Presents a nice functional API.
 */
class RollbarController {
  /**
   * The payload to send with any messages. Can be updated via `updatePayload`.
   */
  private readonly _payload: object = {platform: 'client'};

  /**
   * The Rollbar client instance we use to communicate.
   */
  private readonly _rollbar = new Rollbar({
    accessToken: '14d411d713be4a5a9f9d57660534cac7',
    reportLevel: 'error',
    payload: this._payload,
  });

  /**
   * If `true`, we will send messages. We must get the user's permission first!
   */
  private _enabled = false;

  /**
   * Request permission to use Rollbar from the user. This will show a message
   * box at the top of the window on first permission request.
   * @param extensionContext Extension context, where we use a memento to
   * remember our permission
   */
  async requestPermissions(extensionContext: vscode.ExtensionContext): Promise<void> {
    log.debug('Checking Rollbar permissions');
    if (process.env['CMT_TESTING'] === '1') {
      log.warning('Running CMakeTools in test mode. Rollbar is disabled.');
      return;
    }
    if (process.env['CMT_DEVRUN'] === '1') {
      log.warning('Running CMakeTools in developer mode. Rollbar reporting is disabled.');
      return;
    }
    // The memento key where we store permission. Update this to ask again.
    const key = 'rollbar-optin3';
    const optin = extensionContext.globalState.get(key);
    if (optin === true) {
      this._enabled = true;
    } else if (optin == false) {
      this._enabled = false;
    } else if (optin === undefined) {
      log.debug('Asking user for permission to user Rollbar...');
      // We haven't asked yet. Ask them now:
      const item = await vscode.window.showInformationMessage(
          'Would you like to opt-in to send anonymous error and exception data to help improve CMake Tools?',
          {
            title: 'Yes!',
            isCloseAffordance: false,
          } as vscode.MessageItem,
          {
            title: 'No Thanks',
            isCloseAffordance: true,
          } as vscode.MessageItem);

      if (item === undefined) {
        // We didn't get an answer
        log.trace('User did not answer. Rollbar is not enabled.');
        return;
      }
      extensionContext.globalState.update(key, !item.isCloseAffordance);
      this._enabled = !item.isCloseAffordance;
    }
    log.debug('Rollbar enabled? ', this._enabled);
  }

  /**
   * Log an exception with Rollbar.
   * @param what A message about what we were doing when the exception happened
   * @param exception The exception object
   * @param additional Additional items in the payload
   * @returns The LogResult if we are enabled. `null` otherwise.
   */
  exception(what: string, exception: Error, additional: object = {}): Rollbar.LogResult|null {
    log.fatal('Unhandled exception:', what, exception, JSON.stringify(additional));
    // tslint:disable-next-line
    console.error(exception);
    debugger;
    if (this._enabled) {
      return this._rollbar.error(what, exception, additional);
    }
    return null;
  }

  /**
   * Log an error with Rollbar
   * @param what A message about what we were doing when the error happened
   * @param additional Additional items in the payload
   * @returns The LogResult if we are enabled. `null` otherwise.
   */
  error(what: string, additional: object = {}): Rollbar.LogResult|null {
    log.error(what, JSON.stringify(additional));
    debugger;
    if (this._enabled) {
      const stack = new Error().stack;
      return this._rollbar.error(what, additional, {stack});
    }
    return null;
  }

  /**
   * Update the content of the Rollbar payload with additional context
   * information.
   * @param data Daya to merge into the payload
   */
  updatePayload(data: object) {
    Object.assign(this._payload, data);
    this._rollbar.configure({payload: this._payload});
    log.debug('Updated Rollbar payload', JSON.stringify(data));
  }

  /**
   * Invoke an asynchronous function, and catch any promise rejects.
   * @param what Message about what we are doing
   * @param additional Additional data to log
   * @param func The block to call
   */
  invokeAsync<T>(what: string, additional: object, func: () => Promise<T>): void;
  invokeAsync<T>(what: string, func: () => Promise<T>): void;
  invokeAsync<T>(what: string, additional: object, func?: () => Promise<T>): void {
    if (!func) {
      func = additional as () => Promise<T>;
      additional = {};
    }
    log.trace(`Invoking async function [${func.name}] with Rollbar wrapping`, `[${what}]`);
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
      log.trace(`Invoking function [${func.name}] with Rollbar wrapping`, `[${what}]`);
      return func();
    } catch (e) {
      this.exception('Unhandled exception: ' + what, e, additional);
      throw e;
    }
  }

  takePromise<T>(what: string, additional: object, pr: Promise<T>): void {
    pr.catch(e => {
      this.exception('Unhandled Promise rejection: ' + what, e, additional);
      throw e;
    });
  }
}

const rollbar = new RollbarController();
export default rollbar;

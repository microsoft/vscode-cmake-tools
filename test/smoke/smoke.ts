import {Kit, scanForVSKits, SpecialKits, UnspecifiedKit} from '@cmt/kit';
import * as path from 'path';
import * as vscode from 'vscode';

import {CMakeTools} from '../../src/cmake-tools';

type Result<T> = Thenable<T>|T;

class SmokeTestMemento implements vscode.Memento {
  private readonly _date = new Map<string, any>();

  get<T>(key: string): T|undefined;
  get<T>(key: string, defaultValue: T): T;

  get<T>(key: string, defaultValue?: T): T|undefined {
    const value = this._date.get(key) as T | undefined;
    if (value === undefined) {
      return defaultValue;
    }
    return value;
  }

  update(key: string, value: any): Thenable<void> {
    this._date.set(key, value);
    return Promise.resolve();
  }
}

class SmokeTestExtensionContext implements vscode.ExtensionContext {
  constructor(public readonly extensionPath: string) {}

  private readonly _subscriptions: vscode.Disposable[] = [];
  get subscriptions(): vscode.Disposable[] { return this._subscriptions; }

  private readonly _workspaceState = new SmokeTestMemento();
  get workspaceState() { return this._workspaceState; }

  private readonly _globalState = new SmokeTestMemento();
  get globalState() { return this._globalState; }

  asAbsolutePath(sub: string): string { return path.join(this.extensionPath, sub); }

  get storagePath() { return path.join(this.extensionPath, '.smoke-storage'); }

  get logPath() { return path.join(this.extensionPath, '.smoke-logs'); }
}

type TestResult<T> = Thenable<T>|T;

export class SmokeContext {
  constructor(readonly projectDir: vscode.WorkspaceFolder, readonly extensionPath: string) {}

  private readonly _extContext = new SmokeTestExtensionContext(this.extensionPath);

  async createCMakeTools(opts: {kit?: Kit|UnspecifiedKit}): Promise<CMakeTools> {
    const cmt = await CMakeTools.createForDirectory(this.projectDir, this._extContext);
    if (opts.kit) {
      if (opts.kit === SpecialKits.Unspecified) {
        await cmt.setKit({name: SpecialKits.Unspecified});
      } else {
        await cmt.setKit(opts.kit);
      }
    }
    return cmt;
  }

  async withCMakeTools<T>(opts: {kit?: Kit|UnspecifiedKit, run: (cmt: CMakeTools) => TestResult<T>}): Promise<T> {
    const cmt = await this.createCMakeTools(opts);
    try {
      const value = await Promise.resolve(opts.run(cmt));
      return Promise.resolve(value);
    } finally {
      // Clean up. Even on error.
      await cmt.asyncDispose();
    }
  }
}

type SmokeTestFunction = (test: SmokeContext) => Result<void>;

/**
 * The definition of a test.
 */
export class SmokeTest {
  constructor(readonly name: string, readonly fn: SmokeTestFunction) {}
}

/**
 * A fulfilled definition of a suite. Contains the setups, teardowns, and tests
 * of a suite.
 */
export class SmokeSuite {
  constructor(
      readonly name: string,
      readonly setups: SmokeTest[],
      readonly teardowns: SmokeTest[],
      readonly tests: SmokeTest[],
  ) {}
}

class SmokeSuiteTestRegistry {
  constructor(
      private readonly _setups: SmokeTest[],
      private readonly _teardowns: SmokeTest[],
      private readonly _array: SmokeTest[],
  ) {}

  setup(name: string, fn: SmokeTestFunction) { this._setups.push(new SmokeTest(`[setup ${name}]`, fn)); }
  teardown(name: string, fn: SmokeTestFunction) { this._teardowns.push(new SmokeTest(`[teardown ${name}]`, fn)); }
  smokeTest(name: string, fn: SmokeTestFunction) { this._array.push(new SmokeTest(name, fn)); }
}

export type SmokeSuiteFunction = (suite: SmokeSuiteTestRegistry) => Result<void>;

/**
 * Represents the parameters that will be used to define a suite.
 * Call `realize()` to create an instance.
 */
export class SmokeSuiteInit {
  constructor(
      /**
       * The name of the suite.
       */
      readonly name: string,
      /**
       * The definer function
       */
      readonly fn: SmokeSuiteFunction,
  ) {}

  /**
   * Call the smoke test defining function and return the resulting definition
   */
  async realize(): Promise<SmokeSuite> {
    const setups: SmokeTest[] = [];
    const teardowns: SmokeTest[] = [];
    const tests: SmokeTest[] = [];
    const reg = new SmokeSuiteTestRegistry(setups, teardowns, tests);
    await Promise.resolve(this.fn(reg));
    return new SmokeSuite(this.name, setups, teardowns, tests);
  }
}

/**
 * Global class that registers smoke test suites.
 */
export class SmokeSuiteRegistry {
  /**
   * The suite definitions we have so far
   */
  private readonly _suitesInit: SmokeSuiteInit[] = [];

  /**
   * Define a new suite. Doesn't call the init function, just registers it.
   * @param name The name of the suite
   * @param fn The defining callback
   */
  register(name: string, fn: SmokeSuiteFunction): void {
    // Don't call the fn yet, just save the parameters for later realization.
    this._suitesInit.push(new SmokeSuiteInit(name, fn));
  }

  /**
   * Get the initializers for this registry.
   */
  get inits() { return this._suitesInit; }

  /**
   * Clear all registered suites.
   */
  reset() { this._suitesInit.splice(0, this.inits.length); }
}

/**
 * Register a new smoke test suite.
 * @param name The name of the suite to define
 * @param cb The defining callback
 */
export function smokeSuite(name: string, cb: SmokeSuiteFunction): void { SUITE_REGISTRY.register(name, cb); }

/**
 * The global definer.
 */
export const SUITE_REGISTRY = new SmokeSuiteRegistry;

let _VS_KITS_PROMISE: Promise<Kit[]> | null = null;

function getVSKits() {
  if (_VS_KITS_PROMISE === null) {
    _VS_KITS_PROMISE = scanForVSKits();
  }
  return _VS_KITS_PROMISE;
}

export async function smokeTestDefaultKit(): Promise<Kit|UnspecifiedKit> {
  if (process.platform !== 'win32') {
    return SpecialKits.Unspecified as UnspecifiedKit;
  } else {
    const kits = await getVSKits();
    if (kits.length === 0) {
      throw new Error('Cannot smoke test on Windows: We did not find any VS kits');
    }
    return kits[0];
  }
}
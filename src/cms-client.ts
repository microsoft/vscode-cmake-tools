import * as child_proc from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';

import * as cache from './cache';
import config from './config';
import {CMakeGenerator} from './kit';
import {createLogger} from './logging';
import {fs} from './pr';
import * as proc from './proc';
import rollbar from './rollbar';
import * as util from './util';

const log = createLogger('cms-client');

const ENABLE_CMSERVER_PROTO_DEBUG = false;

const MESSAGE_WRAPPER_RE = /\[== "CMake Server" ==\[([^]*?)\]== "CMake Server" ==\]\s*([^]*)/;

export class StartupError extends global.Error {
  constructor(public readonly retc: number) { super('Error starting up cmake-server'); }
}

export interface ProtocolVersion {
  isExperimental: boolean;
  major: number;
  minor: number;
}

/**
 * Summary of the message interfaces:
 *
 * There are interfaces for every type of message that may be sent to/from cmake
 * server. All messages derive from `MessageBase`, which has a single property
 * `type` to represent what type of message it is.
 *
 * Messages which are part of a request/response pair have an additional
 * attribute `cookie`. This is described by the `CookiedMessage` interface. All
 * messages that are part of a request/response pair derive from this interface.
 *
 * Each request/response message type is divided into the part describing its
 * content separate from protocol attributes, and the part describing its
 * protocol attributes.
 *
 * All reply messages derive from `ReplyMessage`, which defines the one
 * attribute `inReplyTo`.
 *
 * Request content interfaces are named with `<type>Request`, and encapsulate
 * the interesting content of the message. The message type corresponding to
 * that content is called `<type>Request`. The response content is
 * encoded in `<type>Content`, and the message is encoded with `<type>Reply`,
 * which inherits from `ReplyMessage` and `<type>Content`.
 */

/**
 * The base of all messages. Each message has a `type` property.
 */
export interface MessageBase {
  type: string;
}

/**
 * Cookied messages represent some on-going conversation.
 */
export interface CookiedMessage extends MessageBase {
  cookie: string;
}

/**
 * Reply messages are solicited by some previous request, which comes with a
 * cookie to identify the initiating request.
 */
export interface ReplyMessage extends CookiedMessage {
  inReplyTo: string;
}

/**
 * Progress messages are sent regarding some long-running request process before
 * the reply is ready.
 */
export interface ProgressMessage extends MessageBase {
  type: 'progress';
  progressMessage: string;
  progressMinimum: number;
  progressCurrent: number;
  progressMaximum: number;
}

export interface SignalMessage extends MessageBase {
  type: 'signal';
  name: string;
}

export interface DirtyMessage extends SignalMessage {
  name: 'dirty';
}

export interface FileChangeMessage {
  name: 'fileChange';
  path: string;
  properties: string[];
}

type SomeSignalMessage = (DirtyMessage|FileChangeMessage);

/**
 * The `MessageMessage` is an un-solicited message from cmake with a string to
 * display to the user.
 */
export interface MessageMessage extends MessageBase {
  type: 'message';
  message: string;
  title: string;
  inReplyTo: string;
}

/**
 * The hello message is sent immediately from cmake-server upon startup.
 */
export interface HelloMessage extends MessageBase {
  type: 'hello';
  supportedProtocolVersions: ProtocolVersion[];
}

/**
 * Handshake is sent as the first thing from the client to set up the server
 * session. It should contain the chosen protocol version and some setup
 * information for the project.
 */
export interface HandshakeParams {
  sourceDirectory?: string;
  buildDirectory: string;
  generator?: string;
  extraGenerator?: string;
  platform?: string;
  toolset?: string;
  protocolVersion: {major: number; minor: number;};
}

export interface HandshakeRequest extends CookiedMessage, HandshakeParams {
  type: 'handshake';
}

export interface HandshakeContent {}

export interface HandshakeReply extends ReplyMessage, HandshakeContent {
  inReplyTo: 'handshake';
}

/**
 * GlobalSettings request gets some static information about the project setup.
 */
export interface GlobalSettingsParams {}

export interface GlobalSettingsRequest extends CookiedMessage, GlobalSettingsParams {
  type: 'globalSettings';
}

export interface GlobalSettingsContent {
  buildDirectory: string;
  capabilities: {
    generators: {extraGenerators: string[]; name: string; platformSupport: boolean; toolsetSupport: boolean;}[];
    serverMode: boolean;
    version: {isDirty: boolean; major: number; minor: number; patch: number; string: string; suffix: string;};
  };
  checkSystemVars: boolean;
  extraGenerator: string;
  generator: string;
  debugOutput: boolean;
  sourceDirectory: string;
  trace: boolean;
  traceExpand: boolean;
  warnUninitialized: boolean;
  warnUnused: boolean;
  warnUnusedCli: boolean;
}

export interface GlobalSettingsReply extends ReplyMessage, GlobalSettingsContent {
  inReplyTo: 'globalSettings';
}

/**
 * setGlobalSettings changes information about the project setup.
 */
export interface SetGlobalSettingsParams {
  checkSystemVars?: boolean;
  debugOutput?: boolean;
  trace?: boolean;
  traceExpand?: boolean;
  warnUninitialized?: boolean;
  warnUnused?: boolean;
  warnUnusedCli?: boolean;
}

export interface SetGlobalSettingsRequest extends CookiedMessage, SetGlobalSettingsParams {
  type: 'setGlobalSettings';
}

export interface SetGlobalSettingsContent {}

export interface SetGlobalSettingsReply extends ReplyMessage, SetGlobalSettingsContent {
  inReplyTo: 'setGlobalSettings';
}

/**
 * configure will actually do the configuration for the project. Note that
 * this should be followed shortly with a 'compute' request.
 */
export interface ConfigureParams {
  cacheArguments: string[];
}

export interface ConfigureRequest extends CookiedMessage, ConfigureParams {
  type: 'configure';
}

export interface ConfigureContent {}
export interface ConfigureReply extends ReplyMessage, ConfigureContent {
  inReplyTo: 'configure';
}

/**
 * Compute actually generates the build files from the configure step.
 */
export interface ComputeParams {}

export interface ComputeRequest extends CookiedMessage, ComputeParams {
  type: 'compute';
}

export interface ComputeContent {}

export interface ComputeReply extends ReplyMessage, ComputeContent {
  inReplyTo: 'compute';
}

/**
 * codemodel gets information about the project, such as targets, files,
 * sources,
 * configurations, compile options, etc.
 */
export interface CodeModelParams {}

export interface CodeModelRequest extends CookiedMessage, CodeModelParams {
  type: 'codemodel';
}

export interface CodeModelFileGroup {
  language: string;
  compileFlags: string;
  includePath?: {path: string; isSystem?: boolean;}[];
  defines?: string[];
  sources: string[];
}

export interface CodeModelTarget {
  name: string;
  type:
      ('STATIC_LIBRARY'|'MODULE_LIBRARY'|'SHARED_LIBRARY'|'OBJECT_LIBRARY'|'EXECUTABLE'|'UTILITY'|'INTERFACE_LIBRARY');
  fullName: string;
  sourceDirectory: string;
  buildDirectory: string;
  artifacts?: string[];
  linkerLanguage: string;
  linkLibraries: string[];
  linkFlags: string[];
  linkLanguageFlags: string[];
  frameworkPath: string;
  linkPath: string;
  sysroot: string;
  fileGroups: CodeModelFileGroup[];
}

export interface CodeModelProject {
  name: string;
  sourceDirectory: string;
  buildDirectory: string;
  targets: CodeModelTarget[];
}

export interface CodeModelConfiguration {
  name: string;
  projects: CodeModelProject[];
}

export interface CodeModelContent {
  configurations: CodeModelConfiguration[];
}

export interface CodeModelReply extends ReplyMessage, CodeModelContent {
  inReplyTo: 'codemodel';
}

/**
 * cmakeInputs will respond with a list of file paths that can alter a
 * projects configuration output. Editting these will cause the configuration to
 * go out of date.
 */
export interface CMakeInputsParams {}

export interface CMakeInputsRequest extends CookiedMessage, CMakeInputsParams {
  type: 'cmakeInputs';
}

export interface CMakeInputsContent {
  buildFiles: {isCMake: boolean; isTemporary: boolean; sources: string[];}[];
  cmakeRootDirectory: string;
  sourceDirectory: string;
}

export interface CMakeInputsReply extends ReplyMessage, CMakeInputsContent {
  inReplyTo: 'cmakeInputs';
}

/**
 * The cache request will respond with the contents of the CMake cache.
 */
export interface CacheParams {}

export interface CacheRequest extends CookiedMessage, CacheParams {
  type: 'cache';
}

export interface CacheContent {
  cache: CMakeCacheEntry[];
}

export interface CMakeCacheEntry {
  key: string;
  properties: {ADVANCED: '0'|'1'; HELPSTRING: string};
  type: string;
  value: string;
}

export interface CacheReply extends ReplyMessage, CacheContent {
  inReplyTo: 'cache';
}

// Union type that represents any of the request types.
export type SomeRequestMessage
    = (HandshakeRequest|GlobalSettingsRequest|SetGlobalSettingsRequest|ConfigureRequest|ComputeRequest|CodeModelRequest|CacheRequest);

// Union type that represents a response type
export type SomeReplyMessage
    = (HandshakeReply|GlobalSettingsReply|SetGlobalSettingsReply|ConfigureReply|ComputeReply|CodeModelReply|CacheReply);

export type SomeMessage
    = (SomeReplyMessage|SomeRequestMessage|ProgressMessage|ErrorMessage|MessageMessage|HelloMessage|SignalMessage);

/**
 * The initial parameters when setting up the CMake client. The client init
 * routines will automatically perform the server handshake and set the
 * the appropriate settings. This is also where callbacks for progress and
 * message handlers are set.
 */
export interface ClientInit {
  cmakePath: string;
  onMessage: (m: MessageMessage) => Promise<void>;
  onProgress: (m: ProgressMessage) => Promise<void>;
  onDirty: () => Promise<void>;
  environment: {[key: string]: string};
  sourceDir: string;
  binaryDir: string;
  pickGenerator: () => Promise<CMakeGenerator|null>;
}

interface ClientInitPrivate extends ClientInit {
  onHello: (m: HelloMessage) => Promise<void>;
  onCrash: (retc: number, signal: string) => Promise<void>;
  onPipeError(e: Error): Promise<void>;
  tmpdir: string;
}

/**
 * Error message represent something going wrong.
 */
export interface ErrorMessage extends CookiedMessage {
  type: 'error';
  errorMessage: string;
  inReplyTo: string;
}

export class ServerError extends global.Error implements ErrorMessage {
  type: 'error';
  constructor(e: ErrorMessage,
              public errorMessage = e.errorMessage,
              public cookie = e.cookie,
              public inReplyTo = e.inReplyTo) {
    super(e.errorMessage);
  }
  toString(): string { return `[cmake-server] ${this.errorMessage}`; }
}

interface MessageResolutionCallbacks {
  resolve: (a: SomeReplyMessage) => void;
  reject: (b: ServerError) => void;
}


export class CMakeServerClient {
  private _proc: child_proc.ChildProcess;
  private _accInput: string = '';
  private readonly _promisesResolvers: Map<string, MessageResolutionCallbacks> = new Map;
  private readonly _params: ClientInitPrivate;
  private _endPromise: Promise<void>;
  private _pipe: net.Socket;
  private readonly _pipeFilePath: string;

  private _onMoreData(data: Uint8Array) {
    const str = data.toString();
    this._accInput += str;
    while (1) {
      const input = this._accInput;
      const mat = MESSAGE_WRAPPER_RE.exec(input);
      if (!mat) {
        break;
      }
      if (mat.length !== 3) {
        debugger;
        throw new global.Error('Protocol error talking to CMake! Got this input: ' + input);
      }
      this._accInput = mat[2];
      if (ENABLE_CMSERVER_PROTO_DEBUG) {
        log.debug(`Received message from cmake-server: ${mat[1]}`);
      }
      const message: SomeMessage = JSON.parse(mat[1]);
      this._onMessage(message);
    }
  }

  private _takePromiseForCookie(cookie: string): MessageResolutionCallbacks|undefined {
    const item = this._promisesResolvers.get(cookie);
    if (!item) {
      throw new global.Error('Invalid cookie: ' + cookie);
    }
    this._promisesResolvers.delete(cookie);
    return item;
  }

  private _onMessage(some: SomeMessage): void {
    if ('cookie' in some) {
      const cookied = some as CookiedMessage;
      switch (some.type) {
      case 'reply': {
        const reply = cookied as SomeReplyMessage;
        const pr = this._takePromiseForCookie(cookied.cookie);
        if (pr) {
          pr.resolve(reply);
        } else {
          log.error(`CMake server cookie "${cookied.cookie}" does not correspond to a known message`);
        }
        return;
      }
      case 'error': {
        const err = new ServerError(cookied as ErrorMessage);
        const pr = this._takePromiseForCookie(cookied.cookie);
        if (pr) {
          pr.reject(err);
        } else {
          log.error(`CMake server cookie "${cookied.cookie}" does not correspond to a known message`);
        }
        return;
      }
      case 'progress': {
        const prog = cookied as any as ProgressMessage;
        this._params.onProgress(prog).catch(e => { log.error('Unandled error in onProgress', e); });
        return;
      }
      }
    }

    switch (some.type) {
    case 'hello': {
      const unlink_pr = fs.exists(this._pipeFilePath).then(async exists => {
        if (exists && process.platform !== 'win32') {
          await fs.unlink(this._pipeFilePath);
        }
      });
      rollbar.takePromise('Unlink pipe', {pipe: this._pipeFilePath}, unlink_pr);
      this._params.onHello(some as HelloMessage).catch(e => { log.error('Unhandled error in onHello', e); });
      return;
    }
    case 'message': {
      this._params.onMessage(some as MessageMessage).catch(e => { log.error('Unhandled error in onMessage', e); });
      return;
    }
    case 'signal': {
      const sig = some as SomeSignalMessage;
      switch (sig.name) {
      case 'dirty': {
        this._params.onDirty().catch(e => { log.error('Unhandled error in onDirty', e); });
        return;
      }
      case 'fileChange': {
        return;
      }
      }
    }
    }
    debugger;
    log.warning(`Can't yet handle the ${some.type} messages`);
  }

  sendRequest(t: 'handshake', p: HandshakeParams): Promise<HandshakeContent>;
  sendRequest(t: 'globalSettings', p?: GlobalSettingsParams): Promise<GlobalSettingsContent>;
  sendRequest(t: 'setGlobalSettings', p: SetGlobalSettingsParams): Promise<SetGlobalSettingsContent>;
  sendRequest(t: 'configure', p: ConfigureParams): Promise<ConfigureContent>;
  sendRequest(t: 'compute', p?: ComputeParams): Promise<ComputeContent>;
  sendRequest(t: 'codemodel', p?: CodeModelParams): Promise<CodeModelContent>;
  sendRequest(T: 'cache', p?: CacheParams): Promise<CacheContent>;
  sendRequest(type: string, params: any = {}): Promise<any> {
    const cp = {type, ...params};
    const cookie = cp.cookie = Math.random().toString();
    const pr = new Promise((resolve, reject) => { this._promisesResolvers.set(cookie, {resolve, reject}); });
    const msg = JSON.stringify(cp);
    if (ENABLE_CMSERVER_PROTO_DEBUG) {
      log.debug(`Sending message to cmake-server: ${msg}`);
    }
    this._pipe.write('\n[== "CMake Server" ==[\n');
    this._pipe.write(msg);
    this._pipe.write('\n]== "CMake Server" ==]\n');
    return pr;
  }

  setGlobalSettings(params: SetGlobalSettingsParams): Promise<SetGlobalSettingsContent> {
    return this.sendRequest('setGlobalSettings', params);
  }

  getCMakeCacheContent(): Promise<CacheContent> { return this.sendRequest('cache'); }

  getGlobalSettings(): Promise<GlobalSettingsContent> { return this.sendRequest('globalSettings'); }

  configure(params: ConfigureParams): Promise<ConfigureContent> { return this.sendRequest('configure', params); }

  compute(params?: ComputeParams): Promise<ComputeParams> { return this.sendRequest('compute', params); }

  codemodel(params?: CodeModelParams): Promise<CodeModelContent> { return this.sendRequest('codemodel', params); }

  private _onErrorData(data: Uint8Array) {
    log.error(`Unexpected stderr/stdout data from CMake Server process: ${data.toString()}`);
  }

  public async shutdown() {
    this._pipe.end();
    await this._endPromise;
  }

  private constructor(params: ClientInitPrivate) {
    this._params = params;
    let pipe_file = path.join(params.tmpdir, '.cmserver-pipe');
    if (process.platform === 'win32') {
      pipe_file = '\\\\?\\pipe\\' + pipe_file;
    } else {
      pipe_file = `/tmp/cmake-server-${Math.random()}`;
    }
    this._pipeFilePath = pipe_file;
    const final_env = util.mergeEnvironment(process.env as proc.EnvironmentVariables, params.environment);
    const child = this._proc
        = child_proc.spawn(params.cmakePath, ['-E', 'server', '--experimental', `--pipe=${pipe_file}`], {
            env: final_env,
          });
    log.debug(`Started new CMake Server instance with PID ${child.pid}`);
    child.stdout.on('data', this._onErrorData.bind(this));
    child.stderr.on('data', this._onErrorData.bind(this));
    setTimeout(() => {
      const end_promise = new Promise<void>((resolve, reject) => {
        const pipe = this._pipe = net.createConnection(pipe_file);
        pipe.on('data', this._onMoreData.bind(this));
        pipe.on('error', e => {
          debugger;
          pipe.end();
          rollbar.takePromise('Pipe error from cmake-server', {pipe: pipe_file}, params.onPipeError(e));
          reject(e);
        });
        pipe.on('end', () => {
          pipe.end();
          resolve();
        });
      });
      const exit_promise = new Promise<void>(resolve => { child.on('exit', () => { resolve(); }); });
      this._endPromise = Promise.all([end_promise, exit_promise]).then(() => {});
      this._proc = child;
      child.on('close', (retc: number, signal: string) => {
        if (retc !== 0) {
          log.error('The connection to cmake-server was terminated unexpectedly');
          log.error(`cmake-server exited with status ${retc} (${signal})`);
          params.onCrash(retc, signal).catch(e => { log.error(`Unhandled error in onCrash ${e}`); });
        }
      });
    }, 1000);
  }

  public static async start(params: ClientInit): Promise<CMakeServerClient> {
    let resolved = false;
    const tmpdir = path.join(vscode.workspace.rootPath!, '.vscode');
    // Ensure the binary directory exists
    await fs.mkdir_p(params.binaryDir);
    return new Promise<CMakeServerClient>((resolve, reject) => {
      const client = new CMakeServerClient({
        tmpdir,
        sourceDir: params.sourceDir,
        binaryDir: params.binaryDir,
        onMessage: params.onMessage,
        cmakePath: params.cmakePath,
        environment: params.environment,
        onProgress: params.onProgress,
        onDirty: params.onDirty,
        pickGenerator: params.pickGenerator,
        onCrash: async retc => {
          if (!resolved) {
            reject(new StartupError(retc));
          }
        },
        onPipeError: async e => {
          if (!resolved) {
            reject(e);
          }
        },
        onHello: async (msg: HelloMessage) => {
          // We've gotten the hello message. We need to commense handshake
          try {
            const hsparams: HandshakeParams
                = {buildDirectory: params.binaryDir, protocolVersion: msg.supportedProtocolVersions[0]};

            const cache_path = path.join(params.binaryDir, 'CMakeCache.txt');
            const have_cache = await fs.exists(cache_path);

            if (have_cache) {
              // Work-around: CMake Server checks that CMAKE_HOME_DIRECTORY
              // in the cmake cache is the same as what we provide when we
              // set up the connection. Because CMake may normalize the
              // path differently than we would, we should make sure that
              // we pass the value that is specified in the cache exactly
              // to avoid causing CMake server to spuriously fail.
              // While trying to fix issue above CMake broke ability to run
              // with an empty sourceDir, so workaround because necessary for
              // different CMake versions.
              // See
              // https://gitlab.kitware.com/cmake/cmake/issues/16948
              // https://gitlab.kitware.com/cmake/cmake/issues/16736
              const tmpcache = await cache.CMakeCache.fromPath(cache_path);
              const src_dir = tmpcache.get('CMAKE_HOME_DIRECTORY');

              // TODO: if src_dir is not available or is different
              // clean configure is required as CMake won't accept it anyways.
              if (src_dir) {
                hsparams.sourceDirectory = src_dir.as<string>();
              }
            } else {
              // Do clean configure, all parameters are required.
              const generator = await params.pickGenerator();
              if (!generator) {
                log.error('None of preferred generators available on the system.');
                throw new global.Error('Unable to determine CMake Generator to use');
              }
              hsparams.sourceDirectory = params.sourceDir;
              hsparams.generator = generator.name;
              hsparams.platform = generator.platform;
              hsparams.toolset = generator.toolset || config.toolset || undefined;
              log.info(`Configuring using the "${generator.name}" CMake generator`);
            }

            await client.sendRequest('handshake', hsparams);
            resolved = true;
            resolve(client);
          } catch (e) {
            await client.shutdown();
            resolved = true;
            reject(e);
          }
        },
      });
    });
  }
}

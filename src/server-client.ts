import * as proc from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';

import * as async from './async';
import * as cache from './cache';
import {config} from './config';
import * as util from './util';

const MESSAGE_WRAPPER_RE =
    /\[== "CMake Server" ==\[([^]*?)\]== "CMake Server" ==\]\s*([^]*)/;
type MessageType = ('hello'|'handshake'|'globalSettings'|'setGlobalSettings'|
                    'configure'|'compute'|'codemodel'|'cmakeInputs'|'cache'|
                    'fileSystemWatchers'|'reply'|'error'|'progress');

export class StartupError extends global.Error {
  constructor(public readonly retc: number) {
    super('Error starting up cmake-server');
  }
}

export interface ProtocolVersion {
  isExperimental: boolean;
  major: number;
  minor: number;
}

export interface MessageBase { type: string; }

export interface CookiedMessage extends MessageBase { cookie: string; }

export interface ReplyMessage extends CookiedMessage { inReplyTo: string; }

export interface ProgressMessage extends MessageBase {
  type: 'progress';
  progressMessage: string;
  progressMinimum: number;
  progressCurrent: number;
  progressMaximum: number;
}

export interface MessageMessage extends MessageBase {
  type: 'message';
  message: string;
  title: string;
  inReplyTo: string;
}

export interface HelloMessage extends MessageBase {
  type: 'hello';
  supportedProtocolVersions: {major: number; minor: number;}[];
}

export interface HandshakeRequest {
  sourceDirectory: string;
  buildDirectory: string;
  generator: string;
  extraGenerator?: string;
  platform?: string;
  toolset?: string;
}

export interface HandshakeRequestMessage extends CookiedMessage,
                                                 HandshakeRequest {
  type: 'handshake';
}

export interface HandshakeReply extends ReplyMessage { inReplyTo: 'handshake'; }

export interface GlobalSettingsRequest {}

export interface GlobalSettingsRequestMessage extends CookiedMessage,
                                                      GlobalSettingsRequest {
  type: 'globalSettings';
}

export interface GlobalSettingsContent {
  buildDirectory: string;
  capabilities: {
    generators: {
      extraGenerators: string[]; name: string; platformSupport: boolean;
      toolsetSupport: boolean;
    }[];
    serverMode: boolean;
    version: {
      isDirty: boolean; major: number; minor: number; patch: number;
      string: string;
      suffix: string;
    };
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

export interface GlobalSettingsReply extends ReplyMessage,
                                             GlobalSettingsContent {
  inReplyTo: 'globalSettings';
}

export interface SettableGlobalSettings {
  checkSystemVars?: boolean;
  debugOutput?: boolean;
  trace?: boolean;
  traceExpand?: boolean;
  warnUninitialized?: boolean;
  warnUnused?: boolean;
  warnUnusedCli?: boolean;
}

export interface SetGlobalSettingsRequest extends SettableGlobalSettings {}

export interface SetGlobalSettingsRequestMessage extends
    CookiedMessage, SetGlobalSettingsRequest {
  type: 'setGlobalSettings';
}

export interface SetGlobalSettingsReply extends ReplyMessage {
  inReplyTo: 'setGlobalSettings';
}

export interface ConfigureRequest { cacheArguments: string[]; }

export interface ConfigureRequestMessage extends CookiedMessage,
                                                 ConfigureRequest {
  type: 'configure';
}

export interface ConfigureReply extends ReplyMessage { inReplyTo: 'configure'; }

export interface ComputeRequest {}

export interface ComputeRequestMessage extends CookiedMessage, ComputeRequest {
  type: 'compute';
}

export interface ComputeReply extends ReplyMessage { inReplyTo: 'compute'; }

export interface CodeModelRequest {}

export interface CodeModelRequestMessage extends CookiedMessage,
                                                 CodeModelRequest {
  type: 'codemodel';
}


export interface CodeModelFileGroup {
  language: string;
  compileFlags: string;
  includePath: {path: string; isSystem?: boolean;}[];
  defines: string[];
  sources: string[];
}

export interface CodeModelTarget {
  name: string;
  type: ('STATIC_LIBRARY'|'MODULE_LIBRARY'|'SHARED_LIBRARY'|'OBJECT_LIBRARY'|
         'EXECUTABLE'|'UTILITY'|'INTERFACE_LIBRARY');
  fullName: string;
  sourceDirectory: string;
  buildDirectory: string;
  artifacts: string[];
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

export interface CodeModelReply extends ReplyMessage, CodeModelConfiguration {
  inReplyTo: 'codemodel';
}

export interface CMakeInputsRequest {}

export interface CMakeInputsRequestMessage extends CookiedMessage,
                                                   CMakeInputsRequest {
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

export interface CacheRequest {}

export interface CacheRequestMessage extends CookiedMessage, CacheRequest {
  type: 'cache'
}

export interface CacheContent { cache: CMakeCacheEntry[]; }

export interface CMakeCacheEntry {
  key: string;
  properties: {ADVANCED: '0' | '1'; HELPSTRING: string};
  type: string;
  value: string;
}

export interface CacheReply extends ReplyMessage, CacheContent {
  inReplyTo: 'cache';
}

export type SomeRequestMessage =
    (HandshakeRequestMessage | GlobalSettingsRequestMessage |
     SetGlobalSettingsRequestMessage | ConfigureRequestMessage |
     ComputeRequestMessage | CodeModelRequestMessage | CacheRequestMessage);

export type SomeReplyMessage =
    (HandshakeReply | GlobalSettingsReply | SetGlobalSettingsReply |
     ConfigureReply | ComputeReply | CodeModelReply | CacheReply);

export type TypedMessage = (SomeReplyMessage | SomeRequestMessage | ProgressMessage | ErrorMessage)

export interface ClientInit {
  cmakePath: string;
  onMessage: (m: MessageMessage) => Promise<void>;
  onProgress: (m: ProgressMessage) => Promise<void>;
  onDirty: () => Promise<void>;
  environment: {[key: string]: string};
  sourceDir: string;
  binaryDir: string;
}

interface ClientInitPrivate extends ClientInit {
  onHello: (m: HelloMessage) => Promise<void>;
  onCrash: (retc: number, signal: string) => Promise<void>;
  tmpdir: string;
}

export interface ErrorMessage extends CookiedMessage {
  type: 'reply';
  errorMessage: string;
  inReplyTo: string;
}

export class Error extends global.Error {
  constructor(
      e: ErrorMessage, public errorMessage = e.errorMessage,
      public cookie = e.cookie, public inReplyTo = e.inReplyTo) {
    super(e.errorMessage);
  }
}

interface MessageResolutionCallbacks {
  resolve: (a: SomeReplyMessage) => void;
  reject: (b: Error) => void;
}


export class CMakeServerClient {
  private _proc: proc.ChildProcess;
  private _accInput: string = '';
  private _promisesResolvers: Map<string, MessageResolutionCallbacks> = new Map;
  private _params: ClientInitPrivate;
  private _endPromise: Promise<void>;
  private _pipe: net.Socket;

  private _onMoreData(data: Uint8Array) {
    const str = data.toString();
    this._accInput += str;
    while (1) {
      const input = this._accInput;
      let mat = MESSAGE_WRAPPER_RE.exec(input);
      if (!mat) {
        break;
      }
      const [_all, content, tail] = mat;
      if (!_all || !content || tail === undefined) {
        debugger;
        throw new global.Error(
            'Protocol error talking to CMake! Got this input: ' + input);
      }
      this._accInput = tail;
      console.log(`Got message from cmake-server: ${content.trim()}`);
      const message: MessageBase = JSON.parse(content);
      this._onMessage(message);
    }
  }

  private _dispatchProgress(m: ProgressMessage) {}

  private _takePromiseForCookie(cookie: string): MessageResolutionCallbacks {
    const item = this._promisesResolvers.get(cookie);
    if (!item) {
      throw new global.Error('Invalid cookie: ' + cookie);
    }
    this._promisesResolvers.delete(cookie);
    return item;
  }

  private _onMessage(m_1: TypedMessage) {
    if ('cookie' in m_1) {
      const m_2 = m_1 as CookiedMessage & TypedMessage;
      switch(m_2.type) {
        case 'reply': {
          const m = m_2 as SomeReplyMessage;
          this._takePromiseForCookie(m.cookie).resolve(m);
          break;
        }
        case 'error': {
          const err = new Error(m_2 as ErrorMessage);
          this._takePromiseForCookie(m_2.cookie).reject(err);
          break;
        }
        case 'hello': {
        }
        // case 'progress': {
        //   const prog = m_2 as ProgressMessage;
        //   this._params.onProgress(prog);
        // }
      }
    }
    if (m.cookie) {
      if (m.type === 'reply') {
        this._takePromiseForCookie(m.cookie).resolve(m);
      } else if (m.type === 'error') {
        this._takePromiseForCookie(m.cookie).reject(m);
      } else if (m.type === 'message') {
        this._params.onMessage(m).catch(e => {
          console.error('Unhandled error in onMessage', e);
        });
      } else if (m.type === 'progress') {
        this._params.onProgress(m).catch(e => {
          console.error('Unhandled error in onProgress', e);
        });
      } else {
        debugger;
        console.warn(`Can't yet handle the ${m.type} messages`);
      }
    } else if (m.type === 'error' && m.cookie) {
    } else if (m.type === 'hello') {
      this._params.onHello(m).catch(e => {
        console.error('Unhandled error in onHello', e);
      });
    } else if (m.type === 'signal') {
      if (m.name === 'fileChange') {
        console.log(`File change: ${(m as FileChangeMessage).path}`);
      } else if (m.name == 'dirty') {
        this._params.onDirty().catch(e => {
          console.error('Unhandled error in onDirty', e);
        })
      }
    } else {
      debugger;
      console.warn(
          'Unexpected message from cmake-server:',
          JSON.stringify(m, (_, v) => v, 2));
    }
  }

  // sendRequest(msg: BasicMessage): never;
  sendRequestRaw(msg: ConfigureMessage): Promise<ReplyMessage>;
  sendRequestRaw(msg: ComputeMessage): Promise<ReplyMessage>;
  sendRequestRaw(msg: CodeModelRequest): Promise<CodeModelReply>;
  public sendRequestRaw<T extends BasicMessage>(msg: T): Promise<Message> {
    const cp = Object.assign({}, msg);
    const cookie = cp.cookie = Math.random().toString();
    const pr = new Promise((resolve, reject) => {
      this._promisesResolvers.set(cookie, {resolve: resolve, reject: reject});
    });
    console.log(`Sending message to cmake-server: ${JSON.stringify(cp)}`);
    this._pipe.write('\n[== "CMake Server" ==[\n');
    this._pipe.write(JSON.stringify(cp));
    this._pipe.write('\n]== "CMake Server" ==]\n');
    return pr;
  }

  public setGlobalSettings(msg: SettableGlobalSettings): Promise<Message> {
    const message: SetGlobalSettingsMessage = Object.assign(
        {type: 'setGlobalSettings'} as SetGlobalSettingsMessage, msg);
    return this.sendRequestRaw(message);
  }

  public getCMakeCacheContent(): Promise<CacheMessage> {
    return this.sendRequestRaw({type: 'cache'});
  }

  public getGlobalSettings(): Promise<GlobalSettingsContent> {
    return this.sendRequestRaw({type: 'globalSettings'});
  }

  private _onErrorData(data: Uint8Array) {
    console.error(data.toString());
  }

  public async shutdown(): Promise<void> {
    this._pipe.end();
    await this._endPromise;
  }

  private constructor(params: ClientInitPrivate) {
    this._params = params;
    let pipe_file = path.join(params.tmpdir, '.cmserver-pipe');
    if (process.platform == 'win32') {
      pipe_file = '\\\\?\\pipe\\' + pipe_file;
    }
    const child = this._proc = proc.spawn(
        params.cmakePath,
        ['-E', 'server', '--experimental', `--pipe=${pipe_file}`], {
          env: params.environment,
        });
    console.log('Started new CMake Server instance with PID', child.pid);
    setTimeout(() => {
      const end_promise = new Promise(resolve => {
        const pipe = this._pipe = net.createConnection(pipe_file);
        pipe.on('data', this._onMoreData.bind(this));
        pipe.on('error', (e) => {
          debugger;
          pipe.end();
        });
        pipe.on('end', () => {
          pipe.end();
          resolve();
        });
      });
      const exit_promise = new Promise(resolve => {
        child.on('exit', () => {
          resolve();
        });
      });
      this._endPromise = Promise.all([end_promise, exit_promise]);
      this._proc = child;
      child.stdout.on('data', this._onErrorData.bind(this));
      child.stderr.on('data', this._onErrorData.bind(this));
      child.on('close', (retc: number, signal: string) => {
        if (retc !== 0) {
          console.error(
              'The connection to cmake-server was terminated unexpectedly');
          console.error(`cmake-server exited with status ${retc} (${signal})`);
          params.onCrash(retc, signal).catch(e => {
            console.error('Unhandled error in onCrash', e);
          });
        }
      });
    }, 500);
  }

  public static async start(params: ClientInit): Promise<CMakeServerClient> {
    let resolved = false;
    const tmpdir = path.join(vscode.workspace.rootPath, '.vscode');
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
        onCrash: async(retc) => {
          if (!resolved) {
            reject(new StartupError(retc));
          }
        },
        onHello: async(msg: HelloMessage) => {
          // We've gotten the hello message. We need to commense handshake
          try {
            const generator =
                await util.pickGenerator(config.preferredGenerators);
            if (!generator) {
              vscode.window.showErrorMessage(
                  'Unable to determine CMake Generator to use');
              throw new global.Error('No generator!');
            }
            let src_dir = params.sourceDir;
            // Work-around: CMake Server checks that CMAKE_HOME_DIRECTORY
            // in the cmake cache is the same as what we provide when we
            // set up the connection. Because CMake may normalize the
            // path differently than we would, we should make sure that
            // we pass the value that is specified in the cache exactly
            // to avoid causing CMake server to spuriously fail.
            const cache_path = path.join(params.binaryDir, 'CMakeCache.txt');
            if (await async.exists(cache_path)) {
              const tmpcache = await cache.CMakeCache.fromPath(cache_path);
              const home = tmpcache.get('CMAKE_HOME_DIRECTORY');
              if (home &&
                  util.normalizePath(home.as<string>()) ==
                      util.normalizePath(src_dir)) {
                src_dir = home.as<string>();
              }
            }
            const hs: HandshakeMessage = {
              type: 'handshake',
              buildDirectory: params.binaryDir,
              sourceDirectory: src_dir,
              extraGenerator: config.toolset,
              generator: generator,
              protocolVersion: msg.supportedProtocolVersions[0]
            };
            const res = await client.sendRequestRaw(hs);
            resolved = true;
            resolve(client);
          } catch (e) {
            resolved = true;
            reject(e);
          }
        },
      });
    });
  }
}

export function createCooke(): string {
  return 'cookie-' + Math.random().toString();
}
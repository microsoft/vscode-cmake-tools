import * as proc from 'child_process';
import * as net from 'net';
import *  as path from 'path';

import * as util from './util';

const MESSAGE_WRAPPER_RE =
    /\[== "CMake Server" ==\[([^]*?)\]== "CMake Server" ==\]\s*([^]*)/;
type MessageType = ('hello'|'handshake'|'globalSettings'|'setGlobalSettings'|
                    'configure'|'compute'|'codemodel'|'cmakeInputs'|'cache'|
                    'fileSystemWatchers'|'reply'|'error'|'progress');

export interface ProtocolVersion {
  isExperimental: boolean;
  major: number;
  minor: number;
}

export interface BasicMessage {
  type: string
  inReplyTo?: string
  cookie?: string
}

export interface UnknownMessage extends BasicMessage {
  type: string
  cookie: string
}

export interface ErrorMessage extends BasicMessage {
  type: 'error';
  cookie: string
  errorMessage: string
  inReplyTo: string
}

export interface HelloMessage extends BasicMessage {
  type: 'hello'
  supportedProtocolVersions: ProtocolVersion[];
}

export interface HandshakeMessage extends BasicMessage {
  type: 'handshake'
  protocolVersion: ProtocolVersion
  sourceDirectory: string
  buildDirectory: string
  generator: string
  extraGenerator?: string | null
}

export interface MessageMessage extends BasicMessage {
  type: 'message'
  message: string
  title?: string
}

export interface ReplyMessage extends BasicMessage {
  type: 'reply'
  cookie: string
}

export interface ProgressMessage extends BasicMessage {
  type: 'progress'
  cookie: string
  progressMessage: string
  progressMinimum: number
  progressMaximum: number
  progressCurrent: number
}

export interface ConfigureMessage extends BasicMessage {
  type: 'configure'
  cacheArguments?: string[]
}

export interface ComputeMessage extends BasicMessage { type: 'compute' }

export interface GlobalSettings {
  buildDirectory: string;
  capabilities: {
    generators: {
      extraGenerators: string[];
      name: string;
      platformSupport: boolean;
      toolsetSupport: boolean;
    }[];
    serverMode: boolean;
    version: {
      isDirty: boolean;
      major: number;
      minor: number;
      patch: number;
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

export interface SettableGlobalSettings {
  checkSystemVars?: boolean;
  debugOutput?: boolean;
  trace?: boolean;
  traceExpand?: boolean;
  warnUninitialized?: boolean;
  warnUnused?: boolean;
  warnUnusedCli?: boolean;
}

export interface SetGlobalSettingsMessage extends BasicMessage {
  type: 'setGlobalSettings';
  checkSystemVars?: boolean;
  debugOutput?: boolean;
  trace?: boolean;
  traceExpand?: boolean;
  warnUninitialized?: boolean;
  warnUnused?: boolean;
  warnUnusedCli?: boolean;
}

export interface GetCacheMessage extends BasicMessage {
  type: 'cache';
}

export interface CacheMessageProperties {
  ADVANCED: '1' | '0';
  HELPSTRING: string;
  STRINGS?: string[];
}

export interface CMakeCacheEntry {
  key: string;
  properties: {
    ADVANCED: '0' | '1';
    HELPSTRING: string
  };
  type: string;
  value: string;
}

export interface CacheMessage extends BasicMessage {
  type: 'cache';
  cache: CMakeCacheEntry[];
}

export interface FileChangeMessage extends BasicMessage {
  type: 'signal';
  name: 'fileChange';
  path: string;
  properties: ('change')[];
}

export interface DirtyMessage extends BasicMessage {
  type: 'signal';
  name: 'dirty';
}

export interface CodeModelFileGroup {
  language: string;
  compileFlags: string;
  includePath: {
    path: string;
    isSystem?: boolean;
  }[];
  defines: string[];
  sources: string[];
}

export interface CodeModelTarget {
  name: string;
  type: ('STATIC_LIBRARY' | 'MODULE_LIBRARY' | 'SHARED_LIBRARY' | 'OBJECT_LIBRARY' | 'EXECUTABLE' | 'UTILITY' | 'INTERFACE_LIBRARY');
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

export interface CodeModelMessage extends BasicMessage {
  type: 'codemodel';
  configurations: CodeModelConfiguration[];
}

export type Message = (HelloMessage | HandshakeMessage | MessageMessage |
    ConfigureMessage | ErrorMessage | ProgressMessage | ReplyMessage |
    ComputeMessage | SetGlobalSettingsMessage | CacheMessage |
    FileChangeMessage | DirtyMessage | CodeModelMessage );

interface ClientInit {
  cmakePath: string;
  onHello: (m: HelloMessage) => Promise<void>;
  onMessage: (m: MessageMessage) => Promise<void>;
  onProgress: (m: ProgressMessage) => Promise<void>;
  onDirty: () => Promise<void>;
  onCrash: (retc: number, signal: string) => Promise<void>;
  environment: {[key: string]: string};
  tmpdir: string;
}

interface MessageResolutionCallbacks {
  resolve: (a: Message) => void;
  reject: (b: ErrorMessage) => void;
}

export class Error extends global.Error implements ErrorMessage {
  type: 'error'
  cookie: string;
  errorMessage: string;
  inReplyTo: string;
  constructor(e: ErrorMessage) {
    super(e.errorMessage);
    this.cookie = e.cookie;
    this.errorMessage = e.errorMessage;
    this.inReplyTo = e.inReplyTo;
  }
}

export class CMakeServerClient {
  private _proc: proc.ChildProcess;
  private _accInput: string = '';
  private _promisesResolvers: Map<string, MessageResolutionCallbacks> = new Map;
  private _params: ClientInit;
  private _endPromise: Promise<void>;
  private _pipe: net.Socket;

  private _onMoreData(data: Uint8Array) {
    const str = data.toString();
    console.log(`Got data: ${str}`);
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
      const message: Message = JSON.parse(content);
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

  private _onMessage(m: Message) {
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

  public sendRequest<T extends BasicMessage>(msg: T): Promise<Message> {
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
    const message: SetGlobalSettingsMessage = Object.assign({
      type: 'setGlobalSettings'
    } as SetGlobalSettingsMessage, msg);
    return this.sendRequest(message);
  }

  public getCMakeCacheContent(): Promise<CacheMessage> {
    return this.sendRequest({type: 'cache'});
  }

  public getGlobalSettings(): Promise<GlobalSettings> {
    return this.sendRequest({type: 'globalSettings'});
  }

  private _onErrorData(data: Uint8Array) {
    console.error(data.toString());
  }

  public async shutdown(): Promise<void> {
    this._pipe.end();
    await this._endPromise;
  }

  constructor(params: ClientInit) {
    this._params = params;
    let pipe_file = path.join(params.tmpdir, '.cmserver-pipe');
    if (process.platform == 'win32') {
      pipe_file = '\\\\?\\pipe\\' + pipe_file;
    }
    const child = this._proc = proc.spawn(
        params.cmakePath, ['-E', 'server', '--experimental', `--pipe=${pipe_file}`],
        {
          env: params.environment,
        });
    setTimeout(() => {
      const end_promise = new Promise(resolve => {
        const pipe = this._pipe = net.createConnection(pipe_file);
        pipe.on('data', this._onMoreData.bind(this)),
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
        console.error('The connection to cmake-server was terminated unexpectedly');
        console.error(`cmake-server exited with status ${retc} (${signal})`);
        if (retc !== 0) {
          params.onCrash(retc, signal).catch(e => {
            console.error('Unhandled error in onCrash', e);
          });
        }
      });
    }, 500);
  }

}

export function createCooke(): string {
  return 'cookie-' + Math.random().toString();
}
import * as proc from 'child_process';

export namespace cmake {
  const MESSAGE_WRAPPER_RE =
      /\[== CMake Server ==\[([^]*?)\]== CMake Server ==\](.*)/;
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
    extraGenerator?: string
  }

  export interface MessageMessage extends BasicMessage {
    type: 'message'
    message: string
    title: string
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

  export interface ComputeMessage extends BasicMessage {
    type: 'compute'
  }

  export type Message = HelloMessage | HandshakeMessage | MessageMessage |
      ConfigureMessage | ErrorMessage | ProgressMessage | ReplyMessage | ComputeMessage;

  interface ClientInit {
    cmakePath: string;
    onHello: (m: HelloMessage) => void;
    onMessage: (m: MessageMessage) => void;
    onProgress: (m: ProgressMessage) => void;
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

  export class Client {
    private _proc: proc.ChildProcess;
    private _accInput: string = '';
    private _promisesResolvers: Map<string, MessageResolutionCallbacks> =
        new Map;
    private _params: ClientInit;

    private _onMoreData(data: Uint8Array) {
      this._accInput += data.toString();
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
          this._params.onMessage(m);
        } else if (m.type === 'progress') {
          this._params.onProgress(m);
          if (m.progressCurrent === m.progressMaximum) {
            // this._takePromiseForCookie(m.cookie).resolve(m);
          }
        } else {
          debugger;
          console.warn(`Can't yet handle the ${m.type} messages`);
        }
      } else if (m.type === 'error' && m.cookie) {
      } else if (m.type === 'hello') {
        this._params.onHello(m);
      } else {
        debugger;
        console.warn(
            'Unexpected message from cmake-server:',
            JSON.stringify(m, (_, v) => v, 2));
      }
    }

    public sendRequest(msg: Message): Promise<Message> {
      const cp = Object.assign({}, msg);
      const cookie = cp.cookie = Math.random().toString();
      const pr = new Promise((resolve, reject) => {
        this._promisesResolvers.set(cookie, {resolve: resolve, reject: reject});
      });
      this._proc.stdin.write('\n[== CMake Server ==[\n');
      this._proc.stdin.write(JSON.stringify(cp));
      this._proc.stdin.write('\n]== CMake Server ==]\n');
      return pr;
    }

    private _onErrorData(data: Uint8Array) {
      console.log(data);
    }

    constructor(params: ClientInit) {
      this._params = params;
      const child = this._proc = proc.spawn(
          params.cmakePath, ['-E', 'server', '--experimental', '--debug']);
      this._proc = child;
      child.stdout.on('data', this._onMoreData.bind(this));
      child.stderr.on('data', this._onErrorData.bind(this));
    }
  }
}
import * as childProc from 'child_process';
import * as net from 'net';
import * as path from 'path';

import * as cache from '@cmt/cache';
import { CMakeGenerator } from '@cmt/kit';
import { createLogger } from '@cmt/logging';
import { fs } from '@cmt/pr';
import rollbar from '@cmt/rollbar';
import * as util from '@cmt/util';
import * as nls from 'vscode-nls';
import { Environment, EnvironmentUtils } from '@cmt/environmentVariables';
import { ChildProcessWithoutNullStreams } from 'child_process';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('cms-client');

const enableCMakeServerDebugProtocol = false;

const messageWrapperRegEx = /\[== "CMake Server" ==\[([^]*?)\]== "CMake Server" ==\]\s*([^]*)/;

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
export interface MessageBase { type: string }

/**
 * Cookied messages represent some on-going conversation.
 */
export interface CookiedMessage extends MessageBase { cookie: string }

/**
 * Reply messages are solicited by some previous request, which comes with a
 * cookie to identify the initiating request.
 */
export interface ReplyMessage extends CookiedMessage { inReplyTo: string }

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

export interface DirtyMessage extends SignalMessage { name: 'dirty' }

export interface FileChangeMessage {
    name: 'fileChange';
    path: string;
    properties: string[];
}

type SomeSignalMessage = (DirtyMessage | FileChangeMessage);

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
    protocolVersion: { major: number; minor: number };
}

export interface HandshakeRequest extends CookiedMessage, HandshakeParams { type: 'handshake' }

export interface HandshakeContent {}

export interface HandshakeReply extends ReplyMessage, HandshakeContent { inReplyTo: 'handshake' }

/**
 * GlobalSettings request gets some static information about the project setup.
 */
export interface GlobalSettingsParams {}

export interface GlobalSettingsRequest extends CookiedMessage, GlobalSettingsParams { type: 'globalSettings' }

export interface GlobalSettingsContent {
    buildDirectory: string;
    capabilities: {
        generators: { extraGenerators: string[]; name: string; platformSupport: boolean; toolsetSupport: boolean }[];
        serverMode: boolean;
        version: { isDirty: boolean; major: number; minor: number; patch: number; string: string; suffix: string };
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

export interface GlobalSettingsReply extends ReplyMessage, GlobalSettingsContent { inReplyTo: 'globalSettings' }

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

export interface SetGlobalSettingsRequest extends CookiedMessage, SetGlobalSettingsParams { type: 'setGlobalSettings' }

export interface SetGlobalSettingsContent {}

export interface SetGlobalSettingsReply extends ReplyMessage, SetGlobalSettingsContent {
    inReplyTo: 'setGlobalSettings';
}

/**
 * configure will actually do the configuration for the project. Note that
 * this should be followed shortly with a 'compute' request.
 */
export interface ConfigureParams { cacheArguments: string[] }

export interface ConfigureRequest extends CookiedMessage, ConfigureParams { type: 'configure' }

export interface ConfigureContent {}
export interface ConfigureReply extends ReplyMessage, ConfigureContent { inReplyTo: 'configure' }

/**
 * Compute actually generates the build files from the configure step.
 */
export interface ComputeParams {}

export interface ComputeRequest extends CookiedMessage, ComputeParams { type: 'compute' }

export interface ComputeContent {}

export interface ComputeReply extends ReplyMessage, ComputeContent { inReplyTo: 'compute' }

/**
 * codemodel gets information about the project, such as targets, files,
 * sources,
 * configurations, compile options, etc.
 */
export interface CodeModelParams {}

export interface CodeModelRequest extends CookiedMessage, CodeModelParams { type: 'codemodel' }

export interface ServerCodeModelFileGroup {
    language?: string;
    compileFlags?: string; // In CodeModelFileGroup compileCommandFragments is used instead.
    includePath?: { path: string; isSystem?: boolean }[];
    defines?: string[];
    sources: string[];
    isGenerated: boolean;
}

export type TargetTypeString = ('STATIC_LIBRARY' | 'MODULE_LIBRARY' | 'SHARED_LIBRARY' | 'OBJECT_LIBRARY' | 'EXECUTABLE' | 'UTILITY' | 'INTERFACE_LIBRARY');

export interface ServerCodeModelTarget {
    name: string;
    type: TargetTypeString;
    fullName?: string;
    sourceDirectory?: string;
    buildDirectory?: string; // Doesn't exist in general CodeModelTarget.
    artifacts?: string[];
    linkerLanguage?: string; // Doesn't exist in general CodeModelTarget.
    linkLibraries?: string[]; // Doesn't exist in general CodeModelTarget.
    linkFlags?: string[]; // Doesn't exist in general CodeModelTarget.
    linkLanguageFlags?: string; // Doesn't exist in general CodeModelTarget.
    frameworkPath?: string; // Doesn't exist in general CodeModelTarget.
    linkPath?: string; // Doesn't exist in general CodeModelTarget.
    sysroot?: string;
    fileGroups?: ServerCodeModelFileGroup[];
}

export interface ServerCodeModelProject {
    name: string;
    targets: ServerCodeModelTarget[];
    sourceDirectory: string;
    buildDirectory: string; // Doesn't exist in general CodeModelProject.
    hasInstallRule?: boolean;
}

export interface ServerCodeModelConfiguration {
    /** Name of the active configuration in a multi-configuration generator.*/
    name: string;
    projects: ServerCodeModelProject[];
}

export interface ServerCodeModelContent {
    configurations: ServerCodeModelConfiguration[];
    // Doesn't include toolchains as in general CodeModelContent.
}

export interface CodeModelReply extends ReplyMessage, ServerCodeModelContent { inReplyTo: 'codemodel' }

/**
 * cmakeInputs will respond with a list of file paths that can alter a
 * projects configuration output. Editting these will cause the configuration to
 * go out of date.
 */
export interface CMakeInputsParams {}

export interface CMakeInputsRequest extends CookiedMessage, CMakeInputsParams { type: 'cmakeInputs' }

export interface CMakeInputsContent {
    buildFiles: { isCMake: boolean; isTemporary: boolean; sources: string[] }[];
    cmakeRootDirectory: string;
    sourceDirectory: string;
}

export interface CMakeInputsReply extends ReplyMessage, CMakeInputsContent { inReplyTo: 'cmakeInputs' }

/**
 * The cache request will respond with the contents of the CMake cache.
 */
export interface CacheParams {}

export interface CacheRequest extends CookiedMessage, CacheParams { type: 'cache' }

export interface CacheContent { cache: CMakeCacheEntry[] }

export interface CMakeCacheEntry {
    key: string;
    properties: { ADVANCED: '0' | '1'; HELPSTRING: string };
    type: string;
    value: string;
}

export interface CacheReply extends ReplyMessage, CacheContent { inReplyTo: 'cache' }

// Union type that represents any of the request types.
export type SomeRequestMessage = (HandshakeRequest | GlobalSettingsRequest | SetGlobalSettingsRequest | ConfigureRequest | ComputeRequest | CodeModelRequest | CacheRequest);

// Union type that represents a response type
export type SomeReplyMessage = (HandshakeReply | GlobalSettingsReply | SetGlobalSettingsReply | ConfigureReply | ComputeReply | CodeModelReply | CacheReply);

export type SomeMessage = (SomeReplyMessage | SomeRequestMessage | ProgressMessage | ErrorMessage | MessageMessage | HelloMessage | SignalMessage);

/**
 * The initial parameters when setting up the CMake client. The client init
 * routines will automatically perform the server handshake and set the
 * the appropriate settings. This is also where callbacks for progress and
 * message handlers are set.
 */
export interface ClientInit {
    cmakePath: string;
    onMessage(m: MessageMessage): Promise<void>;
    onOtherOutput(m: string): Promise<void>;
    onProgress(m: ProgressMessage): Promise<void>;
    onDirty(): Promise<void>;
    environment: Environment;
    sourceDir: string;
    binaryDir: string;
    tmpdir: string;
    generator: CMakeGenerator;
}

interface ClientInitPrivate extends ClientInit {
    onHello(m: HelloMessage): Promise<void>;
    onCrash(retc: number, signal: string): Promise<void>;
    onPipeError(e: Error): Promise<void>;
}

/**
 * Error message represent something going wrong.
 */
export interface ErrorMessage extends CookiedMessage {
    type: 'error';
    errorMessage: string;
    inReplyTo: string;
}

export class ServerError extends Error implements ErrorMessage {
    type: 'error' = 'error';
    constructor(e: ErrorMessage,
        public errorMessage = e.errorMessage,
        public cookie = e.cookie,
        public inReplyTo = e.inReplyTo) {
        super(e.errorMessage);
    }
    toString(): string {
        return `[cmake-server] ${this.errorMessage}`;
    }
}

export class BadHomeDirectoryError extends Error {
    constructor(readonly cached: string, readonly expecting: string, readonly badCachePath: string) {
        super();
    }
}

interface MessageResolutionCallbacks {
    resolve(a: SomeReplyMessage): void;
    reject(b: ServerError): void;
}

export class CMakeServerClient {
    private accInput: string = '';
    private readonly promisesResolvers: Map<string, MessageResolutionCallbacks> = new Map();
    private readonly params: ClientInitPrivate;
    // TODO: Refactor init so these init-assertions are not necessary
    private endPromise!: Promise<void>;
    private pipe!: net.Socket;
    private readonly pipeFilePath: string;
    private serverProcess: ChildProcessWithoutNullStreams | null = null;

    private onMoreData(data: Uint8Array) {
        const str = data.toString();
        this.accInput += str;
        while (1) {
            const input = this.accInput;
            const mat = messageWrapperRegEx.exec(input);
            if (!mat) {
                break;
            }
            if (mat.length !== 3) {
                debugger;
                throw new global.Error(localize('protocol.error.cmake', 'Protocol error talking to CMake! Got this input: {0}', input));
            }
            this.accInput = mat[2];
            if (enableCMakeServerDebugProtocol) {
                log.debug(localize('received.message.from.make-server', 'Received message from cmake-server: {0}', mat[1]));
            }
            const message: SomeMessage = JSON.parse(mat[1]);
            this.onMessage(message);
        }
    }

    private takePromiseForCookie(cookie: string): MessageResolutionCallbacks | undefined {
        const item = this.promisesResolvers.get(cookie);
        if (!item) {
            throw new global.Error(localize('invalid.cookie', 'Invalid cookie: {0}', cookie));
        }
        this.promisesResolvers.delete(cookie);
        return item;
    }

    private onMessage(some: SomeMessage): void {
        if ('cookie' in some) {
            const cookied = some as CookiedMessage;
            switch (some.type) {
                case 'reply': {
                    const reply = cookied as SomeReplyMessage;
                    const pr = this.takePromiseForCookie(cookied.cookie);
                    if (pr) {
                        pr.resolve(reply);
                    } else {
                        log.error(localize('cookie.not.known.message', 'CMake server cookie {0} does not correspond to a known message', `"${cookied.cookie}"`));
                    }
                    return;
                }
                case 'error': {
                    const err = new ServerError(cookied as ErrorMessage);
                    const pr = this.takePromiseForCookie(cookied.cookie);
                    if (pr) {
                        pr.reject(err);
                    } else {
                        log.error(localize('cookie.not.known.message', 'CMake server cookie {0} does not correspond to a known message', `"${cookied.cookie}"`));
                    }
                    return;
                }
                case 'progress': {
                    const prog = cookied as any as ProgressMessage;
                    this.params.onProgress(prog).catch(e => {
                        log.error(localize('unhandled.error.in', 'Unhandled error in {0}', 'onProgress'), e);
                    });
                    return;
                }
            }
        }

        switch (some.type) {
            case 'hello': {
                const unlinkPromise = fs.exists(this.pipeFilePath).then(async exists => {
                    if (exists && process.platform !== 'win32') {
                        await fs.unlink(this.pipeFilePath);
                    }
                });
                rollbar.takePromise('Unlink pipe', { pipe: this.pipeFilePath }, unlinkPromise);
                this.params.onHello(some as HelloMessage).catch(e => {
                    log.error(localize('unhandled.error.in', 'Unhandled error in {0}', 'onHello'), e);
                });
                return;
            }
            case 'message': {
                this.params.onMessage(some as MessageMessage).catch(e => {
                    log.error(localize('unhandled.error.in', 'Unhandled error in {0}', 'onMessage'), e);
                });
                return;
            }
            case 'signal': {
                const sig = some as SomeSignalMessage;
                switch (sig.name) {
                    case 'dirty': {
                        this.params.onDirty().catch(e => {
                            log.error(localize('unhandled.error.in', 'Unhandled error in {0}', 'onDirty'), e);
                        });
                        return;
                    }
                    case 'fileChange': {
                        return;
                    }
                }
            }
        }
        debugger;
        log.warning(localize('cant.yet.handle.message', 'Can\'t yet handle the {0} messages', some.type));
    }

    private sendRequest(type: 'handshake', params: HandshakeParams): Promise<HandshakeContent>;
    private sendRequest(type: 'globalSettings', params?: GlobalSettingsParams): Promise<GlobalSettingsContent>;
    private sendRequest(type: 'setGlobalSettings', params: SetGlobalSettingsParams): Promise<SetGlobalSettingsContent>;
    private sendRequest(type: 'configure', params: ConfigureParams): Promise<ConfigureContent>;
    private sendRequest(type: 'compute', params?: ComputeParams): Promise<ComputeContent>;
    private sendRequest(type: 'codemodel', params?: CodeModelParams): Promise<ServerCodeModelContent>;
    private sendRequest(type: 'cmakeInputs', params?: CMakeInputsParams): Promise<CMakeInputsContent>;
    private sendRequest(type: 'cache', params?: CacheParams): Promise<CacheContent>;
    private sendRequest(type: string, params: any = {}): Promise<any> {
        const cookiedMessage = { type, ...params };
        const cookie = cookiedMessage.cookie = Math.random().toString();
        const promise = new Promise((resolve, reject) => this.promisesResolvers.set(cookie, { resolve, reject }));
        const jsonMessage = JSON.stringify(cookiedMessage);
        if (enableCMakeServerDebugProtocol) {
            log.debug(localize('sending.message.to.cmake-server', 'Sending message to cmake-server: {0}', jsonMessage));
        }
        this.pipe.write('\n[== "CMake Server" ==[\n');
        this.pipe.write(jsonMessage);
        this.pipe.write('\n]== "CMake Server" ==]\n');
        return promise;
    }

    /**
     * CMake server requests:
     */

    setGlobalSettings(params: SetGlobalSettingsParams): Promise<SetGlobalSettingsContent> {
        return this.sendRequest('setGlobalSettings', params);
    }

    handshake(params: HandshakeParams): Promise<HandshakeContent> {
        return this.sendRequest('handshake', params);
    }

    getCMakeCacheContent(): Promise<CacheContent> {
        return this.sendRequest('cache');
    }

    getGlobalSettings(): Promise<GlobalSettingsContent> {
        return this.sendRequest('globalSettings');
    }

    configure(params: ConfigureParams): Promise<ConfigureContent> {
        return this.sendRequest('configure', params);
    }

    compute(params?: ComputeParams): Promise<ComputeParams> {
        return this.sendRequest('compute', params);
    }

    codemodel(params?: CodeModelParams): Promise<ServerCodeModelContent> {
        return this.sendRequest('codemodel', params);
    }

    cmakeInputs(params?: CMakeInputsParams): Promise<CMakeInputsContent> {
        return this.sendRequest('cmakeInputs', params);
    }

    public shutdownServer() {
        if (this.serverProcess) {
            this.serverProcess.kill();
        }
    }

    protected shutDownFlag = false;
    public async shutdownAsync() {
        this.shutDownFlag = true;
        this.pipe.end();
        await this.endPromise;
    }

    private constructor(params: ClientInitPrivate) {
        this.params = params;
        let pipeFile = path.join(params.tmpdir, '.cmserver-pipe');
        if (process.platform === 'win32') {
            pipeFile = '\\\\?\\pipe\\' + pipeFile;
        } else {
            pipeFile = `/tmp/cmake-server-${Math.random()}`;
        }
        this.pipeFilePath = pipeFile;
        const finalEnv = EnvironmentUtils.merge([process.env, params.environment]);
        const child = childProc.spawn(params.cmakePath, ['-E', 'server', '--experimental', `--pipe=${pipeFile}`], {
            env: finalEnv,
            cwd: params.binaryDir
        });
        this.serverProcess = child;
        log.debug(localize('started.new.cmake.server.instance', 'Started new CMake Server instance with PID {0}', child.pid));
        child.stdout.on('data', data => {
            void this.params.onOtherOutput(data.toLocaleString());
        });
        child.stderr.on('data', data => {
            void this.params.onOtherOutput(data.toLocaleString());
        });
        child.on('close', (retc: number, signal: string) => {
            if (retc !== 0) {
                log.error(localize('connection.terminated.unexpectedly', 'The connection to cmake-server was terminated unexpectedly'));
                log.error(localize('cmake-server.exited.with.status', 'cmake-server exited with status {0} ({1})', retc, signal));
                params.onCrash(retc, signal).catch(e => {
                    log.error(localize('unhandled.error.in', 'Unhandled error in {0}', 'onCrash'), e);
                });
            }
        });
        setTimeout(() => {
            const endPromise = new Promise<void>((resolve, reject) => {
                const pipe = this.pipe = net.createConnection(pipeFile);
                pipe.on('data', this.onMoreData.bind(this));
                pipe.on('error', e => {
                    pipe.end();
                    if (!this.shutDownFlag) {
                        debugger;
                        rollbar.takePromise(localize('pipe.error.from.cmake-server', 'Pipe error from cmake-server'),
                            { pipe: pipeFile },
                            params.onPipeError(e));
                        reject(e);
                    } else {
                        resolve();
                    }
                });
                pipe.on('end', () => {
                    pipe.end();
                    resolve();
                });
            });
            const exitPromise = new Promise<void>(resolve => {
                child.on('exit', () => resolve());
            });
            this.endPromise = Promise.all([endPromise, exitPromise]).then(() => {});
        }, 1000);
    }

    public static async start(params: ClientInit): Promise<CMakeServerClient> {
        let resolved = false;
        // Ensure the binary directory exists
        await fs.mkdir_p(params.binaryDir);
        return new Promise<CMakeServerClient>((resolve, reject) => {
            const client = new CMakeServerClient({
                tmpdir: params.tmpdir,
                sourceDir: params.sourceDir,
                binaryDir: params.binaryDir,
                onMessage: params.onMessage,
                onOtherOutput: other => params.onOtherOutput(other),
                cmakePath: params.cmakePath,
                environment: params.environment,
                onProgress: params.onProgress,
                onDirty: params.onDirty,
                generator: params.generator,
                onCrash: async _retc => {
                    if (!resolved) {
                        reject(new global.Error(localize('error.starting.cmake-server', 'Error starting up cmake-server')));
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
                        const hsparams: HandshakeParams = { buildDirectory: params.binaryDir, protocolVersion: msg.supportedProtocolVersions[0] };

                        const cachePath = path.join(params.binaryDir, 'CMakeCache.txt');
                        const haveCache = await fs.exists(cachePath);

                        if (haveCache) {
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
                            const tempCache = await cache.CMakeCache.fromPath(cachePath);
                            const srcDir = tempCache.get('CMAKE_HOME_DIRECTORY');

                            if (srcDir) {
                                const cachedDir = srcDir.as<string>();
                                if (!util.platformPathEquivalent(cachedDir, params.sourceDir)) {
                                    // If srcDir is different, clean configure is required as CMake won't accept it anyways.
                                    throw new BadHomeDirectoryError(cachedDir, params.sourceDir, cachePath);
                                }
                                hsparams.sourceDirectory = cachedDir;
                            }
                        } else {
                            // Do clean configure, all parameters are required.
                            const generator = params.generator;
                            hsparams.sourceDirectory = params.sourceDir;
                            hsparams.generator = generator.name;
                            hsparams.platform = generator.platform;
                            hsparams.toolset = generator.toolset;

                            const configureMessage: string = localize('configuring.using.generator', 'Configuring using the {0} CMake generator', `"${hsparams.generator}"`);
                            const extraMessage: string = hsparams.platform || hsparams.toolset ?
                                localize('with.platform.and.toolset', ' with platform {0} and toolset {1}', `"${hsparams.platform}"`, JSON.stringify(`"${hsparams.toolset}"` || {})) :
                                "";
                            log.info(configureMessage + extraMessage);
                        }

                        await client.handshake(hsparams);
                        resolved = true;
                        resolve(client);
                    } catch (e) {
                        await client.shutdownAsync();
                        resolved = true;
                        reject(e);
                    }
                }
            });
        });
    }
}

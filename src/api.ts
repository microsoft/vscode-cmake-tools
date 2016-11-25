export interface ExecutionResult {
    retc: Number;
}

export interface ExecuteOptions {
    silent: boolean;
    environment: Object;
};

export interface CMakeToolsAPI {
    sourceDir: string;
    mainListFile: string;
    binaryDir: string;
    cachePath: string;
    executeCMakeCommand(args: string[], options?: ExecuteOptions): Promise<ExecutionResult>;
    execute(program: string,
            args: string[],
            options?: ExecuteOptions): Promise<ExecutionResult>;
}
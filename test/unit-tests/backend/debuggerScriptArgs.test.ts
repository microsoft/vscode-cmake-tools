import { expect } from 'chai';
import { buildScriptDebuggerArgs } from '@cmt/debug/cmakeDebugger/debuggerScriptArgs';

suite('[buildScriptDebuggerArgs]', () => {

    test('Builds script mode arguments with only the script path', () => {
        const args = buildScriptDebuggerArgs('/path/script.cmake', [], [], 'pipe');
        expect(args).to.deep.equal(['-P', '/path/script.cmake', '--debugger', '--debugger-pipe', 'pipe']);
    });

    test('Places cmakeArgs before -P and scriptArgs after the script path', () => {
        const args = buildScriptDebuggerArgs('/path/script.cmake', ['-DCMAKE_BUILD_TYPE=Debug', '-DFOO=bar'], ['arg1', 'arg2'], 'pipe');
        expect(args).to.deep.equal([
            '-DCMAKE_BUILD_TYPE=Debug', '-DFOO=bar',
            '-P', '/path/script.cmake',
            'arg1', 'arg2',
            '--debugger', '--debugger-pipe', 'pipe'
        ]);
    });

    test('Appends the DAP log option when provided', () => {
        const args = buildScriptDebuggerArgs('/path/script.cmake', ['-DFOO=bar'], [], 'pipe', '/tmp/dap.log');
        expect(args).to.deep.equal([
            '-DFOO=bar', '-P', '/path/script.cmake',
            '--debugger', '--debugger-pipe', 'pipe', '--debugger-dap-log', '/tmp/dap.log'
        ]);
    });
});

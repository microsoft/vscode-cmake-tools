import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execute, ExecutionOptions } from '@cmt/proc';

suite('Process argument safety', () => {
    let directory: string;
    let script: string;
    const args = [
        'space value', 'literal & echo CMT_INJECTED', 'semi;colon',
        'quote"inside', "apostrophe's", '%CMT_TEST_LITERAL%', '!CMT_TEST_LITERAL!',
        '$CMT_TEST_LITERAL', '$(echo CMT_INJECTED)', '`echo CMT_INJECTED`',
        'a|b', 'a>b', '(parentheses)', '', 'C:\\trailing\\',
        '" & echo CMT_INJECTED & "', 'slashes\\\\\\" & echo CMT_INJECTED'
    ];

    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-proc & literal-'));
        script = path.join(directory, 'echo args.js');
        fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    });

    teardown(() => {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    async function checkArguments(shell: ExecutionOptions['shell'], values = args): Promise<void> {
        const result = await execute(process.execPath, [script, ...values], null, {
            shell,
            cwd: directory,
            environment: { CMT_TEST_LITERAL: 'EXPANDED' },
            silent: true
        }).result;
        expect(result.retc, `${shell}: ${result.stderr}`).to.equal(0);
        expect(JSON.parse(result.stdout)).to.deep.equal(values);
    }

    test('default execution preserves argument boundaries and shell metacharacters', async () => {
        await checkArguments(undefined);
    });

    test('explicit no-shell execution preserves arguments', async () => {
        await checkArguments(false);
    });

    test('the default shell does not interpret argument data as commands', async () => {
        await checkArguments(true);
    });

    const posixShell = process.platform === 'win32'
        ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
        : '/bin/sh';
    (fs.existsSync(posixShell) ? test : test.skip)('a custom POSIX shell preserves literal arguments', async () => {
        await checkArguments(posixShell);
    });

    test('shell execution preserves a nonzero program exit code', async () => {
        const exitScript = path.join(directory, 'exit code.js');
        fs.writeFileSync(exitScript, 'process.exit(7);');
        const result = await execute(process.execPath, [exitScript], null, { shell: true, silent: true }).result;
        expect(result.retc, result.stderr).to.equal(7);
    });

    if (process.platform === 'win32') {
        test('shells execute native paths containing spaces and metacharacters literally', async () => {
            const executable = path.join(directory, 'node & %CMT_TEST_LITERAL%.exe');
            fs.copyFileSync(process.execPath, executable);
            for (const shell of [true, 'cmd', 'powershell', posixShell]) {
                if (typeof shell === 'string' && shell === posixShell && !fs.existsSync(shell)) {
                    continue;
                }
                const values = ['space value', 'literal & echo CMT_INJECTED'];
                const result = await execute(executable, [script, ...values], null, {
                    shell,
                    cwd: directory,
                    environment: { CMT_TEST_LITERAL: 'EXPANDED' },
                    silent: true
                }).result;
                expect(result.retc, result.stderr).to.equal(0);
                expect(JSON.parse(result.stdout)).to.deep.equal(values);
            }
        });

        test('an explicit cmd shell preserves literal arguments', async () => {
            await checkArguments('cmd');
        });

        test('PowerShell does not evaluate expressions in native argument data', async () => {
            // Windows PowerShell's legacy native binder drops empty values and embedded quotes.
            await checkArguments('powershell', args.filter(value => value !== '' && !value.includes('"')));
        });

        test('PowerShell scripts receive literal argument data', async () => {
            const psScript = path.join(directory, 'echo args.ps1');
            fs.writeFileSync(psScript, 'ConvertTo-Json -Compress -InputObject @($args)');
            for (const values of [args, [], ['one'], ['']]) {
                const result = await execute(psScript, values, null, {
                    silent: true,
                    environment: { CMT_TEST_LITERAL: 'EXPANDED' }
                }).result;
                expect(result.retc, result.stderr).to.equal(0);
                expect(JSON.parse(result.stdout)).to.deep.equal(values);
            }
        });

        test('PowerShell preserves a native program failure exit code', async () => {
            const exitScript = path.join(directory, 'exit code.js');
            fs.writeFileSync(exitScript, 'process.exit(7);');
            const result = await execute(process.execPath, [exitScript], null, { shell: 'powershell', silent: true }).result;
            expect(result.retc, result.stderr).to.equal(7);
        });

        test('batch scripts with spaces and metacharacters in their paths still run', async () => {
            for (const extension of ['bat', 'cmd']) {
                const batchScript = path.join(directory, `echo %CMT_TEST_LITERAL% script.${extension}`);
                fs.writeFileSync(batchScript, '@echo off\r\necho CMT_BATCH_OK\r\n');
                for (const shell of [undefined, 'cmd']) {
                    const result = await execute(batchScript, [], null, {
                        shell,
                        silent: true,
                        environment: { CMT_TEST_LITERAL: 'EXPANDED' }
                    }).result;
                    expect(result.retc, result.stderr).to.equal(0);
                    expect(result.stdout.trim()).to.equal('CMT_BATCH_OK');
                }
            }
        });

        test('npm command shims forward literal arguments through their extra cmd parsing layer', async () => {
            const binDirectory = path.join(directory, 'node_modules', '.bin');
            fs.mkdirSync(binDirectory, { recursive: true });
            const shim = path.join(binDirectory, 'echo-args.cmd');
            fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
            const result = await execute(shim, args, null, {
                silent: true,
                environment: { CMT_TEST_LITERAL: 'EXPANDED' }
            }).result;
            expect(result.retc, result.stderr).to.equal(0);
            expect(JSON.parse(result.stdout)).to.deep.equal(args);
        });

        test('batch startup does not depend on the project PATH containing cmd', async () => {
            const batchScript = path.join(directory, 'restricted-path.bat');
            fs.writeFileSync(batchScript, '@echo off\r\necho CMT_BATCH_OK\r\n');
            const result = await execute(batchScript, [], null, {
                silent: true,
                environment: { PATH: directory }
            }).result;
            expect(result.retc, result.stderr).to.equal(0);
            expect(result.stdout.trim()).to.equal('CMT_BATCH_OK');
        });

        test('cmd rejects newline arguments instead of interpreting another command', async () => {
            const result = await execute(process.execPath, [script, 'first\r\necho CMT_INJECTED'], null, {
                shell: true,
                silent: true
            }).result;
            expect(result.retc).to.equal(-1);
            expect(result.stderr).to.contain('newline');
        });
    }
});

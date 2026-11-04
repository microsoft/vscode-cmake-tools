import { expect } from 'chai';
import { execute } from '@cmt/proc';
import { termProc } from '@cmt/util';

suite('Subprocess isolation', () => {
    test('preserves output and exit status', async () => {
        const result = await execute(process.execPath, ['-e', `
            process.stdout.write('stdout');
            process.stderr.write('stderr');
            process.exitCode = 7;
        `], undefined, { silent: true }).result;

        expect(result).to.deep.equal({ retc: 7, stdout: 'stdout', stderr: 'stderr' });
    });

    test('isolates commands using a shell', async function () {
        if (process.platform === 'win32') {
            this.skip();
        }

        const subprocess = execute('ps -o pgid= -p $$', undefined, undefined, { shell: true, silent: true });
        const result = await subprocess.result;

        expect(result.retc).to.equal(0);
        expect(Number(result.stdout.trim())).to.equal(subprocess.child?.pid);
    });

    test('survives cancellation of a tool that kills its process group', async function () {
        if (process.platform === 'win32') {
            this.skip();
        }

        let ready: () => void = () => {};
        const started = new Promise<void>(resolve => {
            ready = resolve;
        });
        const subprocess = execute('sh', ['-c', `
            pgid=$(ps -o pgid= -p $$ | tr -d ' ')
            # Do not signal the test runner if process isolation regresses.
            [ "$pgid" = "$$" ] || exit 42
            trap 'kill -KILL 0' INT
            echo ready
            while :; do sleep 1; done
        `], {
            output: line => {
                if (line === 'ready') {
                    ready();
                }
            },
            error: () => {}
        }, { silent: true, timeout: 5000 });

        try {
            await Promise.race([
                started,
                subprocess.result.then(result => {
                    throw new Error(`Tool exited before cancellation: ${JSON.stringify(result)}`);
                })
            ]);
            if (!subprocess.child) {
                throw new Error('Tool failed to start');
            }
            await termProc(subprocess.child);
            expect((await subprocess.result).retc).to.equal(null);
        } finally {
            if (subprocess.child?.exitCode === null && subprocess.child.signalCode === null) {
                subprocess.child.kill('SIGKILL');
            }
            await subprocess.result;
        }
    });
});

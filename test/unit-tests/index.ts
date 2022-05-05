// eslint-disable-next-line import/no-unassigned-import
import 'module-alias/register';

import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';
import { Logger } from '@cmt/logging';

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = __dirname;

    return new Promise((c, e) => {
        glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
            if (err) {
                return e(err);
            }

            // Add files to the test suite
            const regex = process.env.TEST_FILTER ? new RegExp(process.env.TEST_FILTER) : /.*/;
            files.forEach(f => {
                if (regex.test(f)) {
                    mocha.addFile(path.resolve(testsRoot, f));
                }
            });

            try {
                // Run the mocha test
                mocha.timeout(100000);

                // Log the name of each test before it starts.
                const beforeEach: Mocha.Func = function (this: Mocha.Context, done: Mocha.Done) {
                    Logger.logTestName(this.currentTest?.parent?.title, this.currentTest?.title);
                    done();
                };
                mocha.rootHooks({beforeEach});
                mocha.run(failures => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                e(err);
            }
        });
    });
}

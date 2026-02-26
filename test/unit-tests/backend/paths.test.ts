import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as which from 'which';

/**
 * Tests verifying that the `which` npm package respects the `path` option,
 * which is the mechanism used by paths.ts to search for cmake using a
 * kit's environmentSetupScript-modified PATH.
 */
suite('[Paths - which with custom PATH]', () => {
    let tmpDir: string;

    setup(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-paths-test-'));
    });

    teardown(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('which finds executable on custom search PATH', async () => {
        // Create a fake executable in our temp directory.
        // On Windows, which uses PATHEXT (.EXE;.CMD;.BAT;.COM) to find executables,
        // so the file needs a recognized extension.
        const isWindows = process.platform === 'win32';
        const fakeName = isWindows ? 'cmt-test-fake-exe.cmd' : 'cmt-test-fake-exe';
        const fakePath = path.join(tmpDir, fakeName);
        const searchName = isWindows ? 'cmt-test-fake-exe' : fakeName;
        if (isWindows) {
            fs.writeFileSync(fakePath, '@echo off\r\necho hello\r\n');
        } else {
            fs.writeFileSync(fakePath, '#!/bin/sh\necho hello\n');
            fs.chmodSync(fakePath, 0o755);
        }

        // which should find it when we pass our tmpDir as the search path
        const result = await which(searchName, { path: tmpDir });
        expect(result).to.equal(fakePath);
    });

    test('which does not find executable when custom PATH does not include its directory', async () => {
        // Create a fake executable in our temp directory
        const isWindows = process.platform === 'win32';
        const fakeName = isWindows ? 'cmt-test-fake-exe-missing.cmd' : 'cmt-test-fake-exe-missing';
        const fakePath = path.join(tmpDir, fakeName);
        const searchName = isWindows ? 'cmt-test-fake-exe-missing' : fakeName;
        if (isWindows) {
            fs.writeFileSync(fakePath, '@echo off\r\necho hello\r\n');
        } else {
            fs.writeFileSync(fakePath, '#!/bin/sh\necho hello\n');
            fs.chmodSync(fakePath, 0o755);
        }

        // Create a different empty directory that doesn't contain the executable
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-paths-empty-'));
        try {
            let found: string | null = null;
            try {
                found = await which(searchName, { path: emptyDir });
            } catch {
                found = null;
            }
            expect(found).to.be.null;
        } finally {
            fs.rmSync(emptyDir, { recursive: true, force: true });
        }
    });

    test('which falls back to process.env.PATH when no custom path is given', async () => {
        // When no path option is provided, which searches process.env.PATH
        // This should find a common system executable on any platform
        const exeName = process.platform === 'win32' ? 'cmd' : 'sh';
        const result = await which(exeName);
        expect(result).to.not.be.null;
    });
});

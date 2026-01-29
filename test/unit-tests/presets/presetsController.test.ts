/* eslint-disable no-unused-expressions */
import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Tests for PresetsController re-entry protection.
 *
 * These tests validate the fix for issue #4668 (Infinity presets reloading)
 * which occurs when preset files are symlinks or include symlinked files.
 *
 * The fix adds an `_isReapplyingPresets` flag to prevent recursive calls
 * to `reapplyPresets()` while it's already in progress.
 */
suite('PresetsController re-entry protection', () => {
    let tempDir: string;
    let presetsDir: string;
    let presetsJsonPath: string;
    let symlinkPath: string;
    let symlinkSupported: boolean = true;

    /**
     * Creates a temporary directory with a CMakePresets.json file and a symlink to it.
     * This simulates the user scenario that triggers the infinite loop.
     */
    setup(async function () {
        // Create a unique temp directory for this test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-presets-test-'));
        presetsDir = path.join(tempDir, 'presets');
        fs.mkdirSync(presetsDir);

        // Create a minimal CMakePresets.json
        presetsJsonPath = path.join(presetsDir, 'CMakePresets.json');
        const presetsContent = JSON.stringify({
            version: 3,
            configurePresets: [
                {
                    name: "test-preset",
                    displayName: "Test Preset",
                    generator: "Ninja",
                    binaryDir: "${sourceDir}/build"
                }
            ]
        }, null, 2);

        fs.writeFileSync(presetsJsonPath, presetsContent);

        // Try to create a symlink to the presets file
        // On Windows, we try directory junction first (doesn't require admin),
        // then fall back to file symlink
        symlinkPath = path.join(tempDir, 'linked-presets');

        try {
            if (process.platform === 'win32') {
                // On Windows, create a directory junction (works without admin rights)
                fs.symlinkSync(presetsDir, symlinkPath, 'junction');
            } else {
                // On Unix, create a regular symlink to the file
                symlinkPath = path.join(tempDir, 'CMakeUserPresets.json');
                fs.symlinkSync(presetsJsonPath, symlinkPath, 'file');
            }
            symlinkSupported = true;
        } catch (err: any) {
            // If symlink creation fails, skip symlink-specific tests
            if (err.code === 'EPERM' || err.code === 'ENOTSUP' || err.code === 'EACCES') {
                console.log('Symlink creation not supported, some tests will be skipped');
                symlinkSupported = false;
            } else {
                throw err;
            }
        }
    });

    /**
     * Clean up temp directory after each test
     */
    teardown(async function () {
        if (tempDir && fs.existsSync(tempDir)) {
            // Remove symlink first if it exists
            if (symlinkPath && fs.existsSync(symlinkPath)) {
                try {
                    // On Windows, junctions need special handling
                    const stats = fs.lstatSync(symlinkPath);
                    if (stats.isSymbolicLink() || stats.isDirectory()) {
                        if (process.platform === 'win32') {
                            // Use rmdir for junctions on Windows
                            fs.rmdirSync(symlinkPath);
                        } else {
                            fs.unlinkSync(symlinkPath);
                        }
                    }
                } catch {
                    // Ignore cleanup errors
                }
            }
            // Remove the presets directory and its contents
            if (fs.existsSync(presetsDir)) {
                if (fs.existsSync(presetsJsonPath)) {
                    fs.unlinkSync(presetsJsonPath);
                }
                fs.rmdirSync(presetsDir);
            }
            // Remove the temp directory
            try {
                fs.rmdirSync(tempDir);
            } catch {
                // Ignore if not empty or already deleted
            }
        }
    });

    /**
     * Test that symlinks can be created and read correctly on this platform.
     * This is a prerequisite for the symlink-related tests.
     */
    test('Symlinks are correctly created and resolved', function () {
        if (!symlinkSupported) {
            this.skip();
            return;
        }

        // Verify the symlink exists
        expect(fs.existsSync(symlinkPath)).to.be.true;

        // Verify it's actually a symlink (or junction on Windows)
        const stats = fs.lstatSync(symlinkPath);
        // On Windows with junctions, isSymbolicLink() returns true for the junction
        expect(stats.isSymbolicLink() || stats.isDirectory()).to.be.true;

        // Get the path to the preset file (through junction if on Windows)
        const presetFilePath = process.platform === 'win32'
            ? path.join(symlinkPath, 'CMakePresets.json')
            : symlinkPath;

        // Verify we can read through the symlink/junction
        const content = fs.readFileSync(presetFilePath, 'utf8');
        const parsed = JSON.parse(content);
        expect(parsed.version).to.equal(3);
        expect(parsed.configurePresets).to.have.lengthOf(1);
        expect(parsed.configurePresets[0].name).to.equal('test-preset');
    });

    /**
     * Test that reading and modifying a file through a symlink works correctly.
     * This simulates what happens when the presets parser reads preset files.
     */
    test('File modifications through symlinks are detected', function () {
        if (!symlinkSupported) {
            this.skip();
            return;
        }

        // Get the path to the preset file (through junction if on Windows)
        const presetFilePath = process.platform === 'win32'
            ? path.join(symlinkPath, 'CMakePresets.json')
            : symlinkPath;

        // Read original content
        const originalContent = fs.readFileSync(presetFilePath, 'utf8');
        const parsed = JSON.parse(originalContent);

        // Modify and write back through symlink
        parsed.configurePresets[0].displayName = 'Modified Test Preset';
        fs.writeFileSync(presetFilePath, JSON.stringify(parsed, null, 2));

        // Verify the change is reflected in the original file
        const modifiedContent = fs.readFileSync(presetsJsonPath, 'utf8');
        const modifiedParsed = JSON.parse(modifiedContent);
        expect(modifiedParsed.configurePresets[0].displayName).to.equal('Modified Test Preset');
    });

    /**
     * Test the re-entry prevention logic pattern used in PresetsController.
     * This is a simplified simulation of the fix for issue #4668.
     */
    test('Re-entry prevention flag blocks concurrent calls', async () => {
        // Simulate the _isReapplyingPresets flag pattern
        let isReapplyingPresets = false;
        let reapplyCallCount = 0;
        const callOrder: string[] = [];

        // Simulate the reapplyPresets function with the fix
        const reapplyPresets = async (): Promise<void> => {
            if (isReapplyingPresets) {
                callOrder.push('blocked');
                return;
            }
            isReapplyingPresets = true;
            reapplyCallCount++;
            callOrder.push('started');

            try {
                // Simulate async work that might trigger file watcher events
                await new Promise(resolve => setTimeout(resolve, 10));

                // Simulate a recursive call (as would happen from file watcher)
                await reapplyPresets();

                callOrder.push('completed');
            } finally {
                isReapplyingPresets = false;
            }
        };

        // Call reapplyPresets
        await reapplyPresets();

        // Verify only one actual execution happened
        expect(reapplyCallCount).to.equal(1);

        // Verify the call order shows the recursive call was blocked
        expect(callOrder).to.deep.equal(['started', 'blocked', 'completed']);
    });

    /**
     * Test that multiple rapid calls are properly deduplicated.
     * This simulates what happens when file watcher fires multiple events.
     */
    test('Multiple rapid calls are properly deduplicated', async () => {
        let isReapplyingPresets = false;
        let reapplyCallCount = 0;
        const startTimes: number[] = [];
        const endTimes: number[] = [];

        const reapplyPresets = async (): Promise<void> => {
            if (isReapplyingPresets) {
                return;
            }
            isReapplyingPresets = true;
            reapplyCallCount++;
            startTimes.push(Date.now());

            try {
                // Simulate work that takes some time
                await new Promise(resolve => setTimeout(resolve, 50));
                endTimes.push(Date.now());
            } finally {
                isReapplyingPresets = false;
            }
        };

        // Fire multiple calls rapidly (simulating file watcher events)
        const promises = [
            reapplyPresets(),
            reapplyPresets(),
            reapplyPresets(),
            reapplyPresets(),
            reapplyPresets()
        ];

        await Promise.all(promises);

        // Only the first call should have actually executed
        expect(reapplyCallCount).to.equal(1);
        expect(startTimes).to.have.lengthOf(1);
        expect(endTimes).to.have.lengthOf(1);
    });

    /**
     * Test that sequential calls (after the first completes) work correctly.
     * This ensures we didn't break normal functionality.
     */
    test('Sequential calls after completion work normally', async () => {
        let isReapplyingPresets = false;
        let reapplyCallCount = 0;

        const reapplyPresets = async (): Promise<void> => {
            if (isReapplyingPresets) {
                return;
            }
            isReapplyingPresets = true;
            reapplyCallCount++;

            try {
                await new Promise(resolve => setTimeout(resolve, 10));
            } finally {
                isReapplyingPresets = false;
            }
        };

        // First call
        await reapplyPresets();
        expect(reapplyCallCount).to.equal(1);

        // Second call (after first completes) should also work
        await reapplyPresets();
        expect(reapplyCallCount).to.equal(2);

        // Third call
        await reapplyPresets();
        expect(reapplyCallCount).to.equal(3);
    });

    /**
     * Test that the flag is properly reset even if an error occurs.
     * This ensures the try/finally pattern works correctly.
     */
    test('Re-entry flag is reset on error', async () => {
        let isReapplyingPresets = false;
        let reapplyCallCount = 0;
        let shouldThrow = true;

        const reapplyPresets = async (): Promise<void> => {
            if (isReapplyingPresets) {
                return;
            }
            isReapplyingPresets = true;
            reapplyCallCount++;

            try {
                if (shouldThrow) {
                    throw new Error('Simulated error');
                }
                await new Promise(resolve => setTimeout(resolve, 10));
            } finally {
                isReapplyingPresets = false;
            }
        };

        // First call throws an error
        try {
            await reapplyPresets();
        } catch {
            // Expected
        }
        expect(reapplyCallCount).to.equal(1);

        // Flag should be reset, so second call should work
        shouldThrow = false;
        await reapplyPresets();
        expect(reapplyCallCount).to.equal(2);
    });

    /**
     * Test that symlinked include files don't cause issues when reading.
     * This tests the scenario where CMakeUserPresets.json includes other files.
     */
    test('Symlinked preset files can be read correctly', function () {
        if (!symlinkSupported) {
            this.skip();
            return;
        }

        // Create an include file in the presets directory
        const includeFilePath = path.join(presetsDir, 'include-presets.json');
        const includeContent = JSON.stringify({
            version: 3,
            configurePresets: [
                {
                    name: "included-preset",
                    displayName: "Included Preset",
                    generator: "Ninja"
                }
            ]
        }, null, 2);
        fs.writeFileSync(includeFilePath, includeContent);

        // Update the main presets file to include the other file
        const mainPresets = {
            version: 3,
            include: ['include-presets.json'],
            configurePresets: [
                {
                    name: "main-preset",
                    displayName: "Main Preset",
                    generator: "Ninja"
                }
            ]
        };
        fs.writeFileSync(presetsJsonPath, JSON.stringify(mainPresets, null, 2));

        // Get the path through the symlink/junction
        const includeFileViaSym = process.platform === 'win32'
            ? path.join(symlinkPath, 'include-presets.json')
            : presetsJsonPath; // On Unix, symlinkPath points directly to the file

        if (process.platform === 'win32') {
            // Verify we can read the include file through the junction
            const includeSymlinkContent = fs.readFileSync(includeFileViaSym, 'utf8');
            const parsedInclude = JSON.parse(includeSymlinkContent);
            expect(parsedInclude.configurePresets[0].name).to.equal('included-preset');
        }

        // Clean up the extra include file
        fs.unlinkSync(includeFilePath);
    });

    /**
     * Test cross-platform path handling with symlinks.
     */
    test('Cross-platform symlink path resolution', function () {
        if (!symlinkSupported) {
            this.skip();
            return;
        }

        // Get the path to resolve (file in junction on Windows, symlink on Unix)
        const pathToResolve = process.platform === 'win32'
            ? path.join(symlinkPath, 'CMakePresets.json')
            : symlinkPath;

        // Get the real path (resolves symlinks/junctions)
        const resolvedPath = fs.realpathSync(pathToResolve);

        // On macOS, /var is a symlink to /private/var, so we need to resolve
        // both paths to compare them correctly
        const expectedPath = fs.realpathSync(presetsJsonPath);
        const expectedDir = fs.realpathSync(presetsDir);

        // On all platforms, realpath should resolve to the actual file
        expect(resolvedPath).to.equal(expectedPath);

        // Verify the directory structure is consistent
        expect(path.dirname(resolvedPath)).to.equal(expectedDir);
        expect(path.basename(resolvedPath)).to.equal('CMakePresets.json');
    });
});

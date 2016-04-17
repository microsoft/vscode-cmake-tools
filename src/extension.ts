'use strict';

import * as vscode from 'vscode';
import * as proc from 'child_process';
import * as fs from 'fs';
import * as path from 'path';


export function activate(context: vscode.ExtensionContext) {
    // Create an output channel where the configure and build output will go
    const channel = vscode.window.createOutputChannel('CMake/Build');

    // The diagnostics collection we talk to
    let cmake_diagnostics = vscode.languages.createDiagnosticCollection('cmake-diags');

    // Get the configuration
    function cmakeConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('cmake');
    }

    // Get the value of a CMake configuration setting
    function config<T>(path: string, defaultValue?: T): T {
        return cmakeConfig().get<T>(path, defaultValue);
    }

    // Wrap a Node-style function that takes a callback in a promise, making it awaitable
    function doAsync<T>(fn: Function, ...args): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            fn(...args, resolve);
        });
    }

    // Returns the build directory
    function buildDirectory(): string {
        const build_dir = config<string>('buildDirectory');
        return build_dir.replace('${workspaceRoot}', vscode.workspace.rootPath);
    }

    // Test that a command exists
    const testHaveCommand = async function (command, args: string[] = ['--version']): Promise<Boolean> {
        return await new Promise<Boolean>((resolve, _) => {
            const pipe = proc.spawn(command, args);
            pipe.on('error', () => resolve(false));
            pipe.on('exit', () => resolve(true));
        });
    }

    // Given a list of CMake generators, returns the first one available
    const pickGenerator = async function (candidates: string[]): Promise<string> {
        for (const gen of candidates) {
            const delegate = {
                Ninja: async function () { return await testHaveCommand('ninja'); },
                "MinGW Makefiles": async function () {
                    return process.platform === 'win32' && await testHaveCommand('make');
                },
                "NMake Makefiles": async function () {
                    return process.platform === 'win32' && await testHaveCommand('nmake', ['/?']);
                },
                'Unix Makefiles': async function () {
                    return process.platform !== 'win32' && await testHaveCommand('make');
                }
            }[gen];
            if (delegate === undefined) {
                vscode.window.showErrorMessage('Unknown CMake generator "' + gen + '"');
                continue;
            }
            if (await delegate())
                return gen;
            else
                console.log('Genereator "' + gen + '" is not supported');
        }
        return null;
    }

    function executeCMake(args: string[]): Promise<void> {
        return new Promise<void>((resolve, _) => {
            console.info('Execute cmake with arguments:', args);
            const pipe = proc.spawn('cmake', args);
            const status = vscode.window.setStatusBarMessage;
            status('Executing CMake...', 1000);
            channel.appendLine('[vscode] Executing cmake command: cmake ' + args.join(' '));
            let stderr_acc = '';
            pipe.stdout.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stdout]: ' + str.trim());
                channel.append(str);
                status('cmake: ' + str.trim(), 1000);
            });
            pipe.stderr.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stderr]: ' + str.trim());
                stderr_acc += str;
                channel.append(str);
                status('cmake: ' + str.trim(), 1000);
            });
            pipe.on('close', (retc: Number) => {
                console.log('cmake exited with return code ' + retc);
                channel.appendLine('[vscode] CMake exited with status ' + retc);
                status('CMake exited with status ' + retc, 3000);
                if (retc !== 0) {
                    vscode.window.showErrorMessage('CMake exited with non-zero return code ' + retc + '. See CMake/Build output for details');
                }

                let rest = stderr_acc;
                const diag_re = /CMake (.*?) at (.*?):(\d+) \((.*?)\):\s+((?:.|\n)*?)\s*\n\n\n((?:.|\n)*)/;
                const diags: Object = {};
                while (true) {
                    if (!rest.length) break;
                    const found = diag_re.exec(rest);
                    if (!found) break;
                    const [level, filename, linestr, command, what, tail] = found.slice(1);
                    const filepath =
                        path.isAbsolute(filename)
                            ? filename
                            : path.join(vscode.workspace.rootPath, filename);

                    const line = Number.parseInt(linestr) - 1;
                    if (!(filepath in diags)) {
                        diags[filepath] = [];
                    }
                    const file_diags: vscode.Diagnostic[] = diags[filepath];
                    const diag = new vscode.Diagnostic(
                        new vscode.Range(
                            line,
                            0,
                            line,
                            Number.POSITIVE_INFINITY
                        ),
                        what,
                        {
                            "Warning": vscode.DiagnosticSeverity.Warning,
                            "Error": vscode.DiagnosticSeverity.Error,
                        }[level]
                    );
                    diag.source = 'CMake (' + command + ')';
                    file_diags.push(diag);
                    rest = tail;
                }

                cmake_diagnostics.clear();
                for (const filepath in diags) {
                    cmake_diagnostics.set(vscode.Uri.file(filepath), diags[filepath]);
                }
                resolve();
            });
        });
    };

    const cmakeConfigure = async function(extra_args: string[] = []): Promise<void> {
        const source_dir = vscode.workspace.rootPath;
        if (!source_dir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return;
        }
        const cmake_list = path.join(source_dir, 'CMakeLists.txt');
        const binary_dir = buildDirectory();

        const cmake_cache = path.join(binary_dir, "CMakeCache.txt");
        channel.show();

        const settings_args = ['--no-warn-unused-cli'];
        if (!(await doAsync(fs.exists, cmake_cache))) {
            channel.appendLine("[vscode] Setting up initial CMake configuration");
            const generator = await pickGenerator(config<string[]>("preferredGenerators"));
            if (generator) {
                channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
            }
            else {
                console.error("None of the preferred generators was selected");
            }

            settings_args.push("-DCMAKE_BUILD_TYPE=" + config<string>("initialBuildType"));
        }

        const settings = config<Object>("configureSettings");
        for (const key in settings) {
            let value = settings[key];
            if (value === true || value === false)
                value = value ? "TRUE" : "FALSE";
            if (value instanceof Array)
                value = value.join(';');
            settings_args.push("-D" + key + "=" + value);
        }

        await executeCMake(
            ['-H' + source_dir, '-B' + binary_dir]
                .concat(settings_args)
                .concat(extra_args)
        );
    }

    const cmakeBuild = async function(target: string = 'all') {
        const source_dir = vscode.workspace.rootPath;
        if (!source_dir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return;
        }
        const binary_dir = buildDirectory();
        const cmake_cache = path.join(binary_dir, 'CMakeCache.txt');
        if (!(await doAsync(fs.exists, cmake_cache))) {
            const do_configure = !!(await vscode.window.showErrorMessage('You must configure your project before building', 'Configure Now'));
            if (do_configure)
                await cmakeConfigure();
            else
                return;
        }

        channel.show();
        await executeCMake(['--build', binary_dir, '--target', target]);
    };

    const cmakeClean = async function() {
        await cmakeBuild('clean');
    };

    const configure = vscode.commands.registerCommand('cmake.configure', async function (extra_args: string[] = []) {
        return cmakeConfigure();
    });

    const build = vscode.commands.registerCommand('cmake.build', async function () {
        await cmakeBuild();
    });

    const build_target = vscode.commands.registerCommand('cmake.buildWithTarget', async function () {
        const target: string = await vscode.window.showInputBox({
            prompt: 'Enter the name of a target to build',
        });
        vscode.commands.executeCommand('cmake.build', target);
    });

    const set_build_type = vscode.commands.registerCommand('cmake.setBuildType', async function () {
        const build_type = await vscode.window.showQuickPick<any>([{
            label: 'Release',
            description: 'Optimized build with no debugging information',
        }, {
                label: 'Debug',
                description: 'Default build type. No optimizations. Contains debug information',
            }, {
                label: 'MinSizeRel',
                description: 'Release build tweaked for minimum binary code size',
            }, {
                label: 'RelWithDebInfo',
                description: 'Same as "Release", but also generates debugging information',
            }]);

        vscode.commands.executeCommand('cmake.configure', ['-DCMAKE_BUILD_TYPE=' + build_type.label])
    })

    const clean_configure = vscode.commands.registerCommand('cmake.cleanConfigure', async function () {
        const build_dir = buildDirectory();
        const cmake_cache = path.join(build_dir, 'CMakeCache.txt');
        const cmake_files = path.join(build_dir, 'CMakeFiles');
        if (await doAsync(fs.exists, cmake_cache)) {
            channel.appendLine('[vscode] Removing ' + cmake_cache);
            await doAsync(fs.unlink, cmake_cache);
        }
        if (await doAsync(fs.exists, cmake_files)) {
            channel.appendLine('[vscode] Removing ' + cmake_files);
            await doAsync(fs.unlink, cmake_files);
        }
        await vscode.commands.executeCommand('cmake.configure');
    });

    const clean = vscode.commands.registerCommand("cmake.clean", async function () {
        await cmakeClean();
    });

    const clean_rebuild = vscode.commands.registerCommand('cmake.cleanRebuild', async function () {
        await cmakeClean();
        await cmakeBuild();
    });

    const ctest = vscode.commands.registerCommand('cmake.ctest', async function () {
        executeCMake(['-E', 'chdir', buildDirectory(), 'ctest', '-j8', '--output-on-failure']);
    });

    const jump_to_cache = vscode.commands.registerCommand('cmake.jumpToCacheFile', async function() {
        const cache_file = path.join(buildDirectory(), 'CMakeCache.txt');

        if (!(await doAsync(fs.exists, cache_file))) {
            const do_conf = !!(await vscode.window.showErrorMessage('This project has not yet been configured.', 'Configure Now'));
            if (do_conf)
                await cmakeConfigure();
        }

        const cache = await vscode.workspace.openTextDocument(cache_file);
        await vscode.window.showTextDocument(cache);
    });

    // const ctest = vscode.commands.register

    for (const item of [
            configure,
            build,
            build_target,
            set_build_type,
            clean_configure,
            clean,
            clean_rebuild,
            jump_to_cache,
            cmake_diagnostics,
        ])
        context.subscriptions.push(item);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
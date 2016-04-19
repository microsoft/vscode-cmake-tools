'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as proc from 'child_process';

import * as vscode from 'vscode';

import * as async from './async';

export class CMakeTools {
    private channel: vscode.OutputChannel;
    private diagnostics: vscode.DiagnosticCollection;

    constructor() {
        this.channel = vscode.window.createOutputChannel('CMake/Build');
        this.diagnostics = vscode.languages.createDiagnosticCollection('cmake-diags');
    }

    public config<T>(key: string, defaultValue?: any): T {
        const cmake_conf = vscode.workspace.getConfiguration('cmake');
        return cmake_conf.get<T>(key, defaultValue);
    }

    public get sourceDir() : string {
        return vscode.workspace.rootPath;
    }


    public get mainListFile() : string {
        return path.join(this.sourceDir, 'CMakeLists.txt');
    }


    public get binaryDir(): string {
        const build_dir = this.config<string>('buildDirectory');
        return build_dir.replace('${workspaceRoot}', vscode.workspace.rootPath);
    }

    public get cachePath() : string {
        return path.join(this.binaryDir, 'CMakeCache.txt');
    }

    public execute(args: string[]): Promise<Number> {
        return new Promise<Number>((resolve, _) => {
            console.info('Execute cmake with arguments:', args);
            const pipe = proc.spawn('cmake', args);
            const status = vscode.window.setStatusBarMessage;
            status('Executing CMake...', 1000);
            this.channel.appendLine('[vscode] Executing cmake command: cmake ' + args.join(' '));
            let stderr_acc = '';
            pipe.stdout.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stdout]: ' + str.trim());
                this.channel.append(str);
                status('cmake: ' + str.trim(), 1000);
            });
            pipe.stderr.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stderr]: ' + str.trim());
                stderr_acc += str;
                this.channel.append(str);
                status('cmake: ' + str.trim(), 1000);
            });
            pipe.on('close', (retc: Number) => {
                console.log('cmake exited with return code ' + retc);
                this.channel.appendLine('[vscode] CMake exited with status ' + retc);
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

                this.diagnostics.clear();
                for (const filepath in diags) {
                    this.diagnostics.set(vscode.Uri.file(filepath), diags[filepath]);
                }
                resolve(retc);
            });
        });
    };

    // Test that a command exists
    public testHaveCommand = async function (command, args: string[] = ['--version']): Promise<Boolean> {
        return await new Promise<Boolean>((resolve, _) => {
            const pipe = proc.spawn(command, args);
            pipe.on('error', () => resolve(false));
            pipe.on('exit', () => resolve(true));
        });
    }

    // Given a list of CMake generators, returns the first one available on this system
    public pickGenerator = async function (candidates: string[]): Promise<string> {
        const _this: CMakeTools = this;
        for (const gen of candidates) {
            const delegate = {
                Ninja: async function () {
                    return await _this.testHaveCommand('ninja-build') || await _this.testHaveCommand('ninja');
                },
                "MinGW Makefiles": async function () {
                    return process.platform === 'win32' && await _this.testHaveCommand('make');
                },
                "NMake Makefiles": async function () {
                    return process.platform === 'win32' && await _this.testHaveCommand('nmake', ['/?']);
                },
                'Unix Makefiles': async function () {
                    return process.platform !== 'win32' && await _this.testHaveCommand('make');
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

    public configure = async function(extra_args: string[] = []): Promise<Number> {
        const _this: CMakeTools = this;
        if (!_this.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return;
        }

        const cmake_list = _this.mainListFile;
        if (!(await async.exists(cmake_list))) {
            const do_quickstart = !!(
                await vscode.window.showErrorMessage(
                    'You do not have a CMakeLists.txt',
                    "Quickstart a new CMake project"
                )
            );
            if (do_quickstart)
                await _this.quickStart();
            return;
        }

        const binary_dir = _this.binaryDir;
        const cmake_cache = _this.cachePath;
        _this.channel.show();
        const settings_args = [];
        if (!(await async.exists(cmake_cache))) {
            this.channel.appendLine("[vscode] Setting up initial CMake configuration");
            const generator = await _this.pickGenerator(_this.config<string[]>("preferredGenerators"));
            if (generator) {
                this.channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
            }
            else {
                console.error("None of the preferred generators was selected");
            }

            settings_args.push("-DCMAKE_BUILD_TYPE=" + _this.config<string>("initialBuildType"));
        }

        const settings = _this.config<Object>("configureSettings");
        for (const key in settings) {
            let value = settings[key];
            if (value === true || value === false)
                value = value ? "TRUE" : "FALSE";
            if (value instanceof Array)
                value = value.join(';');
            settings_args.push("-D" + key + "=" + value);
        }

        return await _this.execute(
            ['-H' + _this.sourceDir, '-B' + binary_dir]
                .concat(settings_args)
                .concat(extra_args)
        );
    }

    public build = async function(target: string = 'all'): Promise<Number> {
        const _this: CMakeTools = this;
        if (!_this.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return;
        }
        const cachepath = _this.cachePath;
        if (!(await async.exists(cachepath))) {
            const do_configure = !!(await vscode.window.showErrorMessage('You must conifigure your project before building', 'Configure Now'));
            if (!do_configure || await _this.configure() !== 0)
                return -1;
        }
        _this.channel.show();
        return await _this.execute(['--build', _this.binaryDir, '--target', target]);
    }

    public clean = async function(): Promise<Number> {
        const _this: CMakeTools = this;
        return await _this.build('clean');
    }

    public cleanConfigure = async function(): Promise<Number> {
        const _this: CMakeTools = this;
        const build_dir = _this.binaryDir;
        const cache = _this.cachePath;
        const cmake_files = path.join(build_dir, 'CMakeFiles');
        if (await async.exists(cache)) {
            _this.channel.appendLine('[vscode] Removing ' + cache);
            await async.unlink(cache);
        }
        if (await async.exists(cmake_files)) {
            _this.channel.appendLine('[vscode] Removing ' + cmake_files);
            await async.unlink(cmake_files);
        }
        return await _this.configure();
    }

    public jumpToCacheFile = async function(): Promise<vscode.TextEditor> {
        const _this: CMakeTools = this;
        if (!(await async.exists(_this.cachePath))) {
            const do_conf = !!(await vscode.window.showErrorMessage('This project has not yet been configured.', 'Configure Now'));
            if (do_conf)
            {
                if (await _this.configure() !== 0)
                    return;
            }
        }

        const cache = await vscode.workspace.openTextDocument(_this.cachePath);
        return await vscode.window.showTextDocument(cache);
    }

    public cleanRebuild = async function(): Promise<Number> {
        const _this: CMakeTools = this;
        const clean_result = await _this.clean();
        if (clean_result)
            return clean_result;
        return await _this.build();
    }

    public buildWithTarget = async function(): Promise<Number> {
        const _this: CMakeTools = this;
        const target = await vscode.window.showInputBox({
            prompt: 'Enter a target name',
        });
        return await _this.build(target);
    }

    public setBuildType = async function(): Promise<Number> {
        const _this: CMakeTools = this;
        const chosen = await vscode.window.showQuickPick([{
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

        return await _this.configure(['-DCMAKE_BUILD_TYPE=' + chosen.label]);
    }

    public ctest = async function(): Promise<Number> {
        const _this: CMakeTools = this;
        return await _this.execute(['-E', 'chdir', _this.binaryDir, 'ctest', '-j8', '--output-on-failure']);
    }

    public quickStart = async function(): Promise<Number> {
        const _this: CMakeTools = this;
        if (await async.exists(_this.mainListFile)) {
            vscode.window.showErrorMessage('This workspace already contains a CMakeLists.txt!');
            return -1;
        }

        const project_name = await vscode.window.showInputBox({
            prompt: 'Enter a name for the new project',
            validateInput: (value: string): string => {
                if (!value.length)
                    return 'A project name is required';
                return null;
            },
        });
        if (!project_name)
            return -1;

        const target_type = (await vscode.window.showQuickPick([{
            label: 'Library',
            description: 'Create a library',
        }, {
            label: 'Executable',
            description: 'Create an executable'
        }]));

        if (!target_type)
            return -1;

        const type = target_type.label;

        const init = [
            'cmake_minimum_required(VERSION 3.0.0)',
            `project(${project_name} VERSION 0.0.0)`,
            '',
            'include(CTest)',
            'enable_testing()',
            '',
            {
                Library: `add_library(${project_name} ${project_name}.cpp)`,
                Executable: `add_executable(${project_name} main.cpp)`,
            }[type],
            '',
            'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
            'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
            'include(CPack)',
            '',
        ].join('\n');

        if (type === 'Library') {
            if (!(await async.exists(path.join(_this.sourceDir, project_name + '.cpp')))) {
                await async.doAsync(
                    fs.writeFile,
                    path.join(_this.sourceDir, project_name + '.cpp'),
                    [
                        '#include <iostream>',
                        '',
                        `void say_hello(){ std::cout << "Hello, from ${project_name}!\\n"; }`,
                        '',
                    ].join('\n')
                );
            }
        } else {
            if (!(await async.exists(path.join(_this.sourceDir, 'main.cpp')))) {
                await async.doAsync(
                    fs.writeFile,
                    path.join(_this.sourceDir, 'main.cpp'),
                    [
                        '#include <iostream>',
                        '',
                        'int main(int, char**)',
                        '{',
                        '   std::cout << "Hello, world!\\n";',
                        '}',
                        '',
                    ].join('\n')
                );
            }
        }
        await async.doAsync(fs.writeFile, _this.mainListFile, init);
        const doc = await vscode.workspace.openTextDocument(_this.mainListFile);
        await vscode.window.showTextDocument(doc);
        await _this.configure();
    }
}

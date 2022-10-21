/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as vscode from 'vscode';

/**
 * API version information.
 */
export enum Version {
    v1 = 1,         // 1.x.x
    latest = v1,
}

/**
 * The interface provided by the CMake Tools extension during activation.
 * It is recommended to use the helper function [getCMakeToolsApi](#getCMakeToolsApi)
 * instead of querying the extension instance directly.
 */
export interface CMakeToolsExtensionExports {
    /**
     * Get an API object.
     * @param version The desired API version.
     */
    getApi(version: Version): CMakeToolsApi;
}

/**
 * An interface to allow VS Code extensions to interact with the CMake Tools extension.
 */
export interface CMakeToolsApi {
    /**
     * The version of the API.
     */
    readonly version: Version;

    /**
     * Shows the given UI element.
     * @param element Element to show.
     */
    showUIElement(element: UIElement): Promise<void>;

    /**
     * Hides the given UI element.
     * @param element Element to hide.
     */
    hideUIElement(element: UIElement): Promise<void>;

    /**
     * An event that fires when the selected build target changes.
     */
    readonly onBuildTargetChanged: vscode.Event<string>;

    /**
     * An event that fires when the selected launch target changes.
     */
    readonly onLaunchTargetChanged: vscode.Event<string>;

    /**
     * An event that fires when the active project changes.
     */
    readonly onActiveProjectChanged: vscode.Event<vscode.Uri | undefined>;

    /**
     * Gets the project associated with the given file or folder, if it exists.
     * @param path The file or folder to get the project for.
     */
    getProject(path: vscode.Uri): Promise<Project | undefined>;
}

export enum UIElement {
    StatusBarLaunchButton,
    StatusBarDebugButton,
}

export interface Project {
    /**
     * Gets the code model for this project if it is available.
     */
    readonly codeModel: CodeModel.Content | undefined;

    /**
     * An event that fires when the code model for this project is updated.
     */
    readonly onCodeModelChanged: vscode.Event<void>;

    // TODO: add configure, build, install, etc. and buildDirectory, activeBuildType, etc.
}

export namespace CodeModel {
    export type TargetType =
    'STATIC_LIBRARY'
    | 'MODULE_LIBRARY'
    | 'SHARED_LIBRARY'
    | 'OBJECT_LIBRARY'
    | 'EXECUTABLE'
    | 'UTILITY'
    | 'INTERFACE_LIBRARY';

    /**
     * Describes a CMake target.
     */
    export interface Target {
        /**
         * A string specifying the logical name of the target.
         *
         * (Source CMake Documentation cmake-file-api(7))
         */
        readonly name: string;

        /**
         * A string specifying the type of the target.
         * The value is one of EXECUTABLE, STATIC_LIBRARY, SHARED_LIBRARY, MODULE_LIBRARY, OBJECT_LIBRARY, or UTILITY.
         *
         * (Source CMake Documentation cmake-file-api(7))
         *
         * \todo clarify need of INTERFACE_LIBRARY type
         */
        type: TargetType;

        /** A string specifying the absolute path to the target’s source directory. */
        sourceDirectory?: string;

        /** Name of the target artifact on disk (library or executable file name). */
        fullName?: string;

        /** List of absolute paths to a target´s build artifacts. */
        artifacts?: string[];

        /**
         * The file groups describe a list of compilation information for artifacts of this target.
         * The file groups contains source code files that use the same compilation information
         * and are known by CMake.
         */
        fileGroups?: FileGroup[];

        /**
         * Represents the CMAKE_SYSROOT variable
         */
        sysroot?: string;
    }

    /**
     * Describes a file group to describe the build settings.
     */
    export interface FileGroup {
        /** List of source files with the same compilation information */
        sources: string[];

        /** Specifies the language (C, C++, ...) for the toolchain */
        language?: string;

        /** Include paths for compilation of a source file */
        includePath?: {
            /** include path */
            path: string;
        }[];

        /** Compiler flags */
        compileCommandFragments?: string[];

        /** Defines */
        defines?: string[];

        /** CMake generated file group */
        isGenerated: boolean;
    }

    /**
     * Describes cmake project and all its related targets
     */
    export interface Project {
        /** Name of the project */
        name: string;

        /** List of targets */
        targets: Target[];

        /** Location of the Project */
        sourceDirectory: string;

        hasInstallRule?: boolean; // Exists in ServerCodeModelProject.

    }

    /**
     * Describes cmake configuration
     */
    export interface Configuration {
        /** List of project() from CMakeLists.txt */
        projects: Project[];

        /** Name of the active configuration in a multi-configuration generator.*/
        name: string;
    }

    export interface Toolchain {
        path: string;
        target?: string;
    }

    /** Describes the cmake model */
    export interface Content {
        /** List of configurations provided by the selected generator */
        configurations: Configuration[];

        toolchains?: Map<string, Toolchain>;
    }
}

/**
 * Helper function to get the CMakeToolsApi from the CMake Tools extension.
 * @param desiredVersion The desired API version.
 * @param exactMatch If true, the version must match exactly. Otherwise, the
 * function will attempt to return the requested version, but it may not match
 * exactly.
 * @returns The API object, or undefined if the API is not available.
 */
export async function getCMakeToolsApi(desiredVersion: Version, exactMatch = false): Promise<CMakeToolsApi | undefined> {
    const extension = vscode.extensions.getExtension('ms-vscode.cmake-tools');

    if (!extension) {
        console.warn('[vscode-cmake-tools-api] CMake Tools extension is not installed.');
        return undefined;
    }

    let exports: CMakeToolsExtensionExports | undefined;
    if (!extension.isActive) {
        try {
            // activate() may throw if VS Code is shutting down.
            exports = await extension.activate();
        } catch {}
    } else {
        exports = extension.exports;
    }

    if (!exports || !exports.getApi) {
        console.warn('[vscode-cmake-tools-api] CMake Tools extension does not provide an API.');
        return undefined;
    }

    const api = exports.getApi(desiredVersion);
    if (desiredVersion !== api.version) {
        if (exactMatch) {
            console.warn(`[vscode-cmake-tools-api] CMake Tools API version ${desiredVersion} is not available.`);
            return undefined;
        } else {
            console.warn(`[vscode-cmake-tools-api] CMake Tools API version ${desiredVersion} is not available. Using ${api.version}.`);
        }
    }

    return api;
}

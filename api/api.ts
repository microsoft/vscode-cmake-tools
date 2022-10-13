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
    v0 = 0,         // 0.x.x
    latest = v0,
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
    showUiElement(element: UiElement): void;

    /**
     * Hides the given UI element.
     * @param element Element to hide.
     */
    hideUiElement(element: UiElement): void;

    /**
     * An event that fires when the selected build target changes.
     */
    readonly onBuildTargetNameChanged: vscode.Event<string>;

    /**
     * An event that fires when the selected launch target changes.
     */
    readonly onLaunchTargetNameChanged: vscode.Event<string>;

    /**
     * Gets the code model from the CMake File API.
     * @param folder The workspace folder containing the CMake project.
     */
    getFileApiCodeModel(folder: vscode.WorkspaceFolder): Promise<CodeModelContent>;

    /**
     * An event that fires when any code model in the workspace is updated.
     */
    readonly onFileApiCodeModelChanged: vscode.Event<vscode.WorkspaceFolder>;
}

export enum UiElement {
    StatusBarLaunchButton,
    StatusBarDebugButton,
}

export type TargetTypeString =
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
export interface CodeModelTarget {
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
    type: TargetTypeString;

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
    fileGroups?: CodeModelFileGroup[];

    /**
     * Represents the CMAKE_SYSROOT variable
     */
    sysroot?: string;
}

/**
 * Describes a file group to describe the build settings.
 */
export interface CodeModelFileGroup {
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
export interface CodeModelProject {
    /** Name of the project */
    name: string;

    /** List of targets */
    targets: CodeModelTarget[];

    /** Location of the Project */
    sourceDirectory: string;

    hasInstallRule?: boolean; // Exists in ServerCodeModelProject.

}

/**
 * Describes cmake configuration
 */
export interface CodeModelConfiguration {
    /** List of project() from CMakeLists.txt */
    projects: CodeModelProject[];

    /** Name of the active configuration in a multi-configuration generator.*/
    name: string;
}

export interface CodeModelToolchain {
    path: string;
    target?: string;
}

/** Describes the cmake model */
export interface CodeModelContent {
    /** List of configurations provided by the selected generator */
    configurations: CodeModelConfiguration[];

    toolchains?: Map<string, CodeModelToolchain>;
}

/**
 * Helper function to get the CMakeToolsApi from the CMake Tools extension.
 * @param version The desired API version.
 * @param exactMatch If true, the version must match exactly. Otherwise, the
 * function will attempt to return the requested version, but it may not match
 * exactly.
 * @returns The API object, or undefined if the API is not available.
 */
export async function getCMakeToolsApi(version: Version, exactMatch = true): Promise<CMakeToolsApi | undefined> {
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

    const api = exports.getApi(version);
    if (version !== api.version) {
        if (exactMatch) {
            console.warn(`[vscode-cmake-tools-api] CMake Tools API version ${version} is not available.`);
            return undefined;
        } else {
            console.warn(`[vscode-cmake-tools-api] CMake Tools API version ${version} is not available. Using ${api.version}.`);
        }
    }

    return api;
}

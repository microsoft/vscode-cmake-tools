/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Input parameters for the cmake_build tool
 */
export interface IBuildParameters {
    /**
     * The specific build target to compile. If not provided, builds the default target.
     * Examples: "all", "myapp", "tests"
     */
    target?: string;

    /**
     * Whether to clean before building. Defaults to false.
     */
    clean?: boolean;
}

/**
 * Input parameters for the cmake_configure tool
 */
export interface IConfigureParameters {
    /**
     * Whether to delete the CMake cache before configuring. Defaults to false.
     * Set to true for a clean reconfigure.
     */
    cleanFirst?: boolean;
}

/**
 * Input parameters for the cmake_get_errors tool
 */
export interface IGetErrorsParameters {
    // No parameters needed - returns all CMake-specific diagnostics
}

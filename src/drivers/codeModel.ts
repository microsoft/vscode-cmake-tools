import { CMakeCache } from "@cmt/cache";

import * as api from "vscode-cmake-tools";

// Re-export API types. This gives us flexibility add fields to the internal
// representation of these data structures in the future without modifying the
// public API.
export type CodeModelConfiguration = api.CodeModel.Configuration;
export type CodeModelContent = api.CodeModel.Content;
// TODO: Move framework definitions to the public API repo to avoid this intersection type.
export type CodeModelFileGroup = api.CodeModel.FileGroup & { frameworks?: { path: string }[] };
export type CodeModelProject = api.CodeModel.Project;
// TODO: If requested, move folder, dependencies, and isGeneratorProvided definition to the public API repo to avoid this intersection type.
export type CodeModelTarget = api.CodeModel.Target & { folder?: { name: string }; dependencies?: { backtrace: number; id: string }[]; isGeneratorProvided?: boolean; install?: {destinations: {path: string}[];  prefix: {path: string}}};
export type CodeModelToolchain = api.CodeModel.Toolchain;
export type TargetTypeString = api.CodeModel.TargetType;

/**
 * Type given when updating the configuration data stored in the file index.
 */
export interface CodeModelParams {
    /**
     * The CMake codemodel content. This is the important one.
     */
    codeModelContent: CodeModelContent;
    /**
     * The contents of the CMakeCache.txt, which also provides supplementary
     * configuration information.
     */
    cache: CMakeCache;
    /**
     * The path to `cl.exe`, if necessary. VS generators will need this property
     * because the compiler path is not available via the `kit` nor `cache`
     * property.
     */
    clCompilerPath?: string | null;
    /**
     * The active target
     */
    activeTarget: string | null;
    /**
     * CMAKE_BUILD_TYPE for single config generators, and build config for multi config ones.
     */
    activeBuildTypeVariant: string | null;
    /**
     * Workspace folder full path.
     */
    folder: string;
}

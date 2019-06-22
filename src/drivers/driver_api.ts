import * as vscode from 'vscode';
import { CMakeDriver } from './driver';

export abstract class CMakeCodeModelDriver extends CMakeDriver{
    abstract onCodeModelChanged: vscode.Event<ExtCodeModelContent | null>;
}

export type ExtTargetTypeString = ('STATIC_LIBRARY' | 'MODULE_LIBRARY' | 'SHARED_LIBRARY' | 'OBJECT_LIBRARY' | 'EXECUTABLE' | 'UTILITY' | 'INTERFACE_LIBRARY');

/** Describes a cmake target */
export interface ExtCodeModelTarget {
  /**
   * A string specifying the logical name of the target.
   *
   * (Source CMake Documentationcmake-file-api(7))
   */
  readonly name:string;

  /**
   * A string specifying the type of the target.
   * The value is one of EXECUTABLE, STATIC_LIBRARY, SHARED_LIBRARY, MODULE_LIBRARY, OBJECT_LIBRARY, or UTILITY.
   *
   * (Source CMake Documentationcmake-file-api(7))
   *
   * \todo clearify INTERFACE_LIBRARY
   */
  type: ExtTargetTypeString;

  /** A string specifying the absolute path to the target’s source directory. */
  sourceDirectory?: string;
  /** Name of the target artefact on disk (library or executable file name). */
  fullName?: string;

  /** List of absolute path of a target build artifact. */
  artifacts?: string[];

  /** List of compilation information for artifacts of this target.
   * It contains groups of source files which there compilation information.
   */
  fileGroups?: ExtCodeModelFileGroup[];
}

export interface ExtCodeModelFileGroup {
  /** List of source files with the same compilation information */
  sources: string[];

  language?: string;
  /** Include paths for compilation of a source file */
  includePath?: {
    /** include path */
    path: string;
  }[];

  /** Compiler flags */
  compileFlags?: string;

  /** Defines */
  defines?: string[];
}

/**
 * Describes cmake project and all it related targets
 */
export interface ExtCodeModelProject {
  /** Name of the project */
  name:string;

  /** List of targets */
  targets: ExtCodeModelTarget[];

  /** Location of the Project */
  sourceDirectory: string;
}

export interface ExtCodeModelConfiguration {
  projects: ExtCodeModelProject[];
}

export interface ExtCodeModelContent {
  configurations: ExtCodeModelConfiguration[];
}
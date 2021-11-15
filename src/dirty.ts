/**
 * A module for doing very primitive dirty-checking
 */ /** */

import { CMakeInputsContent } from '@cmt/drivers/cms-client';
import { fs } from '@cmt/pr';
import * as util from '@cmt/util';
import { Stats } from 'fs';
import * as path from 'path';

export class InputFile {
    constructor(readonly filePath: string, readonly mtime: Date | null) {}

    async checkOutOfDate(): Promise<boolean> {
        if (this.mtime === null) {
            return true;
        }
        let stat: Stats;
        try {
            stat = await fs.stat(this.filePath);
        } catch (_) {
            // Failed to stat: Treat the file as out-of-date
            return true;
        }
        return stat.mtime.valueOf() > this.mtime.valueOf();
    }

    static async create(filePath: string): Promise<InputFile> {
        let stat: Stats;
        try {
            stat = await fs.stat(filePath);
        } catch (_) {
            return new InputFile(filePath, null);
        }
        return new InputFile(filePath, stat.mtime);
    }
}

export class InputFileSet {
    private constructor(readonly inputFiles: InputFile[]) {}

    async checkOutOfDate(): Promise<boolean> {
        for (const input of this.inputFiles) {
            if (await input.checkOutOfDate()) {
                return true;
            }
        }
        return false;
    }

    static async create(cmake_inputs: CMakeInputsContent): Promise<InputFileSet> {
        const input_files
            = await Promise.all(util.map(util.flatMap(cmake_inputs.buildFiles, entry => entry.sources), src => {
                // Map input file paths to files relative to the source directory
                if (!path.isAbsolute(src)) {
                    src = util.platformNormalizePath(path.join(cmake_inputs.sourceDirectory, src));
                }
                return InputFile.create(src);
            }));
        return new InputFileSet(input_files);
    }

    static createEmpty(): InputFileSet {
        return new InputFileSet([]);
    }
}

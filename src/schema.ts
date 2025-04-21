import Ajv, { ValidateFunction } from 'ajv';
import * as path from 'path';

import { fs } from '@cmt/pr';
import { thisExtensionPath } from '@cmt/util';

/**
 * Loads and compiles a JSON schema from the specified file path.
 * @param filepath The path to the JSON schema file. Can be an absolute path or relative to the extension's root directory.
 * @returns A promise that resolves to a ValidateFunction, which can be used to validate JSON data against the schema.
 */
export async function loadSchema(filepath: string): Promise<ValidateFunction> {
    const schema_path = path.isAbsolute(filepath) ? filepath : path.join(thisExtensionPath(), filepath);
    const schema_data = JSON.parse((await fs.readFile(schema_path)).toString());
    return new Ajv({ allErrors: true }).compile(schema_data);
}

import Ajv, { ValidateFunction } from 'ajv';
import * as path from 'path';

import { fs } from '@cmt/pr';
import { thisExtensionPath } from '@cmt/util';

export async function loadSchema(filepath: string): Promise<ValidateFunction> {
    const schema_path = path.isAbsolute(filepath) ? filepath : path.join(thisExtensionPath(), filepath);
    const schema_data = JSON.parse((await fs.readFile(schema_path)).toString());
    return new Ajv({ allErrors: true }).compile(schema_data);
}

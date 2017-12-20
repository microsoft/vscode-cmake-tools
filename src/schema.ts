import * as path from 'path';

import * as ajv from 'ajv';

import {thisExtensionPath} from "./util";
import {fs} from "./pr";

export async function loadSchema(filepath: string): Promise<ajv.ValidateFunction> {
  const schema_path
  = path.isAbsolute(filepath) ? filepath : path.join(thisExtensionPath(), filepath);
  const schema_data = JSON.parse((await fs.readFile(schema_path)).toString());
  return new ajv({allErrors : true, format : 'full'}).compile(schema_data);
}

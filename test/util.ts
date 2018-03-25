import {CMakeTools} from '@cmt/cmake-tools';
import paths from '@cmt/paths';
import {fs} from '@cmt/pr';

import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

// re-exports:
export {DefaultEnvironment} from './helpers/test/default-environment';

chai.use(chaiAsPromised);

export {expect};

export async function clearExistingKitConfigurationFile() {
  await fs.writeFile(path.join(paths.dataDir, 'cmake-kits.json'), '[]');
}

export async function getExtension() {
  const cmt = vscode.extensions.getExtension<CMakeTools>('vector-of-bool.cmake-tools');
  if (!cmt) {
    throw new Error('Extension doesn\'t exist');
  }
  return cmt.isActive ? Promise.resolve(cmt.exports) : cmt.activate();
}

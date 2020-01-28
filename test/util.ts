import {CMakeTools} from '@cmt/cmake-tools';
import {Kit, scanForKits, kitsForWorkspaceDirectory} from '@cmt/kit';
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
  const cmt = vscode.extensions.getExtension<CMakeTools>('ms-vscode.cmake-tools');
  if (!cmt) {
    throw new Error('Extension doesn\'t exist');
  }
  return cmt.isActive ? Promise.resolve(cmt.exports) : cmt.activate();
}

let AVAIL_KITS: Promise<Kit[]> | null = null;

export async function getSystemKits(cmakeTools: CMakeTools): Promise<Kit[]> {
  if (AVAIL_KITS === null) {
    AVAIL_KITS = scanForKits(cmakeTools);
  }
  return AVAIL_KITS;
}

export async function getFirstSystemKit(cmakeTools: CMakeTools): Promise<Kit> {
  const kits = await getSystemKits(cmakeTools);
  console.assert(kits.length >= 1, 'No kits found for testing');
  return kits[0];
}

export async function getMatchingSystemKit(cmakeTools: CMakeTools, re: RegExp): Promise<Kit> {
  const kits = await getSystemKits(cmakeTools);
  return getMatchingKit(kits, re);
}

export async function getMatchingProjectKit(re: RegExp, dir: string): Promise<Kit> {
  const kits = await kitsForWorkspaceDirectory(dir);
  return getMatchingKit(kits, re);
}

function getMatchingKit(kits: Kit[], re: RegExp): Kit {
  const kit = kits.find(k => re.test(k.name));
  if (!kit) {
    throw new Error(`No kit matching expression: ${re}`);
  }
  return kit;
}
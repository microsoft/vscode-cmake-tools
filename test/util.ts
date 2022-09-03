import { CMakeProject } from '@cmt/cmakeProject';
import { Kit, scanForKits, kitsForWorkspaceDirectory } from '@cmt/kit';
import paths from '@cmt/paths';
import { fs } from '@cmt/pr';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

// re-exports:
export { DefaultEnvironment } from '@test/helpers/test/default-environment';

chai.use(chaiAsPromised);

export { expect };

export function getTestResourceFilePath(filename: string): string {
    return path.normalize(path.join(__dirname, '../../test/unit-tests', filename));
}

export async function clearExistingKitConfigurationFile() {
    await fs.writeFile(path.join(paths.dataDir, 'cmake-kits.json'), '[]');
}

export function getExtension() {
    const cmt = vscode.extensions.getExtension<CMakeProject>('ms-vscode.cmake-tools');
    if (!cmt) {
        throw new Error('Extension doesn\'t exist');
    }
    return cmt.isActive ? Promise.resolve(cmt.exports) : cmt.activate();
}

let AVAIL_KITS: Kit[] | null = null;

export async function getSystemKits(cmakeProject?: CMakeProject): Promise<Kit[]> {
    if (AVAIL_KITS === null) {
        AVAIL_KITS = await scanForKits(cmakeProject, { ignorePath: process.platform === 'win32' });
    }
    return AVAIL_KITS;
}

/**
 * @returns a Visual Studio kit on Windows, a GCC or Clang kit on mac/linux
 */
export async function getFirstSystemKit(cmakeProject?: CMakeProject): Promise<Kit> {
    const kits = await getSystemKits(cmakeProject);
    console.assert(kits.length >= 1, 'No kits found for testing');
    return kits.find(kit => {
        if (process.platform === 'win32') {
            return !!kit.visualStudio;
        } else {
            return !!kit.compilers;
        }
    })!;
}

export async function getMatchingSystemKit(cmakeProject: CMakeProject | undefined, re: RegExp): Promise<Kit> {
    const kits = await getSystemKits(cmakeProject);
    return getMatchingKit(kits, re);
}

export async function getMatchingProjectKit(re: RegExp, dir: string): Promise<Kit> {
    const kits = await kitsForWorkspaceDirectory(dir);
    return getMatchingKit(kits, re);
}

function getMatchingKit(kits: Kit[], re: RegExp): Kit {
    const kit = kits.find(k => re.test(k.name));
    if (!kit) {
        throw new Error(`Unable to find a Kit matching the expression: ${re}\nAvailable Kits:\n${JSON.stringify(kits, null, 2)}`);
    }
    return kit;
}

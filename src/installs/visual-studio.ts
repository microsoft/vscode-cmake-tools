/**
 * Module for querying MS Visual Studio
 */ /** */

import * as path from 'path';

import * as logging from '../logging';
import * as proc from '../proc';
import {thisExtensionPath} from '../util';
import * as nls from 'vscode-nls';


nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('visual-studio');


export interface VSCatalog {
  productDisplayVersion: string;
}

 /**
 * Description of a Visual Studio installation returned by vswhere.exe
 *
 * This isn't _all_ the properties, just the ones we need so far.
 */
export interface VSInstallation {
  catalog?: VSCatalog;
  channelId?: string;
  instanceId: string;
  displayName?: string;
  installationPath: string;
  installationVersion: string;
  description: string;
  isPrerelease: boolean;
}

/**
 * Cache the results of invoking 'vswhere'
 */
interface VSInstallationCache {
  installations: VSInstallation[];
  queryTime: number;
}


let cachedVSInstallations: VSInstallationCache|null = null;


/**
 * Construct the display name (this will be paired with an
 * arch later to construct the Kit.name property).
 *
 * @param inst The VSInstallation to use
 */
export function vsDisplayName(inst: VSInstallation): string {
  if (inst.displayName) {
    if (inst.channelId) {
      const index = inst.channelId.lastIndexOf('.');
      if (index > 0) {
        return `${inst.displayName} ${inst.channelId.substr(index + 1)}`;
      }
    }
    return inst.displayName;
  }
  return inst.instanceId;
}

/**
 * Get a list of all Visual Studio installations available from vswhere.exe.
 * Results are cached for 15 minutes.
 * Will not include older versions. vswhere doesn't seem to list them?
 */
export async function vsInstallations(): Promise<VSInstallation[]> {
  const now = Date.now();
  if (cachedVSInstallations && cachedVSInstallations.queryTime && (now - cachedVSInstallations.queryTime) < 900000) {
    // If less than 15 minutes old, cache is considered ok.
    return cachedVSInstallations.installations;
  }

  const installs = [] as VSInstallation[];
  const inst_ids = [] as string[];
  const vswhere_exe = path.join(thisExtensionPath(), 'res', 'vswhere.exe');
  const sys32_path = path.join(process.env.WINDIR as string, 'System32');

  const vswhere_args =
      ['/c', `${sys32_path}\\chcp 65001>nul && "${vswhere_exe}" -all -format json -products * -legacy -prerelease`];
  const vswhere_res
      = await proc.execute(`${sys32_path}\\cmd.exe`, vswhere_args, null, {silent: true, encoding: 'utf8', shell: true})
            .result;

  if (vswhere_res.retc !== 0) {
    log.error(localize('failed.to.execute', 'Failed to execute {0}: {1}', "vswhere.exe", vswhere_res.stderr));
    return [];
  }

  const vs_installs = JSON.parse(vswhere_res.stdout) as VSInstallation[];
  for (const inst of vs_installs) {
    if (inst_ids.indexOf(inst.instanceId) < 0) {
      installs.push(inst);
      inst_ids.push(inst.instanceId);
    }
  }
  cachedVSInstallations = {
    installations: installs,
    queryTime: now
  };
  return installs;
}

export function vsVersionName(inst: VSInstallation): string {
  if (!inst.catalog) {
    return inst.instanceId;
  }
  const end = inst.catalog.productDisplayVersion.indexOf('[');
  return end < 0 ? inst.catalog.productDisplayVersion : inst.catalog.productDisplayVersion.substring(0, end - 1);
}

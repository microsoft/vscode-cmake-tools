import * as proc from '../proc';
import * as util from '../util';

export interface CMakeExecutable {
  path: string;
  isPresent: boolean;
  isServerModeSupported?: boolean;
  version?: util.Version;
  minimalServerModeVersion: util.Version;
}

export async function getCMakeExecutableInformation(path: string): Promise<CMakeExecutable> {
  const cmake = {path, isPresent: false, minimalServerModeVersion: util.parseVersion('3.7.1')} as CMakeExecutable;

  if (path.length != 0) {
    try {
      const version_ex = await proc.execute(path, ['--version']).result;
      if (version_ex.retc === 0 && version_ex.stdout) {
        cmake.isPresent = true;

        console.assert(version_ex.stdout);
        const version_re = /cmake.* version (.*?)\r?\n/;
        cmake.version = util.parseVersion(version_re.exec(version_ex.stdout)![1]);

        // We purposefully exclude versions <3.7.1, which have some major CMake
        // server bugs
        cmake.isServerModeSupported = util.versionGreater(cmake.version, cmake.minimalServerModeVersion);
      }
    } catch (ex) {
      if (ex.code != 'ENOENT') {
        throw ex;
      }
    }
  }
  return cmake;
}

import * as proc from '../proc';
import * as util from '../util';

export interface CMakeExecutable {
  path: string;
  isPresent: boolean;
  isServerModeSupported?: boolean;
  isFileApiModSupported?: boolean;
  version?: util.Version;
  minimalServerModeVersion: util.Version;
  minimalFileApiModeVersion: util.Version;
}

export async function getCMakeExecutableInformation(path: string): Promise<CMakeExecutable> {
  const cmake: CMakeExecutable = {
    path,
    isPresent: false,
    minimalServerModeVersion: util.parseVersion('3.7.1'),
    minimalFileApiModeVersion: util.parseVersion('3.15.0'),
  };

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

        // Support for new file based API, it replace the server mode
        cmake.isFileApiModSupported = util.versionGreater(cmake.version, cmake.minimalFileApiModeVersion) ||
            util.versionEquals(cmake.version, cmake.minimalFileApiModeVersion);
      }
    } catch (ex) {
      if (ex.code != 'ENOENT') {
        throw ex;
      }
    }
  }
  return cmake;
}

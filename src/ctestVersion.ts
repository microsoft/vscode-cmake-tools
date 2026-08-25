import * as util from '@cmt/util';

export type CTestDiscoveryArgument = '-N' | '--show-only=json-v1';

export function parseCTestVersion(output: string | undefined): util.Version | undefined {
    const match = output?.match(/(?:^|\r?\n)ctest version (\d+\.\d+(?:\.\d+)?)/);
    return match?.[1] ? util.tryParseVersion(match[1]) : undefined;
}

export function getCTestDiscoveryArgument(versionOutput: string | undefined): CTestDiscoveryArgument {
    const version = parseCTestVersion(versionOutput);
    return version && !util.versionLess(version, '3.14.0') ? '--show-only=json-v1' : '-N';
}

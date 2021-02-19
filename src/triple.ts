
export interface TargetTriple {
  triple: string;
  targetOs: string;
  targetArch: string;
  vendors: string[];
  abi: string;
  libc: string;
}

export function findTargetTriple(line: string): string | null {
  const target_triple_re = /^Target:\s+(.*)/;
  const target_triple_match = target_triple_re.exec(line);
  if (target_triple_match !== null) {
    return target_triple_match[1];
  }
  const target_triple_re_old = /.*gcc-lib[/\\]([^/\\]*)[/\\]/;
  const target_triple_match_old = target_triple_re_old.exec(line);
  if (target_triple_match_old !== null) {
    return target_triple_match_old[1];
  }
  return null;
}

/* https://gcc.gnu.org/install/specific.html */
const TriplePossibleArch: {[index: string]: RegExp} = {
  x86: /^(i386|i486|i586|i686|x86)$/,
  aarch64: /^aarch64.*/,
  amdgcn: /^amdgcn/,
  arc: /^arc/,
  arm: /^arm/,
  avr: /^avr/,
  blackfin: /^blackfin/, /* https://sourceforge.net/projects/adi-toolchain/files/2014R1/ */
  cr16: /^cr16/,
  cris: /^cris/,
  epiphany: /^epiphany/,
  h8300: /^h8300/,
  hppa: /^hppa.*/,
  ia64: /^ia64/,
  iq2000: /^iq2000/,
  lm32: /^lm32/,
  m32c: /^m32c/,
  m32r: /^m32r/,
  m68k: /^m68k/,
  microblaze: /^microblaze/,
  mips: /^mips/,
  moxie: /^moxie/,
  msp430: /^msp430/,
  nds32le: /^nds32le/,
  nds32be: /^nds32be/,
  nvptx: /^nvptx/,
  or1k: /^or1k/,
  powerpc: /^powerpc$/,
  powerpcle: /^powerpcle$/,
  rl78: /^rl78/,
  riscv32: /^riscv32/,
  riscv64: /^riscv64/,
  rx: /^rx/,
  s390: /^s390$/,
  s390x: /^s390x$/,
  sparc: /^sparc$/,
  sparc64: /^(sparc64|sparcv9)$/,
  c6x: /^c6x$/,
  tilegx: /^tilegx$/,
  tilegxbe: /^tilegxbe$/,
  tilepro: /^tilepro$/,
  visium: /^visium/,
  x64: /^(x86_64|amd64|x64)$/,
  xtensa: /^xtensa.*/
};

const TriplePossibleOS: {[index: string]: RegExp} = {
  win32: /^(mingw32|mingw|mingw64|w64|msvc|windows)/,
  cygwin: /^cygwin/,
  msys: /^msys/,
  linux: /^linux.*/,
  solaris: /^solaris.*/,
  darwin: /^darwin.*/,
  uclinux: /^uclinux.*/,
  bsd: /^(netbsd|openbsd)/,
  vxworks: /^(vxworks|vxworksae)$/,
  none: /^none$/,
};

const TriplePossibleABI: {[index: string]: RegExp} = {
  elf: /^(linux.*|uclinux.*|elf|netbsd|openbsd|aix|solaris.*|gnueabi|gnueabihf)/,
  marcho: /^darwin.*/,
  pe: /^(mingw32|mingw|mingw64|w64|msvc|windows|cygwin|msys)/,
  eabi: /^eabi$/,
  eabisim: /^eabisim$/,
};

const TriplePossibleLibC: {[index: string]: RegExp} = {
  musl: /^musl$/,
  glibc: /^(gnu|msys|cygwin)$/,
  msvcrt: /^msvc$/,
  mingw: /^(mingw32|mingw|mingw64|w64)/,
//  'llvm': /^llvm$/, TODO:https://github.com/llvm/llvm-project/tree/master/libc/src/stdio
// otherwise system libc
};

export function computeTargetTriple(target:TargetTriple): string {
  let triple = target.targetArch;
  if (target.vendors.length > 0) {
    const vendor = target.vendors.join('_');
    triple += `-${vendor}`;
  }
  triple += `-${target.targetOs}`;
  if (target.abi.length > 0) {
    triple += `-${target.abi}`;
  }
  if (target.libc.length > 0) {
    triple += `-${target.libc}`;
  }
  return triple;
}

export function parseTargetTriple(triple: string): TargetTriple | undefined {
  const triples = triple.split("-");
  let foundArch = "unknow";
  let foundOs = 'unknow';
  let foundAbi = 'unknow';
  let foundLibc = 'unknow';
  const elementToSkip: string[] = [];
  for (const tripleElement of triples) {
    for (const key of Object.keys(TriplePossibleArch)) {
      const archReg = TriplePossibleArch[key];
      if (archReg.exec(tripleElement) !== null) {
        elementToSkip.push(tripleElement);
        if (foundArch === "unknow") {
          foundArch = key;
        } else if (foundArch !== key) {
          return undefined;
        }
      }
    }

    for (const key of Object.keys(TriplePossibleOS)) {
      const osReg = TriplePossibleOS[key];
      if (osReg.exec(tripleElement) !== null) {
        elementToSkip.push(tripleElement);
        if (foundOs === "unknow" || foundOs === 'none') {
          foundOs = key;
        } else if (foundOs !== key && key !== 'none') {
          return undefined;
        }
      }
    }

    for (const key of Object.keys(TriplePossibleABI)) {
      const abiReg = TriplePossibleABI[key];
      if (abiReg.exec(tripleElement) !== null) {
        elementToSkip.push(tripleElement);
        if (foundAbi === "unknow") {
          foundAbi = key;
        } else if (foundAbi !== key) {
          return undefined;
        }
      }
    }

    for (const key of Object.keys(TriplePossibleLibC)) {
      const libcReg = TriplePossibleLibC[key];
      if (libcReg.exec(tripleElement) !== null) {
        elementToSkip.push(tripleElement);
        if (foundLibc === "unknow") {
          foundLibc = key;
        } else if (foundLibc !== key) {
          return undefined;
        }
      }
    }
  }
  const vendors: string[] = [];
  for (const tripleElement of triples) {
    if (elementToSkip.indexOf(tripleElement) < 0) {
      vendors.push(tripleElement);
    }
  }

  return {
    triple,
    targetOs: foundOs === 'unknow' ? 'none' : foundOs,
    targetArch: foundArch,
    vendors,
    abi: foundAbi === 'unknow' ? '': foundAbi,
    libc: foundLibc === 'unknow' ? '' : foundLibc,
  };
}

export function majorVersionSemver(semver: string) : string {
  const major_version_re = /^(\d+)./;
  const major_version_match = major_version_re.exec(semver);
  if (Array.isArray(major_version_match)) {
    return major_version_match[1] ?? '';
  }
  return '';
}

export function minorVersionSemver(semver: string) : string {
  const minor_version_re = /^(\d+).(\d+)/;
  const minor_version_match = minor_version_re.exec(semver);
  if (Array.isArray(minor_version_match)) {
    return minor_version_match[2] ?? '';
  }
  return '';
}

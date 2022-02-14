import * as gcc from './gcc';
import * as ghs from './ghs';
import * as diab from './diab';
import * as gnu_ld from './gnu-ld';
import * as mvsc from './msvc';
import * as iar from './iar';

import { RawDiagnosticParser } from './rawDiagnosticParser';

export class Compilers {
    [compiler: string]: RawDiagnosticParser;

    gcc = new gcc.Parser();
    ghs = new ghs.Parser();
    diab = new diab.Parser();
    gnuLD = new gnu_ld.Parser();
    msvc = new mvsc.Parser();
    iar = new iar.Parser();
}

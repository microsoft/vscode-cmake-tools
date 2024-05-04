import * as path from "path";
import * as fs from "fs";

import * as commander from "commander";
import Fontagon from "fontagon";

type Optional<T> = T | undefined;

/**
 * Supported font formats to output.
 *
 * @enum {number}
 */
enum FontFormat {
    WOFF,
    WOFF2,
}

/**
 * Struct to store icon file metadata.
 */
class SvgIcon {
    public fp: string;
    public glyphCode: number;
    public name: string;

    constructor(args: {fp: string; glyph_code: number; name: Optional<string>}) {
        this.fp = args.fp;
        this.glyphCode = args.glyph_code;
        this.name = args.name || '';
    }
}

/**
 * Generator class for generating webfonts.
 */
class WebfontGenerator {
    private readonly _FILE_MATCHER = new RegExp("^u(?<code>[0-9a-f]{4})[-_]?(?<name>.*)\\.svg$", "i");

    private _svgIcons: SvgIcon[];
    private _enabledFormats: Set<FontFormat>;

    constructor() {
        this._svgIcons = [];
        this._enabledFormats = new Set<FontFormat>();
    }

    /**
     * Enables a font output format.
     *
     * @public
     * @param format Format to enable.
     */
    public enableFormat(format: FontFormat) {
        this._enabledFormats.add(format);
    }

    /**
     * Searches and adds all icons files recursively from a given base directory.
     *
     * @public
     * @param baseDir Base directory to recursively process.
     */
    public addFromDirectory(baseDir: string) {
        baseDir = path.resolve(baseDir);
        if (!fs.statSync(baseDir).isDirectory()) {
            return;
        }

        for (let fp of fs.readdirSync(baseDir)) {
            // Full path, as well as replace backwards slashes as webfont requires forward slashes.
            fp = path.join(baseDir, fp).replace(/\\/g, '/');
            const parsed_fp = path.parse(fp);

            const match = this._FILE_MATCHER.exec(parsed_fp.base);
            if (match?.groups && fs.statSync(fp).isFile()) {
                this._svgIcons.push(new SvgIcon({
                    fp: fp,
                    glyph_code: Number.parseInt(`0x${match.groups['code']}`),
                    name: parsed_fp.name
                }));
                console.log(`Added icon: '${fp}'`);
                console.log(Number.parseInt(`0x${match.groups['code']}`));
            // Assume a directory (checked in begin of function when recursing).
            } else {
                this.addFromDirectory(fp);
            }
        }
    }

    /**
     * Generates and outputs the font files from the added icons.
     *
     * @public
     * @async
     * @param outputDirectory Directory to output the font files.
     * @param name Font name.
     */
    public async generate(outputDirectory: string, name: Optional<string> = undefined): Promise<void> {
        if (!this._enabledFormats.size) {
            console.warn("No enabled font formats to output; nothing to generate.");
            return;
        }

        outputDirectory = path.resolve(outputDirectory);
        if (!fs.existsSync(outputDirectory)) {
            throw Error(`Output directory does not exist '${outputDirectory}'`);
        }

        // Fontagon automatically cleans/removes directories, so make a temporary directory and move the files over
        // after generation to the actual output directory.
        const tmp_directory = path.join(outputDirectory, 'tmp');
        !fs.existsSync(tmp_directory) && fs.mkdirSync(tmp_directory);

        // Enable formats to output, alongside any optional format options. Furthmore, Fontagon also outputs intermediate
        // font formats, so we'll keep track of the files by extension that we want to keep.
        const format_options: Fontagon.FormatOptions = {};
        const extensions: string[] = [];
        for (const format of this._enabledFormats) {
            switch (format) {
                case FontFormat.WOFF:
                    format_options['woff'] = {};
                    extensions.push('.woff');
                    break;
                case FontFormat.WOFF2:
                    format_options['woff2'] = {};
                    extensions.push('.woff2');
                    break;
                default:
                    throw Error(`Unsupported font format '${FontFormat[format]}'.`);
            }
        };

        await Fontagon({
            files: this._svgIcons.map((svg_icon) => svg_icon.fp),
            codepoints: this._svgIcons.reduce((a, svg_icon) => ({ ...a, [svg_icon.name]: svg_icon.glyphCode }), {}),
            dist: tmp_directory,
            fontName: name || path.basename(opts.sourceDirectory),
            style: undefined,
            formatOptions: { ...format_options,
                // The SVG intermediate format has all the transformative options we can set.
                svg: {
                    fontHeight: 1000,
                    normalize: false
                }
            }
        });

        // Move over all files from the temporary directory
        for (const fp of fs.readdirSync(tmp_directory)) {
            if (!extensions.includes(path.parse(fp).ext)) {
                continue;
            }
            fs.renameSync(
                path.resolve(tmp_directory, fp),
                path.join(outputDirectory, path.basename(fp)));
        }
        fs.existsSync(tmp_directory) && fs.rmSync(tmp_directory, { recursive: true });
    }
}

commander.program
    .name("product-icon-generator")
    .description("Takes SVG icons and generates it into a product icon font.")
    // I/O arguments.
    .requiredOption("--source-directory <source-directory>", "The root directory where to recursively import icons from. Filenames must start with a hexadecimal glyph codepoint (e.g. '0xE001.svg')")
    .option("-o, --output-directory <output-directory>", "Directory where to output the webfont file. Defaults to the source directory if not set.")
    .option("--name <name>", "(File)name of the font. Defaults to the directory name if this option is not set.")
    // Font format generation arguments. Each format should be enabled explicitly by the user.
    .option("--woff", "Enables WOFF font generation.")
    .option("--woff2", "Enables WOFF2 font generation.")
    .parse();
const opts = commander.program.opts();

try {
    const generator = new WebfontGenerator();

    const register_format = (opt: boolean, format: FontFormat) => {
        opt && generator.enableFormat(format);
    };
    register_format(opts.woff , FontFormat.WOFF);
    register_format(opts.woff2, FontFormat.WOFF2);

    generator.addFromDirectory(opts.sourceDirectory);

    await generator.generate(
        opts.outputDirectory || opts.sourceDirectory,
        opts.name
    );
} catch (e) {
    console.error('Font creation failed.', e);
}

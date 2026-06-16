#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Bundles the @vscode/vsce CLI and its full runtime dependency closure into a
// portable, self-contained directory that can be shipped as a pipeline artifact
// and executed with `node <out>/node_modules/@vscode/vsce/vsce publish ...` in a
// network-isolated 1ES release job (no checkout, no install).
//
// The closure is copied preserving the on-disk node_modules layout so that
// __dirname-relative binary resolution (vsce-sign) and package.json reads behave
// identically to the build job. The native vsce-sign binary is guaranteed to be
// staged even if the @vscode/vsce-sign postinstall did not run.
//
// Usage: node bundle-vsce.js <outputDir>

'use strict';

const fs = require('fs');
const path = require('path');

const ENTRY_PACKAGE = '@vscode/vsce';

function fail(message) {
    console.error(`[bundle-vsce] ERROR: ${message}`);
    process.exit(1);
}

function log(message) {
    console.log(`[bundle-vsce] ${message}`);
}

// Mirrors @vscode/vsce-sign/src/target.js so the correct native binary package
// is selected for the host the bundle is produced on (release agent == build
// agent == Windows x64 in this pipeline).
function getSignTarget(platform, architecture) {
    switch (platform) {
        case 'darwin':
            return ['arm64', 'x64'].includes(architecture) ? `darwin-${architecture}` : null;
        case 'linux':
            return ['arm', 'arm64', 'x64'].includes(architecture) ? `linux-${architecture}` : null;
        case 'win32':
            if (['arm', 'arm64', 'x64'].includes(architecture)) {
                return `win32-${architecture}`;
            }
            return architecture === 'ia32' ? 'win32-x86' : null;
        default:
            return null;
    }
}

// Resolve a package directory using Node's resolution algorithm: starting at
// `fromDir`, look for `node_modules/<name>` and walk up the directory tree.
// Returns the absolute package directory, or null if not found.
function resolvePackageDir(name, fromDir, rootProjectDir) {
    let dir = fromDir;
    for (;;) {
        const candidate = path.join(dir, 'node_modules', name);
        if (fs.existsSync(path.join(candidate, 'package.json'))) {
            return candidate;
        }
        if (dir === rootProjectDir) {
            break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return null;
}

function findRootNodeModules(startDir) {
    let dir = startDir;
    for (;;) {
        if (fs.existsSync(path.join(dir, 'node_modules', '@vscode', 'vsce', 'package.json'))) {
            return path.join(dir, 'node_modules');
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    fail(`Could not locate a node_modules directory containing ${ENTRY_PACKAGE} starting from ${startDir}`);
    return null;
}

function main() {
    const outDir = process.argv[2];
    if (!outDir) {
        fail('Usage: node bundle-vsce.js <outputDir>');
    }
    const outAbs = path.resolve(outDir);

    // Start from a clean output directory so stale files from a previous run
    // (e.g. on a non-clean agent or a local re-run) cannot leak into the bundle.
    if (fs.existsSync(outAbs)) {
        fs.rmSync(outAbs, { recursive: true, force: true, maxRetries: 3 });
    }

    const rootNodeModules = findRootNodeModules(__dirname);
    const rootProjectDir = path.dirname(rootNodeModules);
    log(`Project root: ${rootProjectDir}`);
    log(`Output dir:   ${outAbs}`);

    const entryDir = resolvePackageDir(ENTRY_PACKAGE, rootProjectDir, rootProjectDir);
    if (!entryDir) {
        fail(`Could not resolve entry package ${ENTRY_PACKAGE}`);
    }

    // Breadth-first walk of the dependency + optionalDependency closure.
    const visited = new Set();
    const queue = [];
    const enqueue = (pkgDir) => {
        const real = path.resolve(pkgDir);
        if (!visited.has(real)) {
            visited.add(real);
            queue.push(real);
        }
    };
    enqueue(entryDir);

    while (queue.length > 0) {
        const pkgDir = queue.shift();
        let pkgJson;
        try {
            pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        } catch (err) {
            fail(`Unable to read package.json at ${pkgDir}: ${err && err.message}`);
        }
        const required = pkgJson.dependencies || {};
        const optional = pkgJson.optionalDependencies || {};
        const all = Object.assign({}, optional, required);
        for (const depName of Object.keys(all)) {
            const resolved = resolvePackageDir(depName, pkgDir, rootProjectDir);
            if (resolved) {
                enqueue(resolved);
            } else if (depName in required) {
                fail(`Missing required dependency "${depName}" of "${pkgJson.name}" (looked up from ${pkgDir}). The closure is incomplete.`);
            } else {
                log(`Skipping missing optional dependency "${depName}" of "${pkgJson.name}" (expected for non-host platforms).`);
            }
        }
    }

    // Deterministic copy order.
    const packageDirs = Array.from(visited).sort();
    log(`Copying ${packageDirs.length} packages...`);
    for (const pkgDir of packageDirs) {
        const rel = path.relative(rootProjectDir, pkgDir);
        const dest = path.join(outAbs, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(pkgDir, dest, { recursive: true, dereference: true });
    }

    // Guarantee the native vsce-sign binary is in place, independent of whether
    // the @vscode/vsce-sign postinstall ran. The runtime resolves it at
    // @vscode/vsce-sign/bin/<exe> (see @vscode/vsce-sign/src/main.js).
    const exeName = process.platform === 'win32' ? 'vsce-sign.exe' : 'vsce-sign';
    const signBinRel = path.join('node_modules', '@vscode', 'vsce-sign', 'bin', exeName);
    const destSignBin = path.join(outAbs, signBinRel);

    if (!fs.existsSync(destSignBin)) {
        const target = getSignTarget(process.platform, process.arch);
        if (!target) {
            fail(`Unsupported platform/arch for vsce-sign: ${process.platform}/${process.arch}`);
        }
        const platformPkg = `@vscode/vsce-sign-${target}`;
        const platformBinRel = path.join('node_modules', '@vscode', `vsce-sign-${target}`, 'bin', exeName);
        // Prefer the copy already staged into the bundle, then fall back to the
        // platform package in the project node_modules.
        const candidates = [
            path.join(outAbs, platformBinRel),
            path.join(rootProjectDir, platformBinRel)
        ];
        const src = candidates.find((c) => fs.existsSync(c));
        if (!src) {
            fail(`vsce-sign binary missing and no source found in ${platformPkg}. Checked: ${candidates.join(', ')}`);
        }
        fs.mkdirSync(path.dirname(destSignBin), { recursive: true });
        fs.copyFileSync(src, destSignBin);
        log(`Staged vsce-sign binary from ${src}`);
    }

    // Verify-exists guard: fail loudly if the runnable entry or native binary is absent.
    const vsceEntry = path.join(outAbs, 'node_modules', '@vscode', 'vsce', 'vsce');
    const vsceApi = path.join(outAbs, 'node_modules', '@vscode', 'vsce', 'out', 'api.js');
    for (const required of [vsceEntry, vsceApi, destSignBin]) {
        if (!fs.existsSync(required)) {
            fail(`Required bundled file missing after staging: ${required}`);
        }
    }

    log(`Bundle complete. Entry: ${vsceEntry}`);
    log(`Native signing binary: ${destSignBin}`);
}

main();

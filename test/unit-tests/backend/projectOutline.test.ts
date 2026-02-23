import { expect } from 'chai';
import * as path from 'path';

/**
 * Standalone copies of helper types/functions from projectOutline.ts and util.ts,
 * so we can test the outline tree-building logic without importing 'vscode'.
 */

interface PathedTree<T> {
    pathPart: string;
    items: T[];
    children: PathedTree<T>[];
}

/** Mirrors @cmt/util.splitPath */
function splitPath(p: string): string[] {
    if (p.length === 0 || p === '.') {
        return [];
    }
    const pardir = path.dirname(p);
    if (pardir === p) {
        return [p];
    }
    const arr: string[] = [];
    if (p.startsWith(pardir)) {
        arr.push(...splitPath(pardir));
    }
    arr.push(path.basename(p));
    return arr;
}

/** Mirrors addToTree from projectOutline.ts */
function addToTree<T>(tree: PathedTree<T>, itemPath: string, item: T) {
    const elems = splitPath(itemPath);
    for (const el of elems) {
        let subtree = tree.children.find(n => n.pathPart === el);
        if (!subtree) {
            subtree = {
                pathPart: el,
                children: [],
                items: []
            };
            tree.children.push(subtree);
        }
        tree = subtree;
    }
    tree.items.push(item);
}

/** Mirrors collapseTreeInplace from projectOutline.ts */
function collapseTreeInplace<T>(tree: PathedTree<T>): void {
    const new_children: PathedTree<T>[] = [];
    for (let child of tree.children) {
        while (child.children.length === 1 && child.items.length === 0) {
            const subchild = child.children[0];
            child = {
                pathPart: path.join(child.pathPart, subchild.pathPart),
                items: subchild.items,
                children: subchild.children
            };
        }
        collapseTreeInplace(child);
        new_children.push(child);
    }
    tree.children = new_children;
}

interface FakeTarget {
    name: string;
    sourceDirectory?: string;
    folder?: { name: string };
    isGeneratorProvided?: boolean;
}

function makeTree(): PathedTree<FakeTarget> {
    return { pathPart: '', items: [], children: [] };
}

/**
 * Simulates the ProjectNode.update() tree-building logic for "tree" mode.
 */
function buildTreeMode(projectRoot: string, targets: FakeTarget[]): PathedTree<FakeTarget> {
    const tree = makeTree();
    for (const target of targets) {
        if (target.isGeneratorProvided) {
            continue;
        }
        const srcdir = target.sourceDirectory || '';
        const relpath = path.relative(projectRoot, srcdir);
        const safePath = relpath.startsWith('..') ? '' : relpath;
        addToTree(tree, safePath, target);
    }
    collapseTreeInplace(tree);
    return tree;
}

/**
 * Simulates the ProjectNode.update() tree-building logic for "list" mode.
 */
function buildListMode(targets: FakeTarget[]): PathedTree<FakeTarget> {
    const tree = makeTree();
    for (const target of targets) {
        if (target.isGeneratorProvided) {
            continue;
        }
        if (target.folder) {
            addToTree(tree, target.folder.name, target);
        } else {
            addToTree(tree, '', target);
        }
    }
    return tree;
}

suite('[ProjectOutline tree building]', () => {

    suite('tree mode', () => {
        test('targets are grouped by sourceDirectory relative to project root', () => {
            const projectRoot = '/home/user/project';
            const targets: FakeTarget[] = [
                { name: 'app', sourceDirectory: '/home/user/project/src' },
                { name: 'lib', sourceDirectory: '/home/user/project/src' },
                { name: 'util', sourceDirectory: '/home/user/project/libs/util' }
            ];

            const tree = buildTreeMode(projectRoot, targets);

            // 'src' subtree should contain app and lib
            const srcChild = tree.children.find(c => c.pathPart === 'src');
            expect(srcChild, 'src subtree should exist').to.not.be.undefined;
            expect(srcChild!.items.map(i => i.name)).to.have.members(['app', 'lib']);

            // 'libs/util' subtree (collapsed) should contain util
            const libsChild = tree.children.find(c => c.pathPart.includes('util'));
            expect(libsChild, 'libs/util subtree should exist').to.not.be.undefined;
            expect(libsChild!.items.map(i => i.name)).to.include('util');
        });

        test('targets outside project root fall back to flat entry', () => {
            const projectRoot = '/home/user/project';
            const targets: FakeTarget[] = [
                { name: 'external_lib', sourceDirectory: '/home/user/external' },
                { name: 'app', sourceDirectory: '/home/user/project/src' }
            ];

            const tree = buildTreeMode(projectRoot, targets);

            // external_lib should be at root level (safePath = '')
            const rootItems = tree.items.map(i => i.name);
            expect(rootItems).to.include('external_lib');

            // app should be under 'src'
            const srcChild = tree.children.find(c => c.pathPart === 'src');
            expect(srcChild).to.not.be.undefined;
            expect(srcChild!.items.map(i => i.name)).to.include('app');
        });

        test('targets at project root are placed at root level', () => {
            const projectRoot = '/home/user/project';
            const targets: FakeTarget[] = [
                { name: 'root_target', sourceDirectory: '/home/user/project' }
            ];

            const tree = buildTreeMode(projectRoot, targets);
            expect(tree.items.map(i => i.name)).to.include('root_target');
        });

        test('generator-provided targets are skipped', () => {
            const projectRoot = '/home/user/project';
            const targets: FakeTarget[] = [
                { name: 'ALL_BUILD', sourceDirectory: '/home/user/project', isGeneratorProvided: true },
                { name: 'app', sourceDirectory: '/home/user/project/src' }
            ];

            const tree = buildTreeMode(projectRoot, targets);
            const allNames: string[] = [];
            function collectNames(t: PathedTree<FakeTarget>) {
                allNames.push(...t.items.map(i => i.name));
                t.children.forEach(collectNames);
            }
            collectNames(tree);
            expect(allNames).to.not.include('ALL_BUILD');
            expect(allNames).to.include('app');
        });
    });

    suite('list mode', () => {
        test('targets are grouped by folder.name', () => {
            const targets: FakeTarget[] = [
                { name: 'app', folder: { name: 'Applications' } },
                { name: 'lib', folder: { name: 'Libraries' } },
                { name: 'plugin', folder: { name: 'Libraries' } }
            ];

            const tree = buildListMode(targets);

            const appsChild = tree.children.find(c => c.pathPart === 'Applications');
            expect(appsChild).to.not.be.undefined;
            expect(appsChild!.items.map(i => i.name)).to.deep.equal(['app']);

            const libsChild = tree.children.find(c => c.pathPart === 'Libraries');
            expect(libsChild).to.not.be.undefined;
            expect(libsChild!.items.map(i => i.name)).to.have.members(['lib', 'plugin']);
        });

        test('targets without folder are placed at root', () => {
            const targets: FakeTarget[] = [
                { name: 'standalone' },
                { name: 'grouped', folder: { name: 'Group' } }
            ];

            const tree = buildListMode(targets);
            expect(tree.items.map(i => i.name)).to.include('standalone');
        });

        test('generator-provided targets are skipped', () => {
            const targets: FakeTarget[] = [
                { name: 'ZERO_CHECK', isGeneratorProvided: true },
                { name: 'app', folder: { name: 'Apps' } }
            ];

            const tree = buildListMode(targets);
            const allNames: string[] = [];
            function collectNames(t: PathedTree<FakeTarget>) {
                allNames.push(...t.items.map(i => i.name));
                t.children.forEach(collectNames);
            }
            collectNames(tree);
            expect(allNames).to.not.include('ZERO_CHECK');
            expect(allNames).to.include('app');
        });
    });
});

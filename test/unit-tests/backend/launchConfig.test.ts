import { expect } from 'chai';
import { selectMode, LaunchConfig } from '@cmt/launchConfig';

/**
 * Pure-logic tests for the cmake.launchConfig mode-selection predicate.
 * src/launchConfig.ts is intentionally vscode-free, so it can be imported
 * directly here without the mirror-inline workaround used elsewhere.
 */
suite('launchConfig.selectMode', () => {
    test('undefined config => none', () => {
        expect(selectMode(undefined)).to.equal('none');
    });

    test('empty object => none (regression: VS Code materializes object settings as {})', () => {
        expect(selectMode({})).to.equal('none');
    });

    test('only "args" populated, no task/program => none', () => {
        const cfg: LaunchConfig = { args: ['--foo'] };
        expect(selectMode(cfg)).to.equal('none');
    });

    test('task as bare string => task', () => {
        expect(selectMode({ task: 'flash' })).to.equal('task');
    });

    test('task as object form => task', () => {
        expect(selectMode({ task: { name: 'flash', type: 'shell' } })).to.equal('task');
    });

    test('program only => program', () => {
        expect(selectMode({ program: '/usr/bin/openocd' })).to.equal('program');
    });

    test('both task and program (schema-impossible) => task wins', () => {
        expect(selectMode({ task: 'flash', program: '/usr/bin/openocd' })).to.equal('task');
    });

    test('empty-string task is falsy => falls through', () => {
        expect(selectMode({ task: '' as any, program: '/p' })).to.equal('program');
    });
});

import { expect } from 'chai';
import { CMakeProject } from '@cmt/cmakeProject';

suite('CMakeProject useCMakePresets change', () => {
    test('An awaited doUseCMakePresetsChange returns only after a change already in progress has finished', async () => {
        let changeFinished = false;
        // Only the members doUseCMakePresetsChange uses when switching to kits, plus the fields the constructor would set.
        const project: CMakeProject = Object.create(CMakeProject.prototype, {
            workspaceContext: { value: { config: { useCMakePresets: 'never' } } },
            wasUsingCMakePresets: { value: true, writable: true },
            _useCMakePresetsChangeInProgress: { value: Promise.resolve(), writable: true },
            setUseCMakePresets: { value: async () => {} },
            initializeKitOrPresets: {
                value: async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    changeFinished = true;
                }
            },
            onUseCMakePresetsChangedEmitter: { value: { fire: () => {} } }
        });

        // Like the presets changed listener, which does not await the change.
        const inProgress = project.doUseCMakePresetsChange();
        await project.doUseCMakePresetsChange();

        expect(changeFinished).to.be.true;
        await inProgress;
    });
});

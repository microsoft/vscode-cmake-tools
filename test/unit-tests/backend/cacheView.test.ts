import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationWebview } from '@cmt/ui/cacheView';

suite('[cacheView]', () => {
    test('refreshes a visible clean cache editor after external cache changes', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-cache-view-'));
        const cachePath = path.join(tempDir, 'CMakeCache.txt');
        try {
            fs.writeFileSync(cachePath, '//A value changed by configure\nDERIVED_MESSAGE:STRING=Old value\n');
            const webview = new ConfigurationWebview(cachePath, async () => {});
            await webview.renderWebview(webview.panel, true);
            expect(webview.panel.webview.html).to.contain('value="Old value"');

            fs.writeFileSync(cachePath, '//A value changed by configure\nDERIVED_MESSAGE:STRING=Updated value\n');
            await webview.refreshPanel();

            expect(webview.panel.webview.html).to.contain('value="Updated value"');
            expect(webview.panel.webview.html).not.to.contain('value="Old value"');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('waits for configure so its cache changes can refresh the editor', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-cache-view-'));
        const cachePath = path.join(tempDir, 'CMakeCache.txt');
        try {
            fs.writeFileSync(cachePath, '//A value changed by configure\nDERIVED_MESSAGE:STRING=Old value\n');
            const webview = new ConfigurationWebview(cachePath, async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(webview.isDirty).to.be.false;
                fs.writeFileSync(cachePath, '//A value changed by configure\nDERIVED_MESSAGE:STRING=Updated by configure\n');
                await webview.refreshPanel();
            });
            await webview.renderWebview(webview.panel, true);

            const options = (webview as unknown as { options: { value: string; dirty: boolean }[] }).options;
            options[0].value = 'User value';
            options[0].dirty = true;
            webview.isDirty = true;
            await webview.persistCacheEntries();

            expect(webview.panel.webview.html).to.contain('value="Updated by configure"');
            expect(webview.panel.webview.html).not.to.contain('value="User value"');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

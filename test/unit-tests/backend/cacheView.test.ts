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
            const webview = new ConfigurationWebview(cachePath, () => {});
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
});

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { ConfigurationWebview } from '@cmt/ui/cacheView';

suite('[cacheView]', () => {
    test('filters advanced and internal entries independently, combines search, and restores filters', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-cache-filters-'));
        const cachePath = path.join(tempDir, 'CMakeCache.txt');
        try {
            fs.writeFileSync(cachePath, [
                'PUBLIC:STRING=public value',
                'EXPERT:BOOL=ON',
                'PRIVATE:INTERNAL=private value',
                'BOTH:INTERNAL=both value',
                'FIXED:STATIC=fixed value',
                'EXPERT-ADVANCED:INTERNAL=1',
                'BOTH-ADVANCED:INTERNAL=1'
            ].join('\n'));
            const webview = new ConfigurationWebview(cachePath, async () => {});
            const options = await webview.getConfigurationOptions();
            expect(options.map(option => [option.key, option.advanced, option.internal])).to.deep.equal([
                ['PUBLIC', false, false], ['EXPERT', true, false],
                ['PRIVATE', false, true], ['BOTH', true, true]
            ]);
            await webview.renderWebview(webview.panel, true);
            const html = webview.panel.webview.html;
            expect(html).not.to.contain('id="FIXED"');

            // Execute the generated webview script with a minimal DOM and VS Code state API.
            const rows = (html.match(/<tr class="content-tr([^"]*)" data-advanced="(true|false)" data-internal="(true|false)">([\s\S]*?)<\/tr>/g) || []).map(markup => {
                const match = /<tr class="content-tr([^"]*)" data-advanced="(true|false)" data-internal="(true|false)">([\s\S]*?)<\/tr>/.exec(markup)!;
                return {
                    innerHTML: match[4],
                    dataset: { advanced: match[2], internal: match[3] },
                    hidden: match[1].includes('invisible'),
                    classList: { toggle(_name: string, _hidden: boolean) {} }
                };
            }).map(row => {
                row.classList.toggle = (_name: string, hidden: boolean) => {
                    row.hidden = hidden;
                };
                return row;
            });
            const search = { value: '', focus() {} };
            const advanced = { checked: false };
            const internal = { checked: false };
            const elements: Record<string, unknown> = { search, 'show-advanced': advanced, 'show-internal': internal };
            let state: unknown;
            const messages: unknown[] = [];
            const context = vm.createContext({
                acquireVsCodeApi: () => ({
                    getState: () => state,
                    setState: (value: unknown) => {
                        state = value;
                    },
                    postMessage: (value: unknown) => messages.push(value)
                }),
                document: {
                    getElementById: (id: string) => elements[id],
                    querySelector: () => search,
                    querySelectorAll: (selector: string) => selector === '.content-tr' ? rows : []
                },
                window: { onload: () => {} }
            });
            vm.runInContext(/<script>([\s\S]*?)<\/script>/.exec(html)![1], context);
            const visible = () => rows.map(row => !row.hidden);
            vm.runInContext('window.onload()', context);
            expect(visible()).to.deep.equal([true, false, false, false]);
            advanced.checked = true;
            vm.runInContext('search()', context);
            expect(visible()).to.deep.equal([true, true, false, false]);
            advanced.checked = false;
            internal.checked = true;
            vm.runInContext('search()', context);
            expect(visible()).to.deep.equal([true, false, true, false]);
            advanced.checked = true;
            vm.runInContext('search()', context);
            expect(visible()).to.deep.equal([true, true, true, true]);
            search.value = 'pRiVaTe';
            vm.runInContext('search()', context);
            expect(visible()).to.deep.equal([false, false, true, false]);
            internal.checked = false;
            vm.runInContext('search()', context);
            expect(visible()).to.deep.equal([false, false, false, false]);
            search.value = '';
            advanced.checked = false;
            internal.checked = true;
            vm.runInContext('window.onload()', context);
            expect(search.value).to.equal('pRiVaTe');
            expect(advanced.checked).to.be.true;
            expect(internal.checked).to.be.false;
            expect(visible()).to.deep.equal([false, false, false, false]);
            expect(messages).to.be.empty;
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('saves edits to advanced and internal entries even when their rows are hidden', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-cache-filter-save-'));
        const cachePath = path.join(tempDir, 'CMakeCache.txt');
        try {
            fs.writeFileSync(cachePath, 'EXPERT:BOOL=ON\nEXPERT-ADVANCED:INTERNAL=1\nPRIVATE:INTERNAL=old\n');
            const webview = new ConfigurationWebview(cachePath, async () => {});
            await webview.renderWebview(webview.panel, true);
            const options = (webview as unknown as { options: { value: string | boolean; dirty: boolean }[] }).options;
            options[0].value = false;
            options[0].dirty = true;
            options[1].value = 'new';
            options[1].dirty = true;
            webview.isDirty = true;
            await webview.renderWebview();
            await webview.persistCacheEntries();
            const content = fs.readFileSync(cachePath, 'utf8');
            expect(content).to.contain('EXPERT:BOOL=FALSE');
            expect(content).to.contain('PRIVATE:INTERNAL=new');
            expect(content).to.contain('EXPERT-ADVANCED:INTERNAL=1');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

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

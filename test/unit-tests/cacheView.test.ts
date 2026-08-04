import { expect } from 'chai';
import { ConfigurationWebview, IOption } from '@cmt/ui/cacheView';

suite('Cache editor webview', () => {
    test('renders STRINGS choices as an unfiltered popup list', () => {
        const webview = Object.create(ConfigurationWebview.prototype) as ConfigurationWebview;
        const options: IOption[] = [
            {
                key: 'Renderer',
                type: 'String',
                helpString: 'Renderer Device',
                choices: ['SKIA', 'TGFX'],
                value: 'TGFX',
                dirty: false
            },
            {
                key: 'OutputPath',
                type: 'String',
                helpString: 'Output path',
                choices: [],
                value: '/tmp/output',
                dirty: false
            }
        ];

        (webview as any).cmakeCacheEditorText = 'CMake Cache Editor';
        (webview as any).options = options;

        const html = webview.getWebviewMarkup();

        expect(html).not.to.contain('<datalist');
        expect(html).not.to.contain('list="CHOICES_Renderer"');
        expect(html).to.contain('data-choices-id="CHOICES_Renderer"');
        expect(html).to.contain('data-value="SKIA"');
        expect(html).to.contain('data-value="TGFX"');
        expect(html).to.contain('value="TGFX"');
        expect(html).to.contain('<div class="cmake-string-editor cmake-choice-editor">');
        expect(html).to.contain('<div class="cmake-string-editor">\n          <input class="cmake-input-text" id="OutputPath"');
    });
});

import {parseCompileFlags} from '@cmt/cpptools';
import {expect} from '@test/util';

// tslint:disable:no-unused-expression

suite('CppTools tests', () => {
  test('Parse some compiler flags', () => {
    let info = parseCompileFlags(['-DFOO=BAR']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR']);
    info = parseCompileFlags(['-D', 'FOO=BAR']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR']);
    info = parseCompileFlags(['-DFOO=BAR', '/D', 'BAZ=QUX']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR', 'BAZ=QUX']);
    expect(info.standard).to.eql('c++17');
    info = parseCompileFlags(['-std=c++03']);
    expect(info.standard).to.eql('c++03');
  });
});

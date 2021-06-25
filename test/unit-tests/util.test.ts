import {splitPath} from '@cmt/util';
import {expect} from '@test/util';

suite('Utils test', async () => {
  test('Split path into elements', () => {
    const elems = splitPath('foo/bar/baz');
    expect(elems).to.eql(['foo', 'bar', 'baz']);
  });
  test('Split empty path', () => {
    const elems = splitPath('');
    expect(elems).to.eql([]);
  });
});

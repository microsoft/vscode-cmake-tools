require('module-alias/register');

import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

import {Strand} from '@cmt/strand';

function pause(time: number): Promise<void> {
  return new Promise(resolve => { setTimeout(() => resolve(), time); });
}

// tslint:disable:no-unused-expression

suite('Running strands', () => {
  test('Run a thing', async () => {
    const arr: number[] = [];
    const s = new Strand();
    await s.execute(() => arr.push(12));
    expect(arr).to.eql([12]);
  });
  test('Run in order', async () => {
    const arr: number[] = [];
    const s = new Strand();
    await s.execute(() => arr.push(12));
    const pr = s.execute(async () => {
      await pause(500);
      expect(arr).to.eql([12]);
    });
    const pr2 = s.execute(() => arr.push(24));
    expect(arr).to.eql([12]);
    await pr;
    await pr2;
    expect(arr).to.eql([12, 24]);
  });
});
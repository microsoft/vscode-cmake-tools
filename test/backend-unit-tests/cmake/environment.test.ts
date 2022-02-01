import * as  util from 'util';
import { expect } from 'chai';
import { EnvironmentUtils } from '@cmt/environmentVariables';

suite('[Environment]', async () => {
    test('Environment variable to `preserve/non-preserve null` `win/non-win`', () => {
        const envA = {
            A: 'x',
            B: null,
            d: 'D',
            e: null
        };
        const envB = {
            a: 'T',
            u: 'BBQ',
            D: null,
            E: 'E'
        };
        const resultA = EnvironmentUtils.merge([envA, undefined, null, envB], {preserveNull: false, isWin32: false});
        expect(util.inspect(resultA)).to.equal("{ A: 'x', d: 'D', a: 'T', u: 'BBQ', E: 'E' }");
        expect(resultA + '').to.equal("[object Object]");
        expect(JSON.stringify(resultA)).to.equal('{"A":"x","d":"D","a":"T","u":"BBQ","E":"E"}');
        expect(resultA).to.deep.equal({A: 'x', a: 'T', u: 'BBQ', d: 'D', E: 'E'});
        expect(resultA.hasOwnProperty('U')).to.equal(false);
        expect(resultA.hasOwnProperty('u')).to.equal(true);
        expect('U' in resultA).to.equal(false);
        expect('u' in resultA).to.equal(true);

        const resultB = EnvironmentUtils.merge([envA, undefined, null, envB], {preserveNull: true, isWin32: false});
        expect(resultB).to.deep.equal({A: 'x', B: null, a: 'T', u: 'BBQ', d: 'D', D: null, e: null, E: 'E'});
        expect(resultB.hasOwnProperty('U')).to.equal(false);
        expect(resultB.hasOwnProperty('u')).to.equal(true);
        expect('U' in resultB).to.equal(false);
        expect('u' in resultB).to.equal(true);

        const resultC = EnvironmentUtils.merge([envA, undefined, null, envB], {preserveNull: false, isWin32: true});
        expect(resultC).to.deep.equal({A: 'T', u: 'BBQ', e: 'E'});
        expect(resultC.hasOwnProperty('U')).to.equal(true);
        expect(resultC.hasOwnProperty('u')).to.equal(true);
        expect('U' in resultC).to.equal(true);
        expect('u' in resultC).to.equal(true);

        const resultD = EnvironmentUtils.merge([envA, undefined, null, envB], {preserveNull: true, isWin32: true});
        expect(resultD).to.deep.equal({A: 'T', B: null, u: 'BBQ', d: null, e: 'E'});
        expect(resultD.hasOwnProperty('U')).to.equal(true);
        expect(resultD.hasOwnProperty('u')).to.equal(true);
        expect('U' in resultD).to.equal(true);
        expect('u' in resultD).to.equal(true);

        const m = new Map<string, string>();
        m.set('DD', 'FF');
        m.set('dd', 'FE');
        const resultE = EnvironmentUtils.create(m, {preserveNull: false, isWin32: false});
        expect(resultE).to.deep.equal({DD: 'FF', dd: 'FE'});
        const resultF = EnvironmentUtils.create(m, {preserveNull: false, isWin32: true});
        expect(resultF).to.deep.equal({DD: 'FE'});
        expect(resultF['dd']).to.equal('FE');

        /* Testing win32 case-insensitive environment variable */
        expect(Object.prototype.hasOwnProperty.call(resultF, 'dD')).to.equal(true);
        expect(Object.prototype.hasOwnProperty.call(resultF, 'Dd')).to.equal(true);
        expect(Object.prototype.hasOwnProperty.call(resultF, 'DD-non-exist-key')).to.equal(false);
        expect(Object.keys(resultF).sort()).to.deep.equal(["DD"]);
        expect(resultF['DD-NON-EXIST-key']).to.equal(undefined);
        expect(Object.keys(resultF).sort()).to.deep.equal(["DD"]);
        resultF['DD-NON-EXIST-KEY'] = 'bb';
        expect(resultF['DD-NON-EXIST-KEY']).to.equal('bb');
        expect(Object.keys(resultF).sort()).to.deep.equal(["DD", "DD-NON-EXIST-KEY"]);
        resultF['DD-NON-EXIST-key'] = 'cc';
        expect(resultF['DD-NON-EXIST-KEY']).to.equal('cc');
        expect(Object.keys(resultF).sort()).to.deep.equal(["DD", "DD-NON-EXIST-KEY"]);

        const localeOverrideA = EnvironmentUtils.create({
            LANG: "C",
            LC_ALL: "C",
            lc_all: "C"
        }, {preserveNull: false, isWin32: false});
        expect(localeOverrideA).to.deep.equal({LANG: 'C', LC_ALL: 'C', lc_all: "C"});

        const localeOverrideB = EnvironmentUtils.create({
            LANG: "C",
            LC_ALL: "C",
            lc_all: "GBK"
        }, {preserveNull: false, isWin32: true});
        expect(localeOverrideB).to.deep.equal({LANG: 'C', LC_ALL: 'GBK'});
    });
});

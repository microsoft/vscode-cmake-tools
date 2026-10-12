import { expect } from 'chai';
import { resolveBuildCompletionLogMethod, resolveBuildLogMethod } from '@cmt/buildLogLevel';

suite('Build log level resolution', () => {
    test('default behavior logs stdout as info and stderr as error', () => {
        expect(resolveBuildLogMethod(undefined, false, false)).to.equal('info');
        expect(resolveBuildLogMethod(undefined, true, false)).to.equal('error');
        // Severity is ignored when the setting is off.
        expect(resolveBuildLogMethod('warning', false, false)).to.equal('info');
        expect(resolveBuildLogMethod('error', true, false)).to.equal('error');
    });

    test('by-severity logs errors at error level', () => {
        expect(resolveBuildLogMethod('error', false, true)).to.equal('error');
        expect(resolveBuildLogMethod('fatal error', false, true)).to.equal('error');
        expect(resolveBuildLogMethod('catastrophic error', true, true)).to.equal('error');
    });

    test('by-severity logs warnings at warning level', () => {
        expect(resolveBuildLogMethod('warning', false, true)).to.equal('warning');
        expect(resolveBuildLogMethod('warning', true, true)).to.equal('warning');
    });

    test('by-severity demotes routine stdout to debug', () => {
        expect(resolveBuildLogMethod(undefined, false, true)).to.equal('debug');
        expect(resolveBuildLogMethod('note', false, true)).to.equal('debug');
        expect(resolveBuildLogMethod('info', false, true)).to.equal('debug');
    });

    test('by-severity keeps unclassified stderr at error', () => {
        expect(resolveBuildLogMethod(undefined, true, true)).to.equal('error');
        expect(resolveBuildLogMethod('note', true, true)).to.equal('error');
    });

    test('by-severity logs a failed build completion at error level', () => {
        expect(resolveBuildCompletionLogMethod(1, true)).to.equal('error');
        expect(resolveBuildCompletionLogMethod(-1, true)).to.equal('error');
    });

    test('build completion preserves info for successful, terminated, and default behavior', () => {
        expect(resolveBuildCompletionLogMethod(0, true)).to.equal('info');
        expect(resolveBuildCompletionLogMethod(null, true)).to.equal('info');
        expect(resolveBuildCompletionLogMethod(1, false)).to.equal('info');
    });
});

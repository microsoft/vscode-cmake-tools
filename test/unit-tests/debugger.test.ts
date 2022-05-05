import { fromDebuggerEnvironmentVars, makeDebuggerEnvironmentVars } from "@cmt/util";
import { expect } from "@test/util";

suite('debugger tests', () => {
    test('No variable expansion env vars', () => {
        const env: {[key: string]: string} = {};
        env['foo'] = 'bar';
        env['other'] = '${hey';
        env['BASH_FUNC_which%%'] = '() {  ( alias;\n eval ${which_declare} ) | /usr/bin/which --tty-only --read-alias --read-functions --show-tilde --show-dot \"$@\"\n}';
        env['BASH_FUNC_module()'] = '() { eval $($LMOD_CMD bash "$@") && eval $(${LMOD_SETTARG_CMD:-:} -s sh';
        env['BASH_FUNC_ml%%'] = '() {  module ml \"$@\"\n}';

        const debugEnv = fromDebuggerEnvironmentVars(makeDebuggerEnvironmentVars(env));
        expect(debugEnv).to.contain.keys('foo', 'other');
        expect(debugEnv).to.not.contain.keys('BASH_FUNC_which%%', 'BASH_FUNC_module()', 'BASH_FUNC_ml%%');
    });
});

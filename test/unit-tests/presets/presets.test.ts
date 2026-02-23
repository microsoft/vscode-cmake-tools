import { buildArgs, Condition, configureArgs, evaluateCondition, getArchitecture, getToolset } from '@cmt/presets/preset';
import { expect } from '@test/util';
import * as os from "os";

suite('Preset tests', () => {
    test('Parse architecture', () => {
        expect(getArchitecture({ name: 'test', architecture: 'x86' })).to.eq('x86');
        expect(getArchitecture({ name: 'test', architecture: 'amd64' })).to.eq('amd64');
        expect(getArchitecture({ name: 'test', architecture: { value: 'arm', strategy: 'set' } })).to.eq('arm');
        expect(getArchitecture({ name: 'test', architecture: { value: 'arm64', strategy: 'external' } })).to.eq('arm64');
        if (os.arch() === "arm64") {
            expect(getArchitecture({ name: "test" })).to.eq("arm64");
        } else if (os.arch() === "arm") {
            expect(getArchitecture({ name: "test" })).to.eq("arm");
        } else if (os.arch() === "x32" || os.arch() === "ia32") {
            expect(getArchitecture({ name: "test" })).to.eq("x86");
        } else {
            expect(getArchitecture({ name: "test" })).to.eq("x64");
        }
        expect(getArchitecture({ name: 'test', architecture: 'bogus' })).to.eq('bogus');
    });

    test('Parse toolset', () => {
        let toolset = getToolset({ name: 'test', toolset: 'v141' });
        expect(toolset).to.not.contain.keys('name');
        expect(toolset.version).to.eq('14.16');

        toolset = getToolset({ name: 'test', toolset: 'v142' });
        expect(toolset).to.not.contain.keys('name');
        expect(toolset.version).to.eq('14.29');

        toolset = getToolset({ name: 'test', toolset: { value: 'v140', strategy: 'set' } });
        expect(toolset).to.not.contain.keys('name');
        expect(toolset.version).to.eq('14.0');

        toolset = getToolset({ name: 'test', toolset: { value: 'v143', strategy: 'external' } });
        expect(toolset.name).to.eq('v143');
        expect(toolset).to.not.contain.keys('version');

        toolset = getToolset({ name: 'test', toolset: 'host=x86' });
        expect(toolset.host).to.eq('x86');
        toolset = getToolset({ name: 'test', toolset: 'host=x64' });
        expect(toolset.host).to.eq('x64');
        toolset = getToolset({ name: 'test', toolset: 'host=x86,version=14.31' });
        expect(toolset.host).to.eq('x86');
        expect(toolset.version).to.eq('14.31');
        toolset = getToolset({ name: 'test', toolset: 'host=x64,version=14.0' });
        expect(toolset.host).to.eq('x64');
        expect(toolset.version).to.eq('14.0');
        toolset = getToolset({ name: 'test', toolset: 'host=x64,version=14.31.12345' });
        expect(toolset.host).to.eq('x64');
        expect(toolset.version).to.eq('14.31.12345');
        toolset = getToolset({ name: 'test', toolset: 'v143,host=arm,version=14.31.12345' });
        expect(toolset.host).to.eq('arm');
        expect(toolset.version).to.eq('14.31.12345');
        toolset = getToolset({ name: 'test', toolset: 'v141,host=arm64,version=14.31.12345' }); // bogus, but testing the override
        expect(toolset.host).to.eq('arm64');
        expect(toolset.version).to.eq('14.31.12345');
        toolset = getToolset({ name: 'test', toolset: 'v143,version=14.31.12345,host=x64,cuda=hey,vctargetspath=nope' });
        expect(toolset.host).to.eq('x64');
        expect(toolset.version).to.eq('14.31.12345');
        expect(toolset.cuda).to.eq('hey');
        expect(toolset.VCTargetsPath).to.eq('nope');
    });

    test('Evaluate condition objects', () => {
        let condition: Condition = { type: 'const', value: true };
        expect(evaluateCondition(condition)).to.eql(true);
        condition = { type: 'const', value: false };
        expect(evaluateCondition(condition)).to.eql(false);

        condition = { type: 'notEquals', lhs: 'blah', rhs: 'blah' };
        expect(evaluateCondition(condition)).to.eql(false);
        condition = { type: 'notEquals', lhs: 'blah', rhs: 'halb' };
        expect(evaluateCondition(condition)).to.eql(true);

        condition = { type: 'inList', string: 'apple', list: ['orange', 'banana', 'apple'] };
        expect(evaluateCondition(condition)).to.eql(true);
        condition = { type: 'inList', string: 'pear', list: ['orange', 'banana', 'apple'] };
        expect(evaluateCondition(condition)).to.eql(false);

        condition = { type: 'matches', string: 'vs123code', regex: String.raw`\w+\d{3}code` };
        expect(evaluateCondition(condition)).to.eql(true);
        condition = { type: 'matches', string: 'vs123code', regex: String.raw`\w+\d{4}code` };
        expect(evaluateCondition(condition)).to.eql(false);

        condition = {
            type: 'allOf', conditions: [
                { type: 'const', value: true },
                { type: 'equals', lhs: 'foo', rhs: 'foo' }
            ]
        };
        expect(evaluateCondition(condition)).to.eql(true);

        condition.type = 'anyOf';
        expect(evaluateCondition(condition)).to.eql(true);

        condition = {
            type: 'allOf', conditions: [
                { type: 'const', value: false },
                { type: 'equals', lhs: 'foo', rhs: 'foo' }
            ]
        };
        expect(evaluateCondition(condition)).to.eql(false);

        condition.type = 'anyOf';
        expect(evaluateCondition(condition)).to.eql(true);

        condition = {
            type: 'anyOf', conditions: [
                { type: 'const', value: false },
                { type: 'equals', lhs: 'foo', rhs: 'oof' }
            ]
        };
        expect(evaluateCondition(condition)).to.eql(false);

        const notCondition: Condition = { type: 'not', condition: condition };
        expect(evaluateCondition(notCondition)).to.eql(true);

        // Force TypeScript to ignore invalid type field.
        // In practice, it's possible the preset condition can be an invalid Condition object
        // since there are no type checks when parsing the raw json (see presetsController.parsePresetsFile)
        // @ts-ignore
        let badCondition: Condition = { type: 'oops' }!;
        expect(() => evaluateCondition(badCondition)).to.throw();

        badCondition = { type: 'equals', lhs: 'lhs' };
        expect(() => evaluateCondition(badCondition)).to.throw();
    });

    test('configureArgs skips $comment keys in cacheVariables', () => {
        // Test that $comment at the top level of cacheVariables is skipped
        const preset1: any = {
            name: 'test',
            cacheVariables: {
                '$comment': 'This is a comment',
                'CMAKE_BUILD_TYPE': 'Debug'
            }
        };
        const args1 = configureArgs(preset1);
        expect(args1).to.deep.eq(['-DCMAKE_BUILD_TYPE=Debug']);
        expect(args1.some(arg => arg.includes('$comment'))).to.eq(false);

        // Test that $comment as an array (multi-line) is also skipped
        const preset2: any = {
            name: 'test',
            cacheVariables: {
                '$comment': ['Line 1', 'Line 2'],
                'MY_VAR': 'value'
            }
        };
        const args2 = configureArgs(preset2);
        expect(args2).to.deep.eq(['-DMY_VAR=value']);

        // Test with object-style cache variable with $comment inside the object
        // This is the main use case from issue #4709 - $comment inside cacheVariable object
        const preset3: any = {
            name: 'test',
            cacheVariables: {
                'CMAKE_EXE_LINKER_FLAGS': {
                    type: 'STRING',
                    '$comment': 'Suppress warning about free-nonheap-object',
                    value: '-Wno-error=free-nonheap-object'
                }
            }
        };
        const args3 = configureArgs(preset3);
        expect(args3).to.deep.eq(['-DCMAKE_EXE_LINKER_FLAGS:STRING=-Wno-error=free-nonheap-object']);
        // Verify $comment inside the object doesn't affect the output
        expect(args3.some(arg => arg.includes('$comment'))).to.eq(false);

        // Test with $comment both at top level and inside object
        const preset4: any = {
            name: 'test',
            cacheVariables: {
                '$comment': 'Top-level comment',
                'CMAKE_BUILD_TYPE': {
                    type: 'STRING',
                    '$comment': 'Build type comment',
                    value: 'Release'
                }
            }
        };
        const args4 = configureArgs(preset4);
        expect(args4).to.deep.eq(['-DCMAKE_BUILD_TYPE:STRING=Release']);
        expect(args4.some(arg => arg.includes('$comment'))).to.eq(false);

        // Test empty cacheVariables (should produce no args)
        const preset5: any = {
            name: 'test',
            cacheVariables: {
                '$comment': 'Only comment, no vars'
            }
        };
        const args5 = configureArgs(preset5);
        expect(args5).to.deep.eq([]);
    });

    test('buildArgs handles jobs: 0 correctly', () => {
        const preset: any = {
            name: 'test',
            __binaryDir: '/path/to/build',
            jobs: 0
        };
        const args = buildArgs(preset);
        expect(args).to.include('-j');
        // -j should be bare (no value) — next arg should NOT be '0'
        const idx = args.indexOf('-j');
        expect(args[idx + 1]).to.not.eq('0');
    });

    test('buildArgs handles jobs: positive number', () => {
        const preset: any = {
            name: 'test',
            __binaryDir: '/path/to/build',
            jobs: 8
        };
        const args = buildArgs(preset);
        const idx = args.indexOf('--parallel');
        expect(idx).to.be.greaterThan(-1);
        expect(args[idx + 1]).to.eq('8');
    });

    test('buildArgs omits -j and --parallel when jobs is undefined and no fallback', () => {
        const preset: any = {
            name: 'test',
            __binaryDir: '/path/to/build'
        };
        const args = buildArgs(preset);
        expect(args).to.not.include('-j');
        expect(args).to.not.include('--parallel');
    });

    test('buildArgs uses fallbackJobs when jobs is undefined', () => {
        const preset: any = {
            name: 'test',
            __binaryDir: '/path/to/build'
        };
        const args = buildArgs(preset, undefined, undefined, 4);
        const idx = args.indexOf('--parallel');
        expect(idx).to.be.greaterThan(-1);
        expect(args[idx + 1]).to.eq('4');
    });

    test('buildArgs prefers preset jobs over fallbackJobs', () => {
        const preset: any = {
            name: 'test',
            __binaryDir: '/path/to/build',
            jobs: 2
        };
        const args = buildArgs(preset, undefined, undefined, 8);
        const idx = args.indexOf('--parallel');
        expect(idx).to.be.greaterThan(-1);
        expect(args[idx + 1]).to.eq('2');
    });

    test('buildArgs preset jobs: 0 takes precedence over fallbackJobs', () => {
        const preset: any = {
            name: 'test',
            __binaryDir: '/path/to/build',
            jobs: 0
        };
        const args = buildArgs(preset, undefined, undefined, 8);
        expect(args).to.include('-j');
        expect(args).to.not.include('--parallel');
    });

    test('buildArgs uses fallbackJobs: 0 to pass bare -j', () => {
        const preset: any = {
            name: 'test',
            __binaryDir: '/path/to/build'
        };
        const args = buildArgs(preset, undefined, undefined, 0);
        expect(args).to.include('-j');
        expect(args).to.not.include('--parallel');
    });
});

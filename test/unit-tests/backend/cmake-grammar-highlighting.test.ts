import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

interface GrammarPattern {
    include?: string;
    name?: string;
    match?: string;
    begin?: string;
    captures?: Record<string, { name: string }>;
}

interface GrammarRepositoryEntry {
    begin?: string;
    match?: string;
    name?: string;
    patterns?: GrammarPattern[];
}

interface CMakeGrammar {
    scopeName?: string;
    patterns: GrammarPattern[];
    repository: Record<string, GrammarRepositoryEntry>;
}

function loadGrammar(): CMakeGrammar {
    const grammarPath = path.join(__dirname, '..', '..', '..', 'syntaxes', 'CMake.tmLanguage.json');
    return JSON.parse(fs.readFileSync(grammarPath, 'utf8')) as CMakeGrammar;
}

function includeOrder(patterns: GrammarPattern[], include: string): number {
    return patterns.findIndex(pattern => pattern.include === include);
}

function namedPattern(entry: GrammarRepositoryEntry, name: string): GrammarPattern {
    const pattern = entry.patterns?.find(candidate => candidate.name === name);
    expect(pattern, `expected a pattern scoped ${name}`).to.not.equal(undefined);
    return pattern!;
}

/**
 * A keyword list inside a command's argument list must only match a whole argument. Matching on
 * `\b` boundaries instead splits source files whose basename collides with a keyword, which is the
 * class of defect reported in #5083: `add_library(Log ...)` scoped the target name `Log` as the
 * `LOG` command, and a `\b`-bounded target-type keyword list would likewise split `interface.cpp`.
 */
function expectMatchesWholeArgumentsOnly(pattern: GrammarPattern, description: string) {
    expect(pattern.match, `${description} must exist`).to.be.a('string');
    expect(pattern.match, `${description} must not start on a \\b boundary`).to.not.match(/^\\b/);
    expect(pattern.match, `${description} must not end on a \\b boundary`).to.not.match(/\\b$/);
    expect(pattern.match, `${description} must be preceded by an argument boundary`).to.contain('(?<![^\\s(])');
    expect(pattern.match, `${description} must be followed by an argument boundary`).to.contain('(?![^\\s)])');
}

function toJavaScriptRegex(pattern: GrammarPattern): RegExp {
    expect(pattern.match, 'expected a regex pattern').to.be.a('string');
    return new RegExp(pattern.match!.replace(/\(\?i:/g, '(?:'), 'i');
}

suite('[CMake grammar highlighting]', () => {
    test('add_library/add_executable arguments are scoped by a dedicated rule (#5083)', () => {
        const grammar = loadGrammar();
        const scopedTargetCommand = grammar.repository.scopedTargetCommand;
        expect(scopedTargetCommand, 'expected a scopedTargetCommand rule').to.not.equal(undefined);

        // Must win over the generic command/property patterns, otherwise a target name such as
        // `Log` is scoped as the `LOG` command instead of as an ordinary argument.
        const scopedIndex = includeOrder(grammar.patterns, '#scopedTargetCommand');
        const genericIndex = includeOrder(grammar.patterns, '#commandProperties');
        expect(scopedIndex, '#scopedTargetCommand must be included').to.be.greaterThan(-1);
        expect(genericIndex, '#commandProperties must be included').to.be.greaterThan(-1);
        expect(scopedIndex).to.be.lessThan(genericIndex);

        expect(scopedTargetCommand.begin).to.contain('add_library');
        expect(scopedTargetCommand.begin).to.contain('add_executable');

        const keywordPattern = namedPattern(scopedTargetCommand, 'keyword.other.cmake');
        for (const keyword of ['STATIC', 'SHARED', 'MODULE', 'INTERFACE', 'OBJECT', 'ALIAS', 'IMPORTED']) {
            expect(keywordPattern.match).to.contain(keyword);
        }
        expectMatchesWholeArgumentsOnly(keywordPattern, 'add_library/add_executable target-type keywords');

        // Remaining arguments still fall through to the ordinary unquoted-argument rule.
        expect(scopedTargetCommand.patterns?.some(pattern => pattern.include === '#unquoted')).to.equal(true);
    });

    test('set_target_properties PROPERTIES and property names are scoped (#5083)', () => {
        const grammar = loadGrammar();
        const scopedSetTargetProperties = grammar.repository.scopedSetTargetPropertiesCommand;
        expect(scopedSetTargetProperties, 'expected a scopedSetTargetPropertiesCommand rule').to.not.equal(undefined);

        const scopedIndex = includeOrder(grammar.patterns, '#scopedSetTargetPropertiesCommand');
        const genericIndex = includeOrder(grammar.patterns, '#scopedPropertyCommand');
        expect(scopedIndex, '#scopedSetTargetPropertiesCommand must be included').to.be.greaterThan(-1);
        expect(scopedIndex).to.be.lessThan(genericIndex);

        expect(scopedSetTargetProperties.begin).to.contain('set_target_properties');

        const keywordPattern = namedPattern(scopedSetTargetProperties, 'keyword.other.cmake');
        expect(keywordPattern.match).to.contain('PROPERTIES');
        expectMatchesWholeArgumentsOnly(keywordPattern, 'the set_target_properties PROPERTIES keyword');

        const propertyNamePattern = namedPattern(scopedSetTargetProperties, 'support.type.property.cmake');
        // DEBUG_POSTFIX already worked and must keep working; EXPORT_FILE_NAME was reported missing.
        expect(propertyNamePattern.match).to.contain('DEBUG_POSTFIX');
        expect(propertyNamePattern.match).to.contain('EXPORT_FILE_NAME');
        expectMatchesWholeArgumentsOnly(propertyNamePattern, 'set_target_properties property names');

        expect(scopedSetTargetProperties.patterns?.some(pattern => pattern.include === '#unquoted')).to.equal(true);
    });

    test('the generic property command still recognizes PROPERTIES and EXPORT_FILE_NAME (#5083)', () => {
        const grammar = loadGrammar();
        const scopedPropertyCommand = grammar.repository.scopedPropertyCommand;
        expect(scopedPropertyCommand, 'expected a scopedPropertyCommand rule').to.not.equal(undefined);

        // set_tests_properties / set_source_files_properties / set_property go through this rule.
        const keywordPattern = namedPattern(scopedPropertyCommand, 'keyword.other.cmake');
        expect(keywordPattern.match).to.contain('PROPERTIES');

        const propertyNamePattern = namedPattern(scopedPropertyCommand, 'support.type.property.cmake');
        expect(propertyNamePattern.match).to.contain('EXPORT_FILE_NAME');
    });

    test('top-level command properties only match whole arguments and still match standalone keywords (#5083)', () => {
        const grammar = loadGrammar();
        const commandProperties = grammar.repository.commandProperties;
        expect(commandProperties, 'expected a commandProperties rule').to.not.equal(undefined);
        expectMatchesWholeArgumentsOnly(commandProperties, 'top-level command property keywords');

        const expression = toJavaScriptRegex(commandProperties);
        for (const usage of ['WORKING_DIRECTORY', ' DESTINATION ', '(COMPONENT)', '\nTEST)']) {
            expect(usage).to.match(expression);
        }
        for (const collision of ['test.cpp', 'Log.cpp', 'SOURCE_DIR/file.txt', 'WORKING_DIRECTORY_suffix']) {
            expect(collision).to.not.match(expression);
        }
    });

    test('top-level properties only match whole arguments and still match standalone property names (#5083)', () => {
        const grammar = loadGrammar();
        const properties = grammar.repository.properties;
        expect(properties, 'expected a properties rule').to.not.equal(undefined);
        expectMatchesWholeArgumentsOnly(properties, 'top-level property names');

        const expression = toJavaScriptRegex(properties);
        for (const usage of ['TYPE', ' VALUE ', '(LANGUAGE)', '\nLOCATION)']) {
            expect(usage).to.match(expression);
        }
        for (const collision of ['type.cpp', 'value.h', 'LANGUAGE_server', 'LOCATION/file.txt']) {
            expect(collision).to.not.match(expression);
        }
    });

    test('top-level operators only match whole arguments and still match standalone operators (#5083)', () => {
        const grammar = loadGrammar();
        const operators = grammar.repository.operators;
        expect(operators, 'expected an operators rule').to.not.equal(undefined);
        expectMatchesWholeArgumentsOnly(operators, 'top-level operators');

        const expression = toJavaScriptRegex(operators);
        for (const usage of ['TARGET', ' PATH ', '(TEST)', '\nDEFINED)']) {
            expect(usage).to.match(expression);
        }
        for (const collision of ['test.cpp', 'target.h', 'PATH_suffix', 'DEFINED/file.txt']) {
            expect(collision).to.not.match(expression);
        }
    });

    test('the grammar file is valid JSON and declares the cmake scope name', () => {
        const grammar = loadGrammar();
        expect(grammar.scopeName).to.equal('source.cmake');
        expect(grammar.patterns.length).to.be.greaterThan(0);
    });
});

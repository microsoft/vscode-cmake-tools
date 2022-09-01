import { readTestResultsFile } from "@cmt/ctest";
import { expect, getTestResourceFilePath } from "@test/util";

suite('CTest test', () => {
    test('Parse XML test results', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestResults.xml'));
        expect(result!.site.testing.testList.length).to.eq(2);
        expect(result!.site.testing.test[0].name).to.eq('test1');
        expect(result!.site.testing.test[0].status).to.eq('passed');
        expect(result!.site.testing.test[1].name).to.eq('test2');
        expect(result!.site.testing.test[1].status).to.eq('failed');
    });

    test('CTest enabled, but no tests', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestResults2.xml'));
        expect(result!.site.testing.testList.length).to.eq(0);
        expect(result!.site.testing.test.length).to.eq(0);
    });

    test('Bad test results file', async () => {
        const result = await readTestResultsFile(getTestResourceFilePath('TestCMakeCache.txt'));
        expect(result).to.eq(undefined);
    });
});

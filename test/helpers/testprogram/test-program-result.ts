import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import { platformNormalizePath } from '../../../src/util';

export class TestProgramResult {

    private readonly _result_file_location: string;

    public constructor(location: string, filename: string = 'output.txt') {
        this._result_file_location = platformNormalizePath(path.join(location, filename));
    }

    public get isPresent(): boolean {
        return fs.existsSync(this._result_file_location);
    }

    public async getResultAsJson(): Promise<any> {
        expect(this.isPresent).to.eq(true, 'Test program result file was not found');
        const content = fs.readFileSync(this._result_file_location);
        expect(content.toLocaleString()).to.not.eq('');

        return JSON.parse(content.toString());
    }
}

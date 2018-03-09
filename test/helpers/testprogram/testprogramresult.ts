
import * as path from 'path';
import * as fs from 'fs';
import { normalizePath } from '../../../src/util';
import { expect } from 'chai';

export class TestProgramResult {

    private readonly result_file_location: string;

    public constructor(location: string, filename: string = 'output.txt') {
      this.result_file_location = normalizePath(path.join(location, filename));
    }

    public get IsPresent(): boolean { return fs.existsSync(this.result_file_location); }

    public async GetResultAsJson(): Promise<any> {
      expect(this.IsPresent).to.eq(true, 'Test programm result file was not found');
      const content = fs.readFileSync(this.result_file_location);
      expect(content.toLocaleString()).to.not.eq('');

      return JSON.parse(content.toString());
    }
  }

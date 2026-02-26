import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

interface Policy {
    name: string;
    description: string;
    introduced_version: string;
    removed_version?: string;
}

interface Policies {
    [key: string]: Policy;
}

suite('policies.json', () => {
    let policies: Policies;

    suiteSetup(() => {
        const filePath = path.join(process.cwd(), 'assets', 'policies.json');
        const content = fs.readFileSync(filePath, 'utf-8');
        policies = JSON.parse(content);
    });

    test('should be valid JSON with policy entries', () => {
        expect(policies).to.be.an('object');
        expect(Object.keys(policies).length).to.be.greaterThan(0);
    });

    test('all keys should match CMP#### pattern', () => {
        for (const key of Object.keys(policies)) {
            expect(key).to.match(/^CMP\d{4}$/);
        }
    });

    test('all entries should have required fields', () => {
        for (const [key, policy] of Object.entries(policies)) {
            expect(policy.name, `${key} missing name`).to.be.a('string').and.not.empty;
            expect(policy.name, `${key} name mismatch`).to.equal(key);
            expect(policy.introduced_version, `${key} missing introduced_version`).to.be.a('string').and.not.empty;
            expect(policy.description, `${key} missing description`).to.be.a('string').and.not.empty;
        }
    });

    test('should contain well-known policies', () => {
        expect(policies).to.have.property('CMP0000');
        expect(policies).to.have.property('CMP0069');
        expect(policies).to.have.property('CMP0177');
    });

    test('CMP0177 should have correct data', () => {
        const policy = policies['CMP0177'];
        expect(policy.name).to.equal('CMP0177');
        expect(policy.introduced_version).to.equal('3.31');
        expect(policy.description).to.include('DESTINATION');
    });
});

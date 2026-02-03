/* eslint-disable no-unused-expressions */
import { expect } from '@test/util';
import * as vscode from 'vscode';
import { DebugTrackerFactory } from '@cmt/debug/cmakeDebugger/debuggerConfigureDriver';

suite('Debug Tracker tests', () => {
    test('Variables response: evaluateName is removed from variables', () => {
        const factory = new DebugTrackerFactory();
        const tracker = factory.createDebugAdapterTracker({} as vscode.DebugSession);

        // Create a mock variables response with evaluateName set
        const message = {
            type: 'response',
            command: 'variables',
            body: {
                variables: [
                    {
                        name: 'VAR1',
                        value: '99999',
                        evaluateName: 'VAR1'
                    },
                    {
                        name: 'VAR2',
                        value: 'test',
                        evaluateName: 'VAR2'
                    },
                    {
                        name: 'VAR3',
                        value: 'another',
                        variablesReference: 1
                        // No evaluateName
                    }
                ]
            }
        };

        // Call onWillReceiveMessage if it exists
        if (tracker && 'onWillReceiveMessage' in tracker) {
            (tracker as any).onWillReceiveMessage(message);
        }

        // Verify evaluateName was removed from variables that had it
        expect(message.body.variables[0]).to.not.have.property('evaluateName');
        expect(message.body.variables[1]).to.not.have.property('evaluateName');
        // VAR3 should remain unchanged (it never had evaluateName)
        expect(message.body.variables[2]).to.not.have.property('evaluateName');

        // Other properties should be preserved
        expect(message.body.variables[0].name).to.be.eq('VAR1');
        expect(message.body.variables[0].value).to.be.eq('99999');
        expect(message.body.variables[2].variablesReference).to.be.eq(1);
    });

    test('Non-variables messages are not modified', () => {
        const factory = new DebugTrackerFactory();
        const tracker = factory.createDebugAdapterTracker({} as vscode.DebugSession);

        const message = {
            type: 'response',
            command: 'scopes',
            body: {
                scopes: [
                    {
                        name: 'Local',
                        variablesReference: 1
                    }
                ]
            }
        };

        const originalMessage = JSON.stringify(message);

        // Call onWillReceiveMessage if it exists
        if (tracker && 'onWillReceiveMessage' in tracker) {
            (tracker as any).onWillReceiveMessage(message);
        }

        // Message should remain unchanged
        expect(JSON.stringify(message)).to.be.eq(originalMessage);
    });

    test('Variables response without body is handled gracefully', () => {
        const factory = new DebugTrackerFactory();
        const tracker = factory.createDebugAdapterTracker({} as vscode.DebugSession);

        const message = {
            type: 'response',
            command: 'variables'
            // No body
        };

        // Should not throw
        expect(() => {
            if (tracker && 'onWillReceiveMessage' in tracker) {
                (tracker as any).onWillReceiveMessage(message);
            }
        }).to.not.throw();
    });
});

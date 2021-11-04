import { expect } from 'chai';

export interface QuickPickerHandleStrategy {
    identifier: string;

    handleQuickPick(items: any): any;
}

export class SelectKitPickerHandle implements QuickPickerHandleStrategy {

    constructor(public defaultKitLabel: RegExp, readonly excludeKitLabel?: RegExp) {}

    public get identifier(): string {
        return 'Select a Kit';
    }

    public handleQuickPick(items: any): any {
        let defaultKit: string[] | undefined = items.filter((item: any) => {
            const name: string = item.label;
            return name ? (this.defaultKitLabel.test(name) ? item : undefined) : undefined;
        });

        if (!defaultKit || defaultKit.length === 0) {
            defaultKit = items.filter((item: any) => {
                const name: string = item.label;
                return name ? (this.defaultKitLabel.test(name)
                    && (this.excludeKitLabel ? !this.excludeKitLabel.test(name) : true)
                    ? item
                    : undefined)
                    : undefined;
            });
        }

        if (defaultKit && defaultKit.length !== 0) {
            return Promise.resolve(defaultKit[0]);
        } else {
            expect.fail('Unable to find compatible kit');
        }
    }
}

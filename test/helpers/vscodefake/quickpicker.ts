import { expect } from "chai";

export interface QuickPickerHandleStrategy {
    Identifier: string;

    handleQuickPick(items: any): any;
  }

export class SelectKitPickerHandle implements QuickPickerHandleStrategy {

    constructor(readonly defaultKitLabelRegEx: string) {}

    public get Identifier(): string { return 'Select a Kit'; }

    public handleQuickPick(items: any): any {
      const defaultKit: string[] = items.filter((item: any) => {
        const name: string = item.label;
        if (name) {
          if (new RegExp(this.defaultKitLabelRegEx).test(name)) {
            return item;
          }
        } else {
          return;
        }
      });
      if (defaultKit && defaultKit.length != 0) {
        return Promise.resolve(defaultKit[0]);
      } else {
        expect.fail('Unable to find compatible kit');
      }
    }
  }
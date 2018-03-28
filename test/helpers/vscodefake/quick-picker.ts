import {expect} from 'chai';

export interface QuickPickerHandleStrategy {
  identifier: string;

  handleQuickPick(items: any): any;
}

export class SelectKitPickerHandle implements QuickPickerHandleStrategy {

  constructor(readonly defaultKitLabel: string, readonly excludeKitLabel?: string) {}

  public get identifier(): string { return 'Select a Kit'; }

  public handleQuickPick(items: any): any {
    const defaultKit: string[] = items.filter((item: any) => {
      const name: string = item.label;
      if (name) {
        if (name.includes(this.defaultKitLabel)
            && (this.excludeKitLabel ? !name.includes(this.excludeKitLabel) : true)) {
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

import {expect} from 'chai';

export interface QuickPickerHandleStrategy {
  identifier: string;

  handleQuickPick(items: any): any;
}

export class SelectKitPickerHandle implements QuickPickerHandleStrategy {

  constructor(readonly defaultKitLabel?: string, readonly excludeKitLabel?: string) {}

  public get identifier(): string { return 'Select a Kit'; }

  public handleQuickPick(items: any): any {
    if (!this.defaultKitLabel || this.defaultKitLabel === '') {
      return Promise.resolve(items[0]);
    }

    const defaultKitLabel = this.defaultKitLabel;
    let defaultKit: string[]|undefined = items.filter((item: any) => {
      const name: string = item.label;
      return name ? (name === defaultKitLabel ? item : undefined) : undefined;
    });

    if (!defaultKit || defaultKit.length === 0) {
      defaultKit = items.filter((item: any) => {
        const name: string = item.label;
        return name ? (name.includes(defaultKitLabel)
                               && (this.excludeKitLabel ? !name.includes(this.excludeKitLabel) : true)
                           ? item
                           : undefined)
                    : undefined;
      });
    }

    if (defaultKit && defaultKit.length != 0) {
      return Promise.resolve(defaultKit[0]);
    } else {
      expect.fail('Unable to find compatible kit');
    }
  }
}

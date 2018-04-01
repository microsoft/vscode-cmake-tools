import {expect} from 'chai';
import { ProjectTypeDesciptor, ProjectType } from '@cmt/quickstart';

export interface QuickPickerHandleStrategy {
  identifier: string;

  handleQuickPick(items: any): any;
}

export class SelectProjectTypePickerHandle implements QuickPickerHandleStrategy {
  public type: ProjectType.Exectable;
  public abort: boolean = false;

  public get identifier(): string { return 'Select a project type'; }

  public handleQuickPick(items: ProjectTypeDesciptor[]): any {
    if (this.abort) {
      return null;
    }
    return items.find( item => item.type == this.type)!;
  }
}

export class SelectKitPickerHandle implements QuickPickerHandleStrategy {

  constructor(readonly defaultKitLabel: string, readonly excludeKitLabel?: string) {}

  public get identifier(): string { return 'Select a Kit'; }

  public handleQuickPick(items: any): any {
    let defaultKit: string[]|undefined = items.filter((item: any) => {
      const name: string = item.label;
      return name ? (name === this.defaultKitLabel ? item : undefined) : undefined;
    });

    if (!defaultKit || defaultKit.length === 0) {
      defaultKit = items.filter((item: any) => {
        const name: string = item.label;
        return name ? (name.includes(this.defaultKitLabel)
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

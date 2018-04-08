

export interface InputBoxPromt {
  identifier: string;

  provideResponse(): string|null;
}


export class QuickStartProjectNameInputBox implements InputBoxPromt {
  identifier: string = 'Enter a name for the new project';

  public projectName: string|null;

  provideResponse(): string|null { return this.projectName; }
}
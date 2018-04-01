

export interface InputBoxPromt {
    identifier: string;

    provideResponse(): string;
}


export class QuickStartProjectNameInputBox implements InputBoxPromt {
    identifier: string = 'Enter a name for the new project';

    public projectName : string = "";

    provideResponse(): string {
        return this.projectName;
    }
}
import CMakeProject from "@cmt/cmakeProject";
import { CodeModelContent } from "@cmt/drivers/codeModel";
import { CodeModel } from "vscode-cmake-tools";

interface ProjectOutlineCodeModel {
    project: CodeModel.Project;
}

export function populateViewCodeModel(model: CodeModelContent): ProjectOutlineCodeModel {
    const configuration = model.configurations[0];
    const originalProject = configuration.projects[0];
    const targets: CodeModel.Target[] = [];
    for (const projects of configuration.projects) {
        for (const t of projects.targets) {
            targets.push(t);
        }
    }
    const project: CodeModel.Project = {
        name: originalProject.name,
        targets: targets,
        sourceDirectory: originalProject.sourceDirectory,
        hasInstallRule: originalProject.hasInstallRule
    };
    return { project };
}

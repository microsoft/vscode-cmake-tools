import { CodeModelContent } from "@cmt/drivers/codeModel";
import { CodeModel } from "vscode-cmake-tools";

interface ProjectOutlineCodeModel {
    project: CodeModel.Project;
}

/**
 * Construct and populate the view model for the Project Outline view.
 * We are constructing a flat list of all of the targets in the project.
 * @param model The code model from the CMake FileAPI.
 */
export function populateViewCodeModel(model: CodeModelContent): ProjectOutlineCodeModel {
    const configuration = model.configurations[0];

    // The first project in the list is the root project.
    const originalProject = configuration.projects[0];

    // Flatten the list of targets into a single list.
    const targets: CodeModel.Target[] = [];
    for (const projects of configuration.projects) {
        for (const t of projects.targets) {
            targets.push(t);
        }
    }

    // Construct the new project object. Everything will be the same except for the newly constructed flat list of targets.
    const project: CodeModel.Project = {
        name: originalProject.name,
        targets: targets,
        sourceDirectory: originalProject.sourceDirectory,
        hasInstallRule: originalProject.hasInstallRule
    };
    return { project };
}

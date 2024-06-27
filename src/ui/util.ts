import { getStatusBar } from "@cmt/extension";
import { treeDataProvider } from "@cmt/projectStatus";

export async function onConfigureSettingsChange(): Promise<void> {
    await treeDataProvider.refreshConfigNode();
    getStatusBar()?.updateConfigurePresetButton();
}

export async function onBuildSettingsChange(): Promise<void> {
    await treeDataProvider.refreshBuildNode();
    getStatusBar()?.updateBuildPresetButton();
}

export async function onTestSettingsChange(): Promise<void> {
    await treeDataProvider.refreshTestNode();
    getStatusBar()?.updateTestPresetButton();
}

export async function onPackageSettingsChange(): Promise<void> {
    await treeDataProvider.refreshPackageNode();
    getStatusBar()?.updatePackagePresetButton();
}

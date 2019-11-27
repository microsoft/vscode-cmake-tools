'use strict';

import * as logging from '@cmt/logging';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import CMakeTools from '@cmt/cmake-tools';
import {
  Kit,
  readKitsFile,
  scanForKits,
  USER_KITS_FILEPATH,
  kitsPathForWorkspaceFolder,
  OLD_USER_KITS_FILEPATH,
} from '@cmt/kit';
import paths from '@cmt/paths';
import {fs} from '@cmt/pr';
import rollbar from '@cmt/rollbar';
import { ProgressHandle, reportProgress } from '@cmt/util';
import { MultiWatcher } from '@cmt/watcher';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('kitsController');

export enum KitsReadMode {
  userKits,
  folderKits,
  allAvailable
}

// TODO: migrate all kit related things in extension.ts to this class.
export class KitsController {
  static minGWSearchDirs: string[] = [];
  /**
   * The kits available from the user-local kits file
   */
  static userKits: Kit[] = [];

  folderKits: Kit[] = [];

  private constructor(readonly cmakeTools: CMakeTools, private readonly _kitsWatcher: MultiWatcher) { }

  static async init(cmakeTools: CMakeTools) {
    if (KitsController.userKits.length === 0) {
      // never initialized before
      await KitsController.readUserKits();
    }
    const kitsWatcher = new MultiWatcher(KitsController._workspaceKitsPath(cmakeTools.folder));
    kitsWatcher.onAnyEvent(_ => rollbar.takePromise(localize('rereading.kits', 'Re-reading kits'), {}, KitsController.readUserKits()));
    const kitsController = new KitsController(cmakeTools, kitsWatcher);
    await kitsController.readKits(KitsReadMode.folderKits);
    return kitsController;
  }

  dispose() {
    this._kitsWatcher.dispose();
  }

  get availableKits() {
    console.assert(KitsController.length > 0, 'readKits should have been called at least once before.');
    return KitsController.userKits.concat(this.folderKits);
  }

  get folder() { return this.cmakeTools.folder; }

  static async readUserKits(progress?: ProgressHandle) {
    debugger;
    // Read user kits if we are under userKits/allAvailable read mode, or if userKits is empty (which means userKits are never loaded)
    // Migrate kits from old pre-1.1.3 location
    try {
      if (await fs.exists(OLD_USER_KITS_FILEPATH) && !await fs.exists(USER_KITS_FILEPATH)) {
        rollbar.info(localize('migrating.kits.file', 'Migrating kits file'), {from: OLD_USER_KITS_FILEPATH, to: USER_KITS_FILEPATH});
        await fs.mkdir_p(path.dirname(USER_KITS_FILEPATH));
        await fs.rename(OLD_USER_KITS_FILEPATH, USER_KITS_FILEPATH);
      }
    } catch (e) {
      rollbar.exception(localize('failed.to.migrate.kits.file', 'Failed to migrate prior user-local kits file.'),
                        e,
                        {from: OLD_USER_KITS_FILEPATH, to: USER_KITS_FILEPATH});
    }
    // Load user-kits
    reportProgress(progress, localize('loading.kits', 'Loading kits'));
    const user = await readKitsFile(USER_KITS_FILEPATH);
    // Add the special __unspec__ kit for opting-out of kits
    user.push({name: '__unspec__'});
    KitsController.userKits = user;
    // Pruning requires user interaction, so it happens fully async
    KitsController._startPruneOutdatedKitsAsync();
  }

  /**
   * Load the list of available kits from the filesystem. This will also update the kit loaded into the current backend if applicable.
   */
  async readKits(kitsReadMode = KitsReadMode.allAvailable, progress?: ProgressHandle) {
    debugger;
    if (kitsReadMode !== KitsReadMode.folderKits) {
      KitsController.readUserKits(progress);
    }
    if (kitsReadMode !== KitsReadMode.userKits) {
      // Read folder kits
      this.folderKits = await readKitsFile(KitsController._workspaceKitsPath(this.folder));
      const current = this.cmakeTools.activeKit;
      if (current) {
        const already_active_kit = this.availableKits.find(kit => kit.name === current.name);
        // Set the current kit to the one we have named
        await this.setFolderActiveKit(already_active_kit || null);
      }
    }
  }

  /**
   * The path to the workspace-local kits file, dependent on the path to the
   * active workspace folder.
   */
  private static _workspaceKitsPath(folder: vscode.WorkspaceFolder): string { return kitsPathForWorkspaceFolder(folder); }

  /**
   * Set the current kit for the specified workspace folder
   * @param k The kit
   */
  async setFolderActiveKit(k: Kit|null) {
    const inst = this.cmakeTools;
    const raw_name = k ? k.name : '';
    if (inst) {
      // Generate a message that we will show in the progress notification
      let message = '';
      switch (raw_name) {
      case '':
      case '__unspec__':
        // Empty string/unspec is un-setting the kit:
        message = localize('unsetting.kit', 'Unsetting kit');
        break;
      default:
        // Everything else is just loading a kit:
        message = localize('loading.kit', 'Loading kit {0}', raw_name);
        break;
      }
      // Load the kit into the backend
      await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: message,
          },
          () => inst.setKit(k),
      );
    }
    return raw_name;
  }

  /**
   * User-interactive kit pruning:
   *
   * This function will find all user-local kits that identify files that are
   * no longer present (such as compiler binaries), and will show a popup
   * notification to the user requesting an action.
   *
   * This function will not prune kits that have the `keep` field marked `true`
   *
   * If the user chooses to remove the kit, we call `_removeKit()` and erase it
   * from the user-local file.
   *
   * If the user chooses to keep teh kit, we call `_keepKit()` and set the
   * `keep` field on the kit to `true`.
   *
   * Always returns immediately.
   */
  private static _startPruneOutdatedKitsAsync() {
    // Iterate over _user_ kits. We don't care about workspace-local kits
    for (const kit of KitsController.userKits) {
      if (kit.keep === true) {
        // Kit is explicitly marked to be kept
        continue;
      }
      if (!kit.compilers) {
        // We only prune kits with a `compilers` field.
        continue;
      }
      // Accrue a list of promises that resolve to whether a give file exists
      interface FileInfo {
        path: string;
        exists: boolean;
      }
      const missing_paths_prs: Promise<FileInfo>[] = [];
      for (const lang in kit.compilers) {
        const comp_path = kit.compilers[lang];
        // Get a promise that resolve to whether the given path/name exists
        const exists_pr = path.isAbsolute(comp_path)
            // Absolute path, just check if it exists
            ? fs.exists(comp_path)
            // Non-absolute. Check on $PATH
            : paths.which(comp_path).then(v => v !== null);
        // Add it to the list
        missing_paths_prs.push(exists_pr.then(exists => ({exists, path: comp_path})));
      }
      const pr = Promise.all(missing_paths_prs).then(async infos => {
        const missing = infos.find(i => !i.exists);
        if (!missing) {
          return;
        }
        // This kit contains a compiler that does not exist. What to do?
        interface UpdateKitsItem extends vscode.MessageItem {
          action: 'remove'|'keep';
        }
        const chosen = await vscode.window.showInformationMessage<UpdateKitsItem>(
            localize('kit.references.non-existent',
              'The kit "{0}" references a non-existent compiler binary [{1}]. What would you like to do?',
              kit.name, missing.path),
            {},
            {
              action: 'remove',
              title: localize('remove.it.button', 'Remove it'),
            },
            {
              action: 'keep',
              title: localize('keep.it.button', 'Keep it'),
            },
        );
        if (chosen === undefined) {
          return;
        }
        switch (chosen.action) {
        case 'keep':
          return KitsController._keepKit(kit);
        case 'remove':
          return KitsController._removeKit(kit);
        }
      });
      rollbar.takePromise(localize('pruning.kit', "Pruning kit"), {kit}, pr);
    }
  }

  /**
   * Mark a kit to be "kept". This set the `keep` value to `true` and writes
   * re-writes the user kits file.
   * @param kit The kit to mark
   */
  private static async _keepKit(kit: Kit) {
    const new_kits = KitsController.userKits.map(k => {
      if (k.name === kit.name) {
        return {...k, keep: true};
      } else {
        return k;
      }
    });
    KitsController.userKits = new_kits;
    return KitsController._writeUserKitsFile(new_kits);
  }

  /**
   * Remove a kit from the user-local kits.
   * @param kit The kit to remove
   */
  private static async _removeKit(kit: Kit) {
    const new_kits = KitsController.userKits.filter(k => k.name !== kit.name);
    KitsController.userKits = new_kits;
    return KitsController._writeUserKitsFile(new_kits);
  }

  /**
   * Write the given kits the the user-local cmake-kits.json file.
   * @param kits The kits to write to the file.
   */
  private static async _writeUserKitsFile(kits: Kit[]) {
    log.debug(localize('saving.kits.to', 'Saving kits to {0}', USER_KITS_FILEPATH));
    // Remove the special __unspec__ kit
    const stripped_kits = kits.filter(k => k.name !== '__unspec__');
    // Sort the kits by name so they always appear in order in the file.
    const sorted_kits = stripped_kits.sort((a, b) => {
      if (a.name == b.name) {
        return 0;
      } else if (a.name < b.name) {
        return -1;
      } else {
        return 1;
      }
    });
    // Do the save.
    try {
      log.debug(localize('saving.new.kits.to', 'Saving new kits to {0}', USER_KITS_FILEPATH));
      // Create the directory where the kits will go
      await fs.mkdir_p(path.dirname(USER_KITS_FILEPATH));
      // Write the file
      await fs.writeFile(USER_KITS_FILEPATH, JSON.stringify(sorted_kits, null, 2));
    } catch (e) {
      // Failed to write the file. What to do...
      interface FailOptions extends vscode.MessageItem {
        do: 'retry' | 'cancel';
      }
      const pr = vscode.window
                     .showErrorMessage<FailOptions>(
                         `Failed to write kits file to disk: ${USER_KITS_FILEPATH}: ${e.toString()}`,
                         {
                           title: localize('retry.button', 'Retry'),
                           do: 'retry',
                         },
                         {
                           title: localize('cancel.button', 'Cancel'),
                           do: 'cancel',
                         },
                         )
                     .then(choice => {
                       if (!choice) {
                         return false;
                       }
                       switch (choice.do) {
                       case 'retry':
                         return KitsController.scanForKits();
                       case 'cancel':
                         return false;
                       }
                     });
      // Don't block on writing re-trying the write
      rollbar.takePromise('retry-kit-save-fail', {}, pr);
      return false;
    }
  }

  /**
   * Rescan the system for kits and save them to the user-local kits file.
   * If cmake-tools-kits.json still has kits saved with the old format kit definition
   *     (visualStudio field as "VisualStudio.$(installation version)", as opposed to "$(unique installation id)"),
   * then ask if the user allows them to be deleted from the user-local kits file.
   *
   * If the user answers 'NO' or doesn't answer, nothing needs to be done, even if there is an active kit set,
   * because the extension is able to work with both definitions of a VS kit.
   * In this case, the new cmake-tools-kits.json may have some duplicate kits pointing to the same toolset.
   *
   * If the answer is 'YES' and if there is an active kit selected that is among the ones to be deleted,
   * then the user must also pick a new kit.
   *
   * @returns if any duplicate vs kits are removed.
   */
  static async scanForKits() {
    log.debug(localize('rescanning.for.kits', 'Rescanning for kits'));

    // Do the scan:
    const discovered_kits = await scanForKits({minGWSearchDirs: KitsController.minGWSearchDirs});

    // The list with the new definition user kits starts with the non VS ones,
    // which do not have any variations in the way they can be defined.
    const new_definition_user_kits = KitsController.userKits.filter(kit => !!!kit.visualStudio);

    // The VS kits saved so far in cmake-tools-kits.json
    const user_vs_kits = KitsController.userKits.filter(kit => !!kit.visualStudio);

    // Separate the VS kits based on old/new definition.
    const old_definition_vs_kits = [];
    user_vs_kits.forEach(kit => {
      if (kit.visualStudio && (kit.visualStudio.startsWith("VisualStudio.15") || kit.visualStudio.startsWith("VisualStudio.16"))) {
        old_definition_vs_kits.push(kit);
      } else {
        // The new definition VS kits can complete the final user kits list
        new_definition_user_kits.push(kit);
      }
    });

    let duplicateRemoved: boolean = false;
    if (old_definition_vs_kits.length > 1) {
      log.info(localize('found.duplicate.kits', 'Found Visual Studio kits with the old ids saved in the cmake-tools-kits.json.'));
      const yesButtonTitle: string = localize('yes.button', 'Yes');
      const chosen = await vscode.window.showInformationMessage<vscode.MessageItem>(
        localize('delete.duplicate.kits', 'Would you like to delete the duplicate Visual Studio kits from cmake-tools-kits.json?'),
        {
          title: yesButtonTitle,
          isCloseAffordance: true,
        },
        {
          title: localize('no.button', 'No'),
          isCloseAffordance: true,
        });

      if (chosen !== undefined && (chosen.title === yesButtonTitle)) {
        KitsController.userKits = new_definition_user_kits;
        duplicateRemoved = true;
      }
    }

    // Convert the kits into a by-name mapping so that we can restore the ones
    // we know about after the fact.
    // We only save the user-local kits: We don't want to save workspace kits
    // in the user kits file.
    const old_kits_by_name = KitsController.userKits.reduce(
      (acc, kit) => ({...acc, [kit.name]: kit}),
      {} as {[kit: string]: Kit},
    );

    // Update the new kits we know about.
    const new_kits_by_name = discovered_kits.reduce(
      (acc, kit) => ({...acc, [kit.name]: kit}),
      old_kits_by_name,
    );

    const new_kits = Object.keys(new_kits_by_name).map(k => new_kits_by_name[k]);
    KitsController.userKits = new_kits;
    await KitsController._writeUserKitsFile(new_kits);

    KitsController._startPruneOutdatedKitsAsync();

    return duplicateRemoved;
  }
}
/**
 * Module for the legacy driver. Talks to pre-CMake Server versions of CMake.
 * Can also talk to newer versions of CMake via the command line.
 */ /** */

 import {CMakeExecutable} from '@cmt/cmake/cmake-executable';
 import * as vscode from 'vscode';
 import * as path from 'path';

 import * as api from '@cmt/api';
 import * as cache from '@cmt/cache';
 import {CMakeDriver, CMakePreconditionProblemSolver} from '@cmt/drivers/driver';
 import {Kit, CMakeGenerator} from '@cmt/kit';
 import * as logging from '@cmt/logging';
 import {fs} from '@cmt/pr';
 import * as proc from '@cmt/proc';
 import rollbar from '@cmt/rollbar';
 import * as util from '@cmt/util';
 import { ConfigurationReader } from '@cmt/config';
 import { ExecutableTarget } from '@cmt/api';
 import * as index_api from '@cmt/drivers/cmakefileapi/api';
 import { Exception } from 'handlebars';

 const log = logging.createLogger('cmakefileapi-driver');

 /**
  * The legacy driver.
  */
 export class CMakeFileApiDriver extends CMakeDriver {
   private constructor(cmake: CMakeExecutable, readonly config: ConfigurationReader, workspaceRootPath: string | null, preconditionHandler: CMakePreconditionProblemSolver) {
     super(cmake, config, workspaceRootPath, preconditionHandler);
   }

   private _needsReconfigure = true;
   private _cache : Map<string, api.CacheEntry> = new Map<string, api.CacheEntry>();
   private _generatorInformation : index_api.Index.GeneratorInformation | null = null;
   doConfigureSettingsChange() { this._needsReconfigure = true; }
   async checkNeedsReconfigure(): Promise<boolean> { return this._needsReconfigure; }

   async doSetKit(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
     this._needsReconfigure = true;
     if (need_clean) {
       await this._cleanPriorConfiguration();
     }
     await cb();
   }

   // Legacy disposal does nothing
   async asyncDispose() { this._cacheWatcher.dispose(); }

   async doConfigure(args_: string[], outputConsumer?: proc.OutputConsumer): Promise<number> {
     // Dup args so we can modify them
     const args = Array.from(args_);
     args.push('-H' + util.lightNormalizePath(this.sourceDir));
     const bindir = util.lightNormalizePath(this.binaryDir);
     args.push('-B' + bindir);
     const gen = this.generator;
     if (gen) {
       args.push(`-G${gen.name}`);
       if (gen.toolset) {
         args.push(`-T${gen.toolset}`);
       }
       if (gen.platform) {
         args.push(`-A${gen.platform}`);
       }
     }
     const cmake = this.cmake.path;
     log.debug('Invoking CMake', cmake, 'with arguments', JSON.stringify(args));
     const env = await this.getConfigureEnvironment();
     const res = await this.executeCommand(cmake, args, outputConsumer, {environment: env}).result;
     log.trace(res.stderr);
     log.trace(res.stdout);
     if (res.retc == 0) {
       this._needsReconfigure = false;
     }
     await this._reloadPostConfigure();
     return res.retc === null ? -1 : res.retc;
   }

   protected async createQueryFileForApi() : Promise<string> {
      const api_path = this.getCMakeFileApiPath();
      const query_path = path.join(api_path, "query", "client-vscode");
      const query_file_path = path.join(query_path, "query.json");
      await fs.mkdir_p(query_path);

      const requests = {
        requests: [
          { kind: "cache", version: 2},
          { kind: "codemodel", version: 2},
          { kind: "cmakeFiles", version: 1}
        ]
      };

      await fs.writeFile(query_file_path, JSON.stringify(requests));

      return query_file_path;
   }

   private getCMakeFileApiPath() {
     return path.join(this.binaryDir, '.cmake', "api", "v1");
   }

   protected async doPreCleanConfigure(): Promise<void> {
    await this.createQueryFileForApi();

    await this._cleanPriorConfiguration();
   }

   async doPostBuild(): Promise<boolean> {
     await this._reloadPostConfigure();
     return true;
   }

   async doInit() {
     if (await fs.exists(this.cachePath)) {
       await this._reloadPostConfigure();
     }
     this._cacheWatcher.onDidChange(() => {
       log.debug(`Reload CMake cache: ${this.cachePath} changed`);
       rollbar.invokeAsync('Reloading CMake Cache', () => this._reloadPostConfigure());
     });
   }

   static async create(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit|null, workspaceRootPath: string | null, preconditionHandler: CMakePreconditionProblemSolver, preferedGenerators: CMakeGenerator[]): Promise<CMakeFileApiDriver> {
     log.debug('Creating instance of CMakeFileApiDriver');
     return this.createDerived(new CMakeFileApiDriver(cmake, config, workspaceRootPath, preconditionHandler), kit, preferedGenerators);
   }

   /**
    * Watcher for the CMake cache file on disk.
    */
   private readonly _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

   private async loadIndex(reply_path: string) : Promise<index_api.Index.IndexFile> {
    log.debug(`Read reply folder: ${reply_path}`);
    const files = await fs.readdir(path.join(reply_path));
    log.debug(`Found index files: ${JSON.stringify(files)}`);

    const index_file = files.find(filename =>filename.startsWith("index-"));
    if (!index_file) {
      throw Exception("Unexpected count of index files");
    }
    const index_file_path = path.join(reply_path, index_file);
    const file_content = await fs.readFile(index_file_path);

    return JSON.parse(file_content.toString()) as index_api.Index.IndexFile;
   }

   private async loadCacheContent(filename: string) : Promise<Map<string, api.CacheEntry>> {
    const file_content = await fs.readFile(filename);
    const cache_from_cmake = JSON.parse(file_content.toString()) as index_api.Cache.CacheContent;

    const cache_internal = cache_from_cmake.entries.reduce((acc, el) => {
      const entry_type_translation_map: {[key: string]: api.CacheEntryType|undefined} = {
        BOOL: api.CacheEntryType.Bool,
        STRING: api.CacheEntryType.String,
        PATH: api.CacheEntryType.Path,
        FILEPATH: api.CacheEntryType.FilePath,
        INTERNAL: api.CacheEntryType.Internal,
        UNINITIALIZED: api.CacheEntryType.Uninitialized,
        STATIC: api.CacheEntryType.Static,
      };
      const type = entry_type_translation_map[el.type];
      if (type === undefined) {
        rollbar.error(`Unknown cache entry type ${el.type}`);
        return acc;
      }
      const helpstring = this.findPropertyValue(el, 'HELPSTRING');
      const advanced = this.findPropertyValue(el, 'ADVANCED');
      acc.set(el.name,
              new cache.Entry(el.name, el.value, type, helpstring, advanced === '1'));
      return acc;
    }, new Map<string, api.CacheEntry>());

    return cache_internal;
   }

   private findPropertyValue(cacheElement: index_api.Cache.CMakeCacheEntry, name: string): string {
     const property_element = cacheElement.properties.find(prop => prop.name == name);
     return property_element ? property_element.value : '';
   }

   private async _reloadPostConfigure() {
    const api_path = this.getCMakeFileApiPath();
    const reply_path = path.join(api_path, "reply");
     const indexFile = await this.loadIndex(reply_path);
    this._generatorInformation = indexFile.cmake.generator;

     const cache_obj = indexFile.objects.find((value: index_api.Index.ObjectKind) => value.kind === "cache");
     if(!cache_obj) {
       throw Exception("No cache object found");
     }

     this._cache = await this.loadCacheContent(path.join(reply_path, cache_obj.jsonFile));
   }

   get cmakeCacheEntries() : Map<string, api.CacheEntryProperties> {
     return this._cache;
   }

   get generatorName(): string|null {
     return this._generatorInformation? this._generatorInformation.name : null;
   }

   get targets() { return []; }

   get executableTargets(): ExecutableTarget[] {
      return [];
  }
 }

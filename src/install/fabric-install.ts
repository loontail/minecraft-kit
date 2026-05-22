import { targetPaths } from "../core/paths";
import type { ResolvedFabricLoader } from "../types/fabric";
import {
  type DownloadAction,
  DownloadCategories,
  InstallActionKinds,
  type WriteVersionJsonAction,
} from "../types/install";
import type { ResolvedMinecraft } from "../types/minecraft";
import type { RuntimeSystem } from "../types/system";
import { planLibraryDownloads } from "./libraries";

/**
 * Plan the Fabric-specific install steps for a resolved Fabric loader: write the profile
 * JSON (becomes `versions/<id>/<id>.json`) and download every Fabric library.
 *
 * @internal
 */
export const planFabricInstall = (input: {
  readonly loader: ResolvedFabricLoader;
  readonly minecraft: ResolvedMinecraft;
  readonly directory: string;
  readonly system: RuntimeSystem;
}): {
  readonly versionJson: WriteVersionJsonAction;
  readonly libraryDownloads: readonly DownloadAction[];
  readonly classpathFiles: readonly string[];
  readonly versionId: string;
} => {
  const versionId = input.loader.profile.id;
  const versionJsonPath = targetPaths.versionJson(input.directory, versionId);
  const versionJson: WriteVersionJsonAction = {
    kind: InstallActionKinds.WRITE_VERSION_JSON,
    path: versionJsonPath,
    content: `${JSON.stringify(input.loader.profile, null, 2)}\n`,
  };
  const plan = planLibraryDownloads({
    libraries: input.loader.profile.libraries,
    directory: input.directory,
    system: input.system,
    versionId: input.minecraft.version,
    category: DownloadCategories.FABRIC_LIBRARY,
  });
  return {
    versionJson,
    libraryDownloads: plan.downloads,
    classpathFiles: plan.classpathFiles,
    versionId,
  };
};

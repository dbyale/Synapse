import type { LocalModel } from '../preload.d';
import type { Profile } from '../types/profile';
import { findInstalledDownload, type DownloadTarget } from './profileCatalog';

export interface ProfileDownloadTargets {
  model: DownloadTarget;
  projector?: DownloadTarget;
}

function lastPathPart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(/[\\/]/).pop() || undefined;
}

function resolveRepoId(profile: Profile): string {
  const explicit = [profile.modelAuthor, profile.modelFolder]
    .filter(Boolean)
    .join('/');
  if (explicit) return explicit;
  const parts = profile.model.split('/');
  parts.pop();
  return parts.join('/');
}

export function getProfileDownloadTargets(
  profile: Profile,
): ProfileDownloadTargets | null {
  const modelFilename =
    lastPathPart(profile.modelFilename) ?? lastPathPart(profile.model);
  if (!modelFilename) return null;
  const repoId = resolveRepoId(profile);
  if (!repoId) return null;

  const model: DownloadTarget = {
    repoId,
    filename: modelFilename,
    url: profile.model,
  };

  if (!profile.projector) return { model };
  const projectorFilename =
    lastPathPart(profile.projectorFilename) ?? lastPathPart(profile.projector);
  if (!projectorFilename) return { model };

  return {
    model,
    projector: {
      repoId,
      filename: projectorFilename,
      url: profile.projector,
    },
  };
}

export function isProfileDownloaded(
  profile: Profile,
  localModels: readonly LocalModel[],
): boolean {
  const targets = getProfileDownloadTargets(profile);
  if (!targets) return false;
  if (!findInstalledDownload(targets.model, localModels)) return false;
  if (
    targets.projector &&
    !findInstalledDownload(targets.projector, localModels)
  ) {
    return false;
  }
  return true;
}

export function isProfileReady(
  profile: Profile,
  localModels: readonly LocalModel[],
  dependenciesReady: boolean,
): boolean {
  return dependenciesReady && isProfileDownloaded(profile, localModels);
}

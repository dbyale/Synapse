import type { Profile } from '../types/profile';
import {
  getProfileDownloads,
  parseDownloadLink,
  type ProfileDownloadLinks,
} from './downloadLinks';

export const SYNPROFILE_FORMAT = 'synprofile';
export const SYNPROFILE_VERSION = 1;
export const SYNPROFILE_EXTENSION = 'synprofile';

export interface SynProfileRecord {
  profile: Profile;
  downloads?: ProfileDownloadLinks;
}

export interface SynProfileCollection {
  format: typeof SYNPROFILE_FORMAT;
  version: typeof SYNPROFILE_VERSION;
  exportedAt?: string;
  profiles: SynProfileRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function isSafeProfilePath(value: string): boolean {
  if (!value || value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) {
    return false;
  }
  if (value.includes('\\') || value.includes('\0')) return false;
  return value
    .split('/')
    .every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function safePath(value: unknown, label: string): string {
  const path = requiredString(value, label);
  if (!isSafeProfilePath(path)) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return path;
}

function lastPathPart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(/[\\/]/).pop() || undefined;
}

function stripRuntimeFields(profile: Profile): Profile {
  const next = { ...profile };
  delete next.estimation;
  delete next.tensorSplit;
  delete next.tensorOverrides;
  delete next.maxForModel;
  delete next.maxLayers;
  delete next.maxContext;
  delete next.allocatedVRAM;
  delete next.allocatedRAM;
  return next;
}

function normalizeDownloads(value: unknown): ProfileDownloadLinks | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new Error('downloads must be an object');
  }

  const downloads: ProfileDownloadLinks = {};
  if (value.model !== undefined) {
    const model = parseDownloadLink(
      requiredString(value.model, 'downloads.model'),
    );
    downloads.model = model.url;
  }
  if (value.projector !== undefined) {
    const projector = parseDownloadLink(
      requiredString(value.projector, 'downloads.projector'),
    );
    if (
      downloads.model &&
      parseDownloadLink(downloads.model).repoId !== projector.repoId
    ) {
      throw new Error(
        'downloads.projector must use the same repository as downloads.model',
      );
    }
    downloads.projector = projector.url;
  }

  if (!downloads.model && !downloads.projector) {
    throw new Error('downloads must include a model or projector link');
  }
  return downloads;
}

function applyModelFields(
  profile: Profile,
  downloads: ProfileDownloadLinks | undefined,
) {
  let modelRepoId: string | undefined;
  if (downloads?.model) {
    const model = parseDownloadLink(downloads.model);
    const [author, ...folderParts] = model.repoId.split('/');
    modelRepoId = model.repoId;
    profile.model = `${model.repoId}/${model.filename}`;
    profile.modelAuthor = author;
    profile.modelFolder = folderParts.join('/');
    profile.modelFilename = lastPathPart(model.filename) ?? model.filename;
  } else {
    const modelPath = safePath(profile.model, 'profile.model');
    const parts = modelPath.split('/');
    const filename = parts.pop() ?? '';
    const author = parts.shift() ?? '';
    modelRepoId = parts.length > 0 ? `${author}/${parts[0]}` : undefined;
    profile.model = modelPath;
    profile.modelAuthor = author;
    profile.modelFolder = parts.join('/');
    profile.modelFilename = filename;
  }

  if (downloads?.projector) {
    const projector = parseDownloadLink(downloads.projector);
    if (modelRepoId && projector.repoId !== modelRepoId) {
      throw new Error(
        'downloads.projector must use the same repository as downloads.model',
      );
    }
    const [author, ...folderParts] = projector.repoId.split('/');
    modelRepoId = projector.repoId;
    const projectorFilename =
      lastPathPart(projector.filename) ?? projector.filename;
    profile.modelAuthor = profile.modelAuthor || author;
    profile.modelFolder = profile.modelFolder || folderParts.join('/');
    profile.projector = `${projector.repoId}/projectors/${projectorFilename}`;
    profile.projectorFilename = projectorFilename;
  } else if (profile.projector) {
    const projectorPath = safePath(profile.projector, 'profile.projector');
    const [projectorAuthor, projectorFolder] = projectorPath.split('/');
    const projectorRepoId = `${projectorAuthor}/${projectorFolder}`;
    if (modelRepoId && projectorRepoId !== modelRepoId) {
      throw new Error(
        'profile.projector must use the same repository as profile.model',
      );
    }
    profile.projector = projectorPath;
    const projectorFilename = lastPathPart(profile.projectorFilename);
    profile.projectorFilename =
      projectorFilename && isSafeProfilePath(projectorFilename)
        ? projectorFilename
        : lastPathPart(projectorPath);
  }

  if (profile.draftModelFilename) {
    const draftPath = `${profile.draftModelAuthor ?? ''}/${profile.draftModelFolder ?? ''}/${profile.draftModelFilename}`;
    if (!isSafeProfilePath(draftPath)) {
      delete profile.draftModelAuthor;
      delete profile.draftModelFolder;
      delete profile.draftModelFilename;
    }
  }
}

function normalizeProfile(
  value: unknown,
  downloads: ProfileDownloadLinks | undefined,
): Profile {
  if (!isRecord(value)) {
    throw new Error('profile must be an object');
  }

  const profile = { ...value } as unknown as Profile;
  profile.id = requiredString(profile.id, 'profile.id');
  profile.name = requiredString(profile.name, 'profile.name');
  profile.systemPrompt =
    typeof profile.systemPrompt === 'string' ? profile.systemPrompt : '';
  if (
    profile.tools !== undefined &&
    (!Array.isArray(profile.tools) ||
      !profile.tools.every((tool) => typeof tool === 'string'))
  ) {
    delete profile.tools;
  }

  applyModelFields(profile, downloads);

  if (!Number.isFinite(profile.order)) {
    profile.order = 0;
  } else {
    profile.order = Math.trunc(profile.order);
  }
  if (!Number.isFinite(profile.createdAt)) {
    profile.createdAt = Date.now();
  } else {
    profile.createdAt = Math.trunc(profile.createdAt);
  }

  return stripRuntimeFields(profile);
}

function recordFromProfile(profile: Profile): SynProfileRecord {
  const cleaned = stripRuntimeFields(profile);
  const downloads = getProfileDownloads(cleaned);
  return {
    profile: cleaned,
    ...(downloads.model || downloads.projector ? { downloads } : {}),
  };
}

export function parseSynProfileCollection(
  input: unknown,
): SynProfileCollection {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('The file is not valid JSON');
    }
  }

  if (!isRecord(value)) {
    throw new Error('The file does not contain a profile collection');
  }
  if (value.format !== SYNPROFILE_FORMAT) {
    throw new Error(`Unsupported profile format: ${String(value.format)}`);
  }
  if (value.version !== SYNPROFILE_VERSION) {
    throw new Error(`Unsupported profile version: ${String(value.version)}`);
  }
  if (!Array.isArray(value.profiles) || value.profiles.length === 0) {
    throw new Error('The profile collection is empty');
  }

  const profiles = value.profiles.map((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.profile)) {
      throw new Error(`Profile ${index + 1} is missing profile data`);
    }
    const downloads = normalizeDownloads(entry.downloads);
    return {
      profile: normalizeProfile(entry.profile, downloads),
      ...(downloads ? { downloads } : {}),
    };
  });

  return {
    format: SYNPROFILE_FORMAT,
    version: SYNPROFILE_VERSION,
    ...(typeof value.exportedAt === 'string'
      ? { exportedAt: value.exportedAt }
      : {}),
    profiles,
  };
}

export function createSynProfileCollection(
  profiles: readonly Profile[],
): SynProfileCollection {
  if (profiles.length === 0) {
    throw new Error('No profiles to export');
  }
  return {
    format: SYNPROFILE_FORMAT,
    version: SYNPROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    profiles: profiles.map(recordFromProfile),
  };
}

export function serializeSynProfileCollection(
  profiles: readonly Profile[],
): string {
  return `${JSON.stringify(createSynProfileCollection(profiles), null, 2)}\n`;
}

export function getImportedProfiles(
  collection: SynProfileCollection,
): Profile[] {
  return collection.profiles.map((record) => record.profile);
}

export function sanitizeProfileFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'profile';
}

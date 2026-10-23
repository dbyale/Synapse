import type { Profile } from '../types/profile';

export interface DownloadTarget {
  repoId: string;
  filename: string;
  url: string;
  sizeBytes?: number;
}

export interface ProfileDownloadLinks {
  model?: string;
  projector?: string;
}

const HUGGING_FACE_RESOLVE_PATTERN =
  /^https:\/\/huggingface\.co\/([^/]+)\/([^/]+)\/resolve\/[^/]+\/(.+)$/;

function isSafeLinkPart(value: string): boolean {
  return (
    value.length > 0 && value !== '.' && value !== '..' && !value.includes('\\')
  );
}

export function parseDownloadLink(
  url: string,
  sizeBytes?: number,
): DownloadTarget {
  const trimmed = url.trim();
  const match = trimmed.match(HUGGING_FACE_RESOLVE_PATTERN);
  if (!match) {
    throw new Error(`Unsupported download link: ${url}`);
  }
  const [, author, repo, filename] = match;
  if (
    !isSafeLinkPart(author) ||
    !isSafeLinkPart(repo) ||
    !filename.split('/').every(isSafeLinkPart)
  ) {
    throw new Error(`Unsafe download link: ${url}`);
  }
  return {
    repoId: `${author}/${repo}`,
    filename,
    url: trimmed,
    sizeBytes,
  };
}

export function getDownloadKey(target: DownloadTarget): string {
  return `${target.repoId}:${target.filename}`;
}

export function buildHuggingFaceLink(repoId: string, filename: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${filename}`;
}

function lastPathPart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(/[\\/]/).pop() || undefined;
}

export function getProfileRepoId(
  profile: Pick<Profile, 'model' | 'modelAuthor' | 'modelFolder'>,
): string | undefined {
  const explicit = [profile.modelAuthor, profile.modelFolder]
    .filter(Boolean)
    .join('/');
  if (explicit) return explicit;
  const parts = profile.model.split('/');
  parts.pop();
  return parts.join('/') || undefined;
}

export function getProfileDownloads(
  profile: Pick<
    Profile,
    | 'model'
    | 'modelAuthor'
    | 'modelFolder'
    | 'modelFilename'
    | 'projector'
    | 'projectorFilename'
  >,
): ProfileDownloadLinks {
  const repoId = getProfileRepoId(profile);
  const modelFilename =
    lastPathPart(profile.modelFilename) ?? lastPathPart(profile.model);
  const downloads: ProfileDownloadLinks = {};
  if (repoId && modelFilename) {
    downloads.model = buildHuggingFaceLink(repoId, modelFilename);
  }
  if (repoId && profile.projector) {
    const projectorFilename =
      lastPathPart(profile.projectorFilename) ??
      lastPathPart(profile.projector);
    if (projectorFilename) {
      downloads.projector = buildHuggingFaceLink(repoId, projectorFilename);
    }
  }
  return downloads;
}

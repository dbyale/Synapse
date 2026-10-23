import type { Profile } from '../types/profile';

export function normalizeProfileName(name: string): string {
  return name.trim().toLowerCase();
}

function getUniqueCopyName(
  name: string,
  existingNames: ReadonlySet<string>,
): string {
  const baseName = `${name.trim()} Copy`;

  if (!existingNames.has(normalizeProfileName(baseName))) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.has(normalizeProfileName(`${baseName} ${suffix}`))) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

export function getDuplicateProfileName(
  name: string,
  profiles: readonly Pick<Profile, 'name'>[],
): string {
  return getUniqueCopyName(
    name,
    new Set(profiles.map((profile) => normalizeProfileName(profile.name))),
  );
}

export function getImportedProfileName(
  name: string,
  existingNames: ReadonlySet<string>,
): string {
  if (!existingNames.has(normalizeProfileName(name))) {
    return name;
  }
  return getUniqueCopyName(name, existingNames);
}

export function getUniqueProfileId(
  preferredId: string,
  existingIds: ReadonlySet<string>,
  now = Date.now(),
): string {
  if (!existingIds.has(preferredId)) {
    return preferredId;
  }

  let id = now.toString();
  let suffix = 1;
  while (existingIds.has(id)) {
    id = `${now}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function createDuplicateProfile(
  source: Profile,
  profiles: readonly Profile[],
  now = Date.now(),
): Profile {
  const existingIds = new Set(profiles.map((profile) => profile.id));
  let id = now.toString();
  let suffix = 1;
  while (existingIds.has(id)) {
    id = `${now}-${suffix}`;
    suffix += 1;
  }

  return {
    ...source,
    id,
    name: getDuplicateProfileName(source.name, profiles),
    createdAt: now,
  };
}

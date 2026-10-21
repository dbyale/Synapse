import type { Profile } from '../types/profile';

export function readStoredProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem('profiles');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (profile): profile is Profile =>
        typeof profile === 'object' && profile !== null,
    );
  } catch {
    return [];
  }
}

export function getCombinedProfiles(incoming: readonly Profile[]): Profile[] {
  const existing = readStoredProfiles();
  const seen = new Set(existing.map((profile) => profile.id));
  const combined = [...existing];
  incoming.forEach((profile) => {
    if (seen.has(profile.id)) return;
    seen.add(profile.id);
    combined.push(profile);
  });
  return combined;
}

export function mergeOnboardingProfiles(
  incoming: readonly Profile[],
): Profile[] {
  const existing = readStoredProfiles();
  const seen = new Set(existing.map((profile) => profile.id));
  let nextOrder = existing.reduce((highest, profile, index) => {
    const order = Number.isFinite(profile.order) ? profile.order : index;
    return Math.max(highest, order);
  }, -1);

  const appended: Profile[] = [];
  incoming.forEach((profile) => {
    if (seen.has(profile.id)) return;
    seen.add(profile.id);
    nextOrder += 1;
    appended.push({ ...profile, order: nextOrder });
  });

  const merged = appended.length > 0 ? [...existing, ...appended] : existing;
  if (appended.length > 0) {
    localStorage.setItem('profiles', JSON.stringify(merged));
  }
  return merged;
}

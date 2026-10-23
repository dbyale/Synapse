import type { LocalModel } from '../preload.d';
import type { Profile } from '../types/profile';
import {
  SETUP_DOWNLOADS_BY_ID,
  SETUP_PROFILES_BY_ID,
  SETUP_PROFILE_MANIFEST,
} from '../../data/setup-profiles';
import {
  getProfileDownloads,
  parseDownloadLink,
  getDownloadKey,
  type DownloadTarget,
} from '../utils/downloadLinks';

export type { DownloadTarget } from '../utils/downloadLinks';
export { getDownloadKey };

export interface OptionDownloadLinks {
  modelName: string;
  model: string;
  mmproj?: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  tier: string;
  profileId: string;
  downloads: OptionDownloadLinks;
}

export interface ProfileCategory {
  id: string;
  name: string;
  description: string;
  options: CategoryOption[];
}

export interface OptionDownload extends DownloadTarget {
  categoryId: string;
  categoryName: string;
  optionId: string;
  optionName: string;
  kind: 'model' | 'mmproj';
}

export interface SelectedCategoryOption {
  category: ProfileCategory;
  option: CategoryOption;
}

export interface DownloadGroupCategory {
  categoryId: string;
  categoryName: string;
}

export interface DownloadGroupOption {
  optionId: string;
  optionName: string;
  categoryId: string;
  categoryName: string;
}

export interface DownloadGroup {
  id: string;
  modelName: string;
  model: DownloadTarget;
  projector?: DownloadTarget;
  categories: DownloadGroupCategory[];
  options: DownloadGroupOption[];
}

export interface OnboardingProfileSelection {
  professionIds: string[];
  optionIds: string[];
  profiles: Profile[];
}

export const ONBOARDING_SELECTION_KEY = 'onboardingProfileSelection';

export const PROFESSION_CATEGORY_IDS: Record<string, string[]> =
  SETUP_PROFILE_MANIFEST.professions;

function buildCategories(): ProfileCategory[] {
  return SETUP_PROFILE_MANIFEST.categories.map((category) => {
    const options = category.options.map((option) => {
      const profile = SETUP_PROFILES_BY_ID.get(option.profileId);
      if (!profile) {
        throw new Error(
          `Setup profile "${option.profileId}" is missing from the bundled collection`,
        );
      }
      const links =
        SETUP_DOWNLOADS_BY_ID.get(option.profileId) ??
        getProfileDownloads(profile);
      if (!links.model) {
        throw new Error(
          `Setup profile "${option.profileId}" has no model download link`,
        );
      }
      return {
        id: option.id,
        name: option.name,
        description: option.description,
        ...(option.recommended ? { recommended: true } : {}),
        tier: option.tier,
        profileId: option.profileId,
        downloads: {
          modelName: option.modelName,
          model: links.model,
          ...(links.projector ? { mmproj: links.projector } : {}),
        },
      };
    });

    return {
      id: category.id,
      name: category.name,
      description: category.description,
      options,
    };
  });
}

export const PROFILE_CATEGORIES: ProfileCategory[] = buildCategories();

export function getOptionDownloads(option: CategoryOption): DownloadTarget[] {
  const downloads = [parseDownloadLink(option.downloads.model)];
  if (option.downloads.mmproj?.trim()) {
    downloads.push(parseDownloadLink(option.downloads.mmproj));
  }
  return downloads;
}

export function getCategoriesForProfessions(
  professionIds: readonly string[],
): ProfileCategory[] {
  const categoryIds = new Set<string>();
  professionIds.forEach((professionId) => {
    (PROFESSION_CATEGORY_IDS[professionId] ?? []).forEach((categoryId) => {
      categoryIds.add(categoryId);
    });
  });
  return PROFILE_CATEGORIES.filter((category) => categoryIds.has(category.id));
}

export function getCategoriesForSelection(
  professionIds: readonly string[],
): ProfileCategory[] {
  return professionIds.length === 0
    ? PROFILE_CATEGORIES
    : getCategoriesForProfessions(professionIds);
}

export function getSelectedOptions(
  optionIds: readonly string[],
): SelectedCategoryOption[] {
  const selectedIds = new Set(optionIds);
  return PROFILE_CATEGORIES.flatMap((category) =>
    category.options
      .filter((option) => selectedIds.has(option.id))
      .map((option) => ({ category, option })),
  );
}

export function getUniqueDownloads(
  optionIds: readonly string[],
): OptionDownload[] {
  const downloads = new Map<string, OptionDownload>();

  getSelectedOptions(optionIds).forEach(({ category, option }) => {
    getOptionDownloads(option).forEach((target, index) => {
      const key = getDownloadKey(target);
      if (downloads.has(key)) return;
      downloads.set(key, {
        ...target,
        categoryId: category.id,
        categoryName: category.name,
        optionId: option.id,
        optionName: option.name,
        kind: index === 0 ? 'model' : 'mmproj',
      });
    });
  });

  return Array.from(downloads.values());
}

export function getDownloadGroups(
  optionIds: readonly string[],
): DownloadGroup[] {
  const groups = new Map<string, DownloadGroup>();

  getSelectedOptions(optionIds).forEach(({ category, option }) => {
    const model = parseDownloadLink(option.downloads.model);
    const key = getDownloadKey(model);
    let group = groups.get(key);

    if (!group) {
      group = {
        id: key,
        modelName: option.downloads.modelName,
        model,
        categories: [],
        options: [],
      };
      groups.set(key, group);
    }

    if (!group.categories.some((entry) => entry.categoryId === category.id)) {
      group.categories.push({
        categoryId: category.id,
        categoryName: category.name,
      });
    }

    group.options.push({
      optionId: option.id,
      optionName: option.name,
      categoryId: category.id,
      categoryName: category.name,
    });

    if (option.downloads.mmproj?.trim() && !group.projector) {
      group.projector = parseDownloadLink(option.downloads.mmproj);
    }
  });

  return Array.from(groups.values());
}

export function findInstalledDownload(
  target: DownloadTarget,
  localModels: readonly Pick<
    LocalModel,
    'filename' | 'generalName' | 'sizeBytes'
  >[],
): Pick<LocalModel, 'filename' | 'generalName' | 'sizeBytes'> | undefined {
  return localModels.find(
    (model) =>
      model.filename === target.filename && model.generalName === target.repoId,
  );
}

export function isDownloadInstalled(
  target: DownloadTarget,
  localModels: Pick<LocalModel, 'filename' | 'generalName' | 'sizeBytes'>[],
): boolean {
  return findInstalledDownload(target, localModels) !== undefined;
}

export function buildProfile(option: CategoryOption, order = 0): Profile {
  const template = SETUP_PROFILES_BY_ID.get(option.profileId);
  if (!template) {
    throw new Error(`Setup profile "${option.profileId}" is not bundled`);
  }
  return {
    ...template,
    order,
    createdAt: Date.now(),
  };
}

export function buildSelection(
  professionIds: readonly string[],
  optionIds: readonly string[],
): OnboardingProfileSelection {
  let order = 0;
  const profiles = getSelectedOptions(optionIds).map(({ option }) => {
    const built = buildProfile(option, order);
    order += 1;
    return built;
  });

  return {
    professionIds: [...professionIds],
    optionIds: [...optionIds],
    profiles,
  };
}

export function writeOnboardingProfileSelection(
  selection: OnboardingProfileSelection,
): void {
  localStorage.setItem(ONBOARDING_SELECTION_KEY, JSON.stringify(selection));
}

export function readOnboardingProfileSelection(): OnboardingProfileSelection | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      professionIds?: unknown;
      optionIds?: unknown;
      profileIds?: unknown;
      profiles?: unknown;
    };
    const optionIds = Array.isArray(parsed.optionIds)
      ? parsed.optionIds
      : parsed.profileIds;
    if (
      !Array.isArray(parsed.professionIds) ||
      !Array.isArray(optionIds) ||
      !Array.isArray(parsed.profiles)
    ) {
      return null;
    }
    return {
      professionIds: parsed.professionIds.filter(
        (id): id is string => typeof id === 'string',
      ),
      optionIds: optionIds.filter((id): id is string => typeof id === 'string'),
      profiles: parsed.profiles as Profile[],
    };
  } catch {
    return null;
  }
}

export function clearOnboardingProfileSelection(): void {
  localStorage.removeItem(ONBOARDING_SELECTION_KEY);
}

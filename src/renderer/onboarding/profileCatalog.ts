import type { Profile } from '../types/profile';
import type { LocalModel } from '../preload.d';

export interface DownloadTarget {
  repoId: string;
  filename: string;
  url: string;
  sizeBytes?: number;
}

export interface OptionDownloadLinks {
  modelName: string;
  model: string;
  modelSizeBytes: number;
  mmproj?: string;
  mmprojSizeBytes?: number;
}

export interface CategoryOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  downloads: OptionDownloadLinks;
  settings?: Partial<Profile>;
}

export interface ProfileCategory {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
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
  modelSizeBytes: number;
  projectorSizeBytes: number;
  totalBytes: number;
  categories: DownloadGroupCategory[];
  options: DownloadGroupOption[];
}

export interface OnboardingProfileSelection {
  professionIds: string[];
  optionIds: string[];
  profiles: Profile[];
}

export const ONBOARDING_SELECTION_KEY = 'onboardingProfileSelection';

const HUGGING_FACE_RESOLVE_PATTERN =
  /^https:\/\/huggingface\.co\/([^/]+)\/([^/]+)\/resolve\/[^/]+\/(.+)$/;

export const PROFESSION_CATEGORY_IDS: Record<string, string[]> = {
  qa: ['everyday-assistant'],
  translation: ['translator'],
  business: ['business-assistant'],
  writing: ['writing-assistant'],
  education: ['tutor'],
  research: ['research-assistant'],
  development: ['code-assistant'],
};

const MODEL_LINKS = {
  lightweight: {
    modelName: 'Qwen3.5 0.8B',
    modelSizeBytes: 532517120,
    model:
      'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
    mmproj:
      'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/mmproj-F16.gguf',
    mmprojSizeBytes: 204987232,
  },
  lightweightText: {
    modelName: 'Qwen3.5 0.8B',
    modelSizeBytes: 532517120,
    model:
      'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
  },
  balanced: {
    modelName: 'Gemma 4 26B A4B',
    modelSizeBytes: 16947541728,
    model:
      'https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf',
    mmproj:
      'https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/mmproj-F16.gguf',
    mmprojSizeBytes: 1193058784,
  },
  highQuality: {
    modelName: 'Qwen3.5 35B A3B',
    modelSizeBytes: 22241950336,
    model:
      'https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf',
    mmproj:
      'https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/mmproj-F16.gguf',
    mmprojSizeBytes: 899283648,
  },
  highQualityText: {
    modelName: 'Qwen3.5 35B A3B',
    modelSizeBytes: 22241950336,
    model:
      'https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf',
  },
  coding: {
    modelName: 'Qwen3 Coder 30B A3B Instruct',
    modelSizeBytes: 18556689568,
    model:
      'https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf',
  },
} satisfies Record<string, OptionDownloadLinks>;

const LIGHT_SETTINGS: Partial<Profile> = {
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  contextSize: 8192,
  mmprojOffload: true,
};

const BALANCED_SETTINGS: Partial<Profile> = {
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  contextSize: 8192,
  mmprojOffload: true,
};

const HIGH_QUALITY_SETTINGS: Partial<Profile> = {
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  contextSize: 16384,
  mmprojOffload: true,
};

const CODING_LIGHT_SETTINGS: Partial<Profile> = {
  temperature: 0.3,
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  contextSize: 8192,
};

const CODING_SETTINGS: Partial<Profile> = {
  temperature: 0.2,
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  contextSize: 16384,
};

function standardOptions(
  categoryId: string,
  temperature: number,
): CategoryOption[] {
  return [
    {
      id: `${categoryId}-light`,
      name: 'Light & fast',
      description:
        'Runs well on most laptops. Fastest responses for simpler tasks.',
      downloads: MODEL_LINKS.lightweight,
      settings: { ...LIGHT_SETTINGS, temperature },
    },
    {
      id: `${categoryId}-balanced`,
      name: 'Balanced',
      description:
        'Recommended for most systems. A strong balance of quality and speed.',
      recommended: true,
      downloads: MODEL_LINKS.balanced,
      settings: { ...BALANCED_SETTINGS, temperature },
    },
    {
      id: `${categoryId}-quality`,
      name: 'Best quality',
      description:
        'Best for complex work. Needs more memory and may respond more slowly.',
      downloads: MODEL_LINKS.highQuality,
      settings: { ...HIGH_QUALITY_SETTINGS, temperature },
    },
  ];
}

function codingOptions(categoryId: string): CategoryOption[] {
  return [
    {
      id: `${categoryId}-light`,
      name: 'Light & fast',
      description:
        'Runs well on most laptops. Best for quick snippets and simple fixes.',
      downloads: MODEL_LINKS.lightweightText,
      settings: CODING_LIGHT_SETTINGS,
    },
    {
      id: `${categoryId}-coding`,
      name: 'Coding focused',
      description:
        'Built for development work. Recommended for most coding tasks.',
      recommended: true,
      downloads: MODEL_LINKS.coding,
      settings: CODING_SETTINGS,
    },
    {
      id: `${categoryId}-quality`,
      name: 'Best quality',
      description:
        'Best for complex reasoning and large codebases. Needs more memory.',
      downloads: MODEL_LINKS.highQualityText,
      settings: { ...CODING_SETTINGS, contextSize: 16384 },
    },
  ];
}

export const PROFILE_CATEGORIES: ProfileCategory[] = [
  {
    id: 'everyday-assistant',
    name: 'Everyday Assistant',
    description: 'Quick answers, explanations, and help with daily tasks.',
    systemPrompt:
      'You are a concise, practical assistant. Answer directly, explain unfamiliar terms, and ask a brief clarifying question only when the request is ambiguous.',
    options: standardOptions('everyday-assistant', 0.6),
  },
  {
    id: 'translator',
    name: 'Translator',
    description:
      'Natural translation with notes on tone, nuance, and ambiguity.',
    systemPrompt:
      "You are a precise translator. Translate the user's text naturally while preserving meaning, tone, and formatting. If the target language is unclear, translate to English and note the assumption.",
    options: standardOptions('translator', 0.2),
  },
  {
    id: 'business-assistant',
    name: 'Business Assistant',
    description: 'Planning, summaries, and recommendations for work.',
    systemPrompt:
      'You are a business analyst. Structure recommendations around goals, constraints, risks, and next steps. Use plain language and call out assumptions.',
    options: standardOptions('business-assistant', 0.4),
  },
  {
    id: 'writing-assistant',
    name: 'Writing Assistant',
    description:
      'Drafting, editing, and polishing everything from emails to long documents.',
    systemPrompt:
      "You are an experienced editor and writing partner. Improve clarity, structure, and flow while preserving the author's voice. Flag factual claims that need verification.",
    options: standardOptions('writing-assistant', 0.7),
  },
  {
    id: 'tutor',
    name: 'Tutor',
    description: 'Lessons, explanations, and study support for any subject.',
    systemPrompt:
      'You are an instructional designer. Build lessons and explanations around clear objectives, worked examples, checks for understanding, and accessible language.',
    options: standardOptions('tutor', 0.6),
  },
  {
    id: 'research-assistant',
    name: 'Research Assistant',
    description: 'Summarize sources, compare ideas, and identify gaps.',
    systemPrompt:
      'You are a careful research assistant. Separate facts from interpretation, summarize sources accurately, and identify gaps or follow-up questions.',
    options: standardOptions('research-assistant', 0.5),
  },
  {
    id: 'code-assistant',
    name: 'Code Assistant',
    description: 'Write, review, and debug code.',
    systemPrompt:
      'You are a pragmatic software engineer. Produce complete, idiomatic code, explain important tradeoffs, review for correctness and security, and avoid inventing APIs or dependencies.',
    options: codingOptions('code-assistant'),
  },
];

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

export function getOptionDownloads(option: CategoryOption): DownloadTarget[] {
  const downloads = [
    parseDownloadLink(option.downloads.model, option.downloads.modelSizeBytes),
  ];
  if (option.downloads.mmproj?.trim()) {
    downloads.push(
      parseDownloadLink(
        option.downloads.mmproj,
        option.downloads.mmprojSizeBytes,
      ),
    );
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
    const model = parseDownloadLink(
      option.downloads.model,
      option.downloads.modelSizeBytes,
    );
    const key = getDownloadKey(model);
    let group = groups.get(key);

    if (!group) {
      group = {
        id: key,
        modelName: option.downloads.modelName,
        model,
        modelSizeBytes: option.downloads.modelSizeBytes,
        projectorSizeBytes: 0,
        totalBytes: option.downloads.modelSizeBytes,
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
      group.projector = parseDownloadLink(
        option.downloads.mmproj,
        option.downloads.mmprojSizeBytes,
      );
      group.projectorSizeBytes = option.downloads.mmprojSizeBytes ?? 0;
      group.totalBytes += group.projectorSizeBytes;
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

export function buildProfile(
  category: ProfileCategory,
  option: CategoryOption,
  order = 0,
): Profile {
  const model = parseDownloadLink(option.downloads.model);
  const mmproj = option.downloads.mmproj?.trim()
    ? parseDownloadLink(option.downloads.mmproj)
    : null;
  const [modelAuthor, ...modelFolderParts] = model.repoId.split('/');
  const modelFolder = modelFolderParts.join('/');
  const modelFilename = model.filename.split('/').pop() ?? model.filename;
  const projectorFilename = mmproj
    ? (mmproj.filename.split('/').pop() ?? mmproj.filename)
    : undefined;

  return {
    order,
    createdAt: Date.now(),
    autoOptimizer: 'synapse',
    gpuLayersAuto: true,
    ...option.settings,
    id: `curated-${category.id}-${option.id}`,
    name: `${category.name} · ${option.name}`,
    model: `${model.repoId}/${model.filename}`,
    projector: mmproj
      ? `${mmproj.repoId}/projectors/${projectorFilename}`
      : undefined,
    modelAuthor,
    modelFolder,
    modelFilename,
    projectorFilename,
    systemPrompt: category.systemPrompt,
  };
}

export function buildSelection(
  professionIds: readonly string[],
  optionIds: readonly string[],
): OnboardingProfileSelection {
  let order = 0;
  const profiles = getSelectedOptions(optionIds).map(({ category, option }) => {
    const built = buildProfile(category, option, order);
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

import type { Profile } from '../renderer/types/profile';
import {
  createSynProfileCollection,
  getImportedProfiles,
  parseSynProfileCollection,
  serializeSynProfileCollection,
} from '../renderer/utils/synprofile';
import { SETUP_PROFILES, SETUP_PROFILE_MANIFEST } from '../data/setup-profiles';
import {
  PROFILE_CATEGORIES,
  PROFESSION_CATEGORY_IDS,
  buildProfile,
  getCategoriesForProfessions,
  getDownloadGroups,
  getDownloadKey,
} from '../renderer/onboarding/profileCatalog';
import { resolveDownloadSizes } from '../renderer/onboarding/downloadSizes';

const baseProfile: Profile = {
  id: 'test-profile',
  name: 'Test Profile',
  model: 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf',
  modelAuthor: 'unsloth',
  modelFolder: 'Qwen3.5-0.8B-GGUF',
  modelFilename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
  systemPrompt: 'Be helpful.',
  order: 0,
  createdAt: 1700000000000,
};

describe('synprofile collections', () => {
  it('exports download links and strips machine-specific runtime fields', () => {
    const collection = createSynProfileCollection([
      {
        ...baseProfile,
        estimation: {
          modelVramUsage: 1,
          contextVramUsage: 1,
          computeOverheadVram: 1,
          modelRamUsage: 1,
          contextRamUsage: 1,
          computeOverheadRam: 1,
          fileBufferRam: 1,
          projectorSkipped: false,
        },
        tensorSplit: '1,1',
        tensorOverrides: 'blk.0=cpu',
        maxLayers: 32,
        maxContext: 8192,
        maxForModel: 'test',
        allocatedVRAM: 1,
        allocatedRAM: 1,
      },
    ]);

    const record = collection.profiles[0];
    expect(record.downloads?.model).toBe(
      'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
    );
    expect(record.profile).not.toHaveProperty('estimation');
    expect(record.profile).not.toHaveProperty('tensorSplit');
    expect(record.profile).not.toHaveProperty('allocatedRAM');
  });

  it('derives model and projector fields from download links on import', () => {
    const parsed = parseSynProfileCollection(
      JSON.stringify({
        format: 'synprofile',
        version: 1,
        profiles: [
          {
            profile: {
              id: 'imported',
              name: 'Imported',
              systemPrompt: '',
              order: 2,
              createdAt: 1700000000000,
            },
            downloads: {
              model:
                'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
              projector:
                'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/mmproj-F16.gguf',
            },
          },
        ],
      }),
    );

    const [profile] = getImportedProfiles(parsed);
    expect(profile.model).toBe(
      'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf',
    );
    expect(profile.modelFilename).toBe('Qwen3.5-0.8B-Q4_K_M.gguf');
    expect(profile.projector).toBe(
      'unsloth/Qwen3.5-0.8B-GGUF/projectors/mmproj-F16.gguf',
    );
    expect(profile.projectorFilename).toBe('mmproj-F16.gguf');
  });

  it('round-trips an exported collection', () => {
    const serialized = serializeSynProfileCollection([baseProfile]);
    const imported = parseSynProfileCollection(serialized);
    expect(getImportedProfiles(imported)).toEqual([baseProfile]);
  });

  it('rejects unsupported formats, empty collections, and unsafe paths', () => {
    expect(() =>
      parseSynProfileCollection({
        format: 'other',
        version: 1,
        profiles: [{ profile: baseProfile }],
      }),
    ).toThrow('Unsupported profile format');
    expect(() =>
      parseSynProfileCollection({
        format: 'synprofile',
        version: 1,
        profiles: [],
      }),
    ).toThrow('empty');
    expect(() =>
      parseSynProfileCollection({
        format: 'synprofile',
        version: 1,
        profiles: [
          {
            profile: { ...baseProfile, model: '../model.gguf' },
          },
        ],
      }),
    ).toThrow('safe relative path');
    expect(() =>
      parseSynProfileCollection({
        format: 'synprofile',
        version: 1,
        profiles: [
          {
            profile: baseProfile,
            downloads: {
              model: 'https://example.com/model.gguf',
            },
          },
        ],
      }),
    ).toThrow('Unsupported download link');
    expect(() =>
      parseSynProfileCollection({
        format: 'synprofile',
        version: 1,
        profiles: [
          {
            profile: baseProfile,
            downloads: {
              model: 'https://huggingface.co/../repo/resolve/main/model.gguf',
            },
          },
        ],
      }),
    ).toThrow('Unsafe download link');
    expect(() =>
      parseSynProfileCollection({
        format: 'synprofile',
        version: 1,
        profiles: [
          {
            profile: {
              ...baseProfile,
              projector: 'other/repo/projectors/mmproj-F16.gguf',
              projectorFilename: 'mmproj-F16.gguf',
            },
            downloads: {
              model:
                'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
            },
          },
        ],
      }),
    ).toThrow('same repository');
  });
});

describe('bundled setup profiles', () => {
  it('loads one general category from the two bundled profiles', () => {
    const optionProfileIds = SETUP_PROFILE_MANIFEST.categories.flatMap(
      (category) => category.options.map((option) => option.profileId),
    );
    const profileIds = SETUP_PROFILES.map((profile) => profile.id);

    expect(SETUP_PROFILE_MANIFEST.categories).toHaveLength(1);
    expect(SETUP_PROFILE_MANIFEST.categories[0].id).toBe('general-chatbot');
    expect(profileIds).toHaveLength(2);
    expect(new Set(profileIds).size).toBe(profileIds.length);
    expect(optionProfileIds).toHaveLength(2);
    expect(optionProfileIds.every((id) => profileIds.includes(id))).toBe(true);
  });

  it('maps every profession to the general category', () => {
    expect(Object.keys(PROFESSION_CATEGORY_IDS)).toHaveLength(7);
    Object.keys(PROFESSION_CATEGORY_IDS).forEach((professionId) => {
      const categories = getCategoriesForProfessions([professionId]);
      expect(categories.map((category) => category.id)).toEqual([
        'general-chatbot',
      ]);
    });
  });

  it('builds download groups without bundled byte sizes', () => {
    const optionIds = PROFILE_CATEGORIES.flatMap((category) =>
      category.options.map((option) => option.id),
    );
    const groups = getDownloadGroups(optionIds);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.projector)).toBe(true);
    expect(groups[0]).not.toHaveProperty('modelSizeBytes');
  });

  it('keeps each setup option on its own system prompt', () => {
    const [category] = PROFILE_CATEGORIES;
    const prompts = category.options.map(
      (option) => buildProfile(option).systemPrompt,
    );

    expect(prompts.every((prompt) => prompt.length > 0)).toBe(true);
    expect(new Set(prompts).size).toBe(prompts.length);
  });
});

describe('download size resolution', () => {
  it('reads sizes from the HuggingFace file list and caches them', async () => {
    const listModelFiles = jest.fn().mockResolvedValue([
      {
        filename: 'model.gguf',
        sizeBytes: 12345,
        quantization: 'Q4_K_M',
        bits: 4,
      },
    ]);
    window.electronAPI = {
      listModelFiles,
    } as unknown as typeof window.electronAPI;

    const target = {
      repoId: 'test/size-cache',
      filename: 'model.gguf',
      url: 'https://huggingface.co/test/size-cache/resolve/main/model.gguf',
    };
    const sizes = await resolveDownloadSizes([target]);
    expect(sizes.get(getDownloadKey(target))).toBe(12345);

    listModelFiles.mockClear();
    const cached = await resolveDownloadSizes([target]);
    expect(cached.get(getDownloadKey(target))).toBe(12345);
    expect(listModelFiles).not.toHaveBeenCalled();
  });
});

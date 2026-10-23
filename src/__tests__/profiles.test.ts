import type { Profile } from '../renderer/types/profile';
import {
  createDuplicateProfile,
  getDuplicateProfileName,
  getImportedProfileName,
  getUniqueProfileId,
  normalizeProfileName,
} from '../renderer/utils/profiles';

const baseProfile: Profile = {
  id: 'source',
  name: 'Test Profile',
  model: 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf',
  modelAuthor: 'unsloth',
  modelFolder: 'Qwen3.5-0.8B-GGUF',
  modelFilename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
  systemPrompt: 'Be helpful.',
  order: 0,
  createdAt: 1700000000000,
};

describe('profile duplication', () => {
  it('normalizes names for duplicate matching', () => {
    expect(normalizeProfileName('  Test Profile  ')).toBe('test profile');
  });

  it('adds a copy suffix and increments it for existing names', () => {
    expect(getDuplicateProfileName('Test Profile', [baseProfile])).toBe(
      'Test Profile Copy',
    );
    expect(
      getDuplicateProfileName('Test Profile', [
        baseProfile,
        { name: '  test profile copy ' },
      ]),
    ).toBe('Test Profile Copy 2');
    expect(
      getDuplicateProfileName('Test Profile', [
        baseProfile,
        { name: 'Test Profile Copy' },
        { name: 'test profile copy 2' },
      ]),
    ).toBe('Test Profile Copy 3');
  });

  it('keeps unique import names and suffixes duplicates', () => {
    const existingNames = new Set(['test profile']);

    expect(getImportedProfileName('Other Profile', existingNames)).toBe(
      'Other Profile',
    );
    expect(getImportedProfileName('Test Profile', existingNames)).toBe(
      'Test Profile Copy',
    );

    existingNames.add('test profile copy');
    expect(getImportedProfileName('Test Profile', existingNames)).toBe(
      'Test Profile Copy 2',
    );
  });

  it('keeps unique imported ids and replaces collisions', () => {
    const existingIds = new Set(['imported-id']);

    expect(getUniqueProfileId('new-id', existingIds, 1800000000000)).toBe(
      'new-id',
    );
    expect(getUniqueProfileId('imported-id', existingIds, 1800000000000)).toBe(
      '1800000000000',
    );

    existingIds.add('1800000000000');
    expect(getUniqueProfileId('imported-id', existingIds, 1800000000000)).toBe(
      '1800000000000-1',
    );
  });

  it('copies settings with a new identity', () => {
    const duplicate = createDuplicateProfile(
      { ...baseProfile, temperature: 0.7 },
      [baseProfile],
      1800000000000,
    );

    expect(duplicate).toMatchObject({
      id: '1800000000000',
      name: 'Test Profile Copy',
      temperature: 0.7,
      createdAt: 1800000000000,
    });
    expect(baseProfile.name).toBe('Test Profile');
  });

  it('avoids reusing an existing id', () => {
    const duplicate = createDuplicateProfile(
      baseProfile,
      [{ ...baseProfile, id: '1800000000000' }],
      1800000000000,
    );

    expect(duplicate.id).toBe('1800000000000-1');
  });
});

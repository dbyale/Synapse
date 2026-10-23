import type { Profile } from '../../renderer/types/profile';
import { parseSynProfileCollection } from '../../renderer/utils/synprofile';
import manifestJson from './manifest.json';
import generalChatbot from './general-chatbot.synprofile';

export interface SetupProfileOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  tier: string;
  modelName: string;
  profileId: string;
}

export interface SetupProfileCategory {
  id: string;
  name: string;
  description: string;
  options: SetupProfileOption[];
}

export interface SetupProfileManifest {
  categories: SetupProfileCategory[];
  professions: Record<string, string[]>;
}

export const SETUP_PROFILE_MANIFEST = manifestJson as SetupProfileManifest;

const collections = [generalChatbot].map((collection) =>
  parseSynProfileCollection(collection),
);

const records = collections.flatMap((collection) => collection.profiles);

export const SETUP_PROFILES: Profile[] = records.map(
  (record) => record.profile,
);

export const SETUP_PROFILES_BY_ID = new Map(
  SETUP_PROFILES.map((profile) => [profile.id, profile]),
);

export const SETUP_DOWNLOADS_BY_ID = new Map(
  records.map((record) => [record.profile.id, record.downloads]),
);

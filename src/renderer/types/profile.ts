export type CacheType = 'f32' | 'f16' | 'bf16' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';

export interface Profile {
  id: string;
  name: string;
  model: string;
  projector?: string;
  modelAuthor: string;
  modelFolder: string;
  modelFilename: string;
  projectorFilename?: string;
  systemPrompt: string;
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  seed?: number;
  xtc?: {
    probability: number;
    threshold: number;
  };
  repeatPenalty?: {
    enabled?: boolean;
    lastTokens?: number;
    penalty?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  tools?: string[];
  layers?: number;
  gpuLayersAuto?: boolean;
  contextSize?: number;
  autoOptimizer?: 'longest-context' | 'most-gpu' | 'custom';
  kvOffload?: boolean;
  flashAttn?: 'on' | 'off' | 'auto';
  cacheTypeK?: CacheType;
  cacheTypeV?: CacheType;
  mmap?: boolean;
  mlock?: boolean;
  allocatedVRAM?: number;
  allocatedRAM?: number;
  maxLayers?: number;
  maxContext?: number;
  maxForModel?: string;
  estimation?: {
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  };
  videoSettings?: {
    fps?: number;
    maxFrames?: number;
    quality?: number;
    maxWidth?: number;
    unlimitedMaxFrames?: boolean;
  };
  specType?: string[];
  draftModelAuthor?: string;
  draftModelFolder?: string;
  draftModelFilename?: string;
  specDraftNMax?: number;
  specDraftNMin?: number;
  specDraftPSplit?: number;
  specDraftPMin?: number;
  cpuMoe?: boolean;
  nCpuMoe?: number;
  parallel?: number;
  order: number;
  createdAt: number;
}

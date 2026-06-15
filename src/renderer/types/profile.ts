export interface Profile {
  id: string;
  name: string;
  model: string;
  projector?: string;
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
  contextSize?: number;
  autoOptimizer?: 'longest-context' | 'most-gpu';
  allocatedVRAM?: number;
  allocatedRAM?: number;
  order: number;
  createdAt: number;
}

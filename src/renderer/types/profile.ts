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
    penalizeNewLine?: boolean;
    penalty?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  tools?: string[];
  order: number;
  createdAt: number;
}

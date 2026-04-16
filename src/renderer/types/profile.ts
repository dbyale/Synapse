export interface Profile {
  id: string;
  name: string;
  model: string; // filepath to model
  projector?: string; // optional filepath to projector
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
  order: number;
  createdAt: number;
}

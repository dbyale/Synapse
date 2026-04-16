export interface Profile {
  id: string;
  name: string;
  model: string; // filepath to model
  projector?: string; // optional filepath to projector
  systemPrompt: string;
  temperature?: number; // 0 to disable (default)
  topK?: number; // 0 to disable (default)
  topP?: number; // 1 to disable (default)
  minP?: number; // 0 to disable (default)
  seed?: number;
  xtc?: {
    probability: number;
    threshold: number;
  };
  order: number;
  createdAt: number;
}

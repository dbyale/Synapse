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
  tools?: string[];   // ← NEW: keys of selected tools from chatFunctions
  order: number;
  createdAt: number;
}

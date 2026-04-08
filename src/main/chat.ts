import type {
  Llama,
  LlamaChatSession,
  LlamaContext,
  LlamaModel,
} from 'node-llama-cpp';

// The variable declarations are correct.
let llamaModule: typeof import('node-llama-cpp') | null = null;
let llama: Llama | null = null;
let model: LlamaModel | null = null;
let context: LlamaContext | null = null;
let session: LlamaChatSession | null = null;
let abortController: AbortController | null = null;

async function ensureLlamaLoaded() {
  if (!llamaModule) {
    console.log('[chat] Loading node-llama-cpp module...');
    // FIX 1: Use a type assertion to tell TypeScript what the module's type is.
    llamaModule = (await Function('return import("node-llama-cpp")')()) as typeof import('node-llama-cpp');
    console.log('[chat] Module loaded.');
  }

  // This check now satisfies TypeScript because it knows what `llamaModule` is.
  if (!llama) {
    const { getLlama } = llamaModule;
    llama = await getLlama();
  }
  return { llamaModule, llama };
}

export async function loadModel(filepath: string) {
  console.log('[chat] Loading model from:', filepath);
  await unloadModel();

  try {
    const { llama: llamaInstance, llamaModule: module } = await ensureLlamaLoaded();

    // FIX 2: Add a guard clause to satisfy the 'possibly null' check.
    if (!llamaInstance) {
      throw new Error('Llama instance could not be initialized.');
    }

    console.log('[chat] Creating model instance...');
    model = await llamaInstance.loadModel({
      modelPath: filepath,
    });

    console.log('[chat] Creating context...');
    context = await model.createContext({
      contextSize: 200,
    });

    console.log('[chat] Creating chat session...');
    const { LlamaChatSession } = module;
    session = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });

    console.log('[chat] Model loaded successfully');
  } catch (error) {
    console.error('[chat] Error loading model:', error);
    await unloadModel();
    throw error;
  }
}

export async function sendMessage(
  text: string,
  onToken: (token: string) => void,
): Promise<string> {
  if (!session) {
    throw new Error('No model loaded. Please load a model first.');
  }

  abortController = new AbortController();

  try {
    console.log('[chat] Sending message:', text);
    const response = await session.prompt(text, {
      signal: abortController.signal,
      // FIX 3: Use a more flexible callback to handle potential type mismatches.
      onTextChunk: (chunk: { text: string } | string) => {
        // This robustly handles if the chunk is just a string OR an object with a .text property.
        const token = typeof chunk === 'string' ? chunk : chunk.text;
        onToken(token);
      },
    });

    abortController = null;
    console.log('[chat] Response complete');
    return response;
  } catch (error: any) {
    abortController = null;
    if (error.name === 'AbortError') {
      console.log('[chat] Generation aborted by user');
      return 'Generation aborted.';
    }
    console.error('[chat] Error during generation:', error);
    throw error;
  }
}

export function abort() {
  if (abortController) {
    console.log('[chat] Aborting generation...');
    abortController.abort();
    abortController = null;
  }
}

export async function unloadModel() {
  console.log('[chat] Unloading model...');
  abort();
  try {
    if (session) session = null;
    if (context) {
      await context.dispose();
      context = null;
    }
    if (model) {
      await model.dispose();
      model = null;
    }
    console.log('[chat] Model unloaded');
  } catch (error) {
    console.error('[chat] Error unloading model:', error);
  }
}

import type {
  Llama,
  LlamaChatSession,
  LlamaContext,
  LlamaModel,
} from 'node-llama-cpp';
import { loadSettings, onMemorySettingsChanged } from './settings';

let llamaModule: typeof import('node-llama-cpp') | null = null;
let llama: Llama | null = null;
let model: LlamaModel | null = null;
let context: LlamaContext | null = null;
let session: LlamaChatSession | null = null;
let abortController: AbortController | null = null;
let currentModelPath: string | null = null;
let currentSystemPrompt: string = 'You are a helpful assistant.';
let reloadUnsubscribe: (() => void) | null = null;

let lastResolvedMemory: {
  modelVramUsage: number;
  contextVramUsage: number;
  modelRamUsage: number;
  contextRamUsage: number;
} | null = null;

async function ensureLlamaLoaded() {
  if (!llamaModule) {
    console.log('[chat] Loading node-llama-cpp module...');
    llamaModule = (await Function('return import("node-llama-cpp")')()) as typeof import('node-llama-cpp');
    console.log('[chat] Module loaded.');
  }

  if (!llama) {
    const { getLlama } = llamaModule;
    llama = await getLlama();
  }
  return { llamaModule, llama };
}

async function computeLoadParams(loadedModel: LlamaModel): Promise<{
  gpuLayers: number;
  contextSize: number;
}> {
  const settings = loadSettings();

  // Settings are stored in MB — convert to bytes
  const allocatedVRAMBytes = (settings.allocatedVRAM ?? 0) * 1024 * 1024;
  const allocatedRAMBytes  = (settings.allocatedRAM  ?? 4096) * 1024 * 1024;

  console.log(
    `[chat] Memory budget — VRAM: ${(allocatedVRAMBytes / 1024 / 1024).toFixed(0)} MB, ` +
    `RAM: ${(allocatedRAMBytes / 1024 / 1024).toFixed(0)} MB`,
  );

  const resolved = await loadedModel.fileInsights.configurationResolver
    .resolveAndScoreConfig(
      {},
      {
        getVramState: () => Promise.resolve({
          total: allocatedVRAMBytes,
          free:  allocatedVRAMBytes,
          unifiedSize: 0,
        }),
        getRamState: () => Promise.resolve({
          total: allocatedRAMBytes,
          free:  allocatedRAMBytes,
        }),
      },
    );

  const { gpuLayers, contextSize } = resolved.resolvedValues;

  lastResolvedMemory = {
    modelVramUsage:   resolved.resolvedValues.modelVramUsage,
    contextVramUsage: resolved.resolvedValues.contextVramUsage,
    modelRamUsage:    resolved.resolvedValues.modelRamUsage,
    contextRamUsage:  resolved.resolvedValues.contextRamUsage,
  };

  console.log(
    `[chat] Resolved — gpuLayers: ${gpuLayers}, contextSize: ${contextSize}\n` +
    `  modelRamUsage:    ${(resolved.resolvedValues.modelRamUsage    / 1024 / 1024).toFixed(0)} MB\n` +
    `  contextRamUsage:  ${(resolved.resolvedValues.contextRamUsage  / 1024 / 1024).toFixed(0)} MB\n` +
    `  modelVramUsage:   ${(resolved.resolvedValues.modelVramUsage   / 1024 / 1024).toFixed(0)} MB\n` +
    `  contextVramUsage: ${(resolved.resolvedValues.contextVramUsage / 1024 / 1024).toFixed(0)} MB\n` +
    `  compatibilityScore: ${resolved.compatibilityScore}, bonusScore: ${resolved.bonusScore}`,
  );

  return { gpuLayers, contextSize };
}

async function reloadCurrentModel() {
  if (!currentModelPath) return;
  console.log('[chat] Memory settings changed — reloading model with new params...');
  await loadModel(currentModelPath, currentSystemPrompt);
}

reloadUnsubscribe = onMemorySettingsChanged(() => {
  reloadCurrentModel().catch((err) => {
    console.error('[chat] Failed to reload model after memory settings change:', err);
  });
});

export async function loadModel(
  filepath: string,
  systemPrompt?: string,
): Promise<{ success: boolean; error?: string }> {
  console.log('[chat] Loading model from:', filepath);

  // Update system prompt if provided, otherwise keep current
  if (systemPrompt !== undefined) {
    currentSystemPrompt = systemPrompt;
  }

  console.log('[chat] Using system prompt:', currentSystemPrompt.substring(0, 100) + '...');

  await unloadModel();

  try {
    const { llama: llamaInstance, llamaModule: module } = await ensureLlamaLoaded();

    if (!llamaInstance) {
      throw new Error('Llama instance could not be initialized.');
    }

    console.log('[chat] Computing load params...');
    let gpuLayers: number | undefined = undefined;
    let contextSize: number = 2048;

    const tempModel = await llamaInstance.loadModel({ modelPath: filepath });

    try {
      const params = await computeLoadParams(tempModel);
      gpuLayers   = params.gpuLayers;
      contextSize = params.contextSize;
    } catch (paramError) {
      console.error(
        '[chat] computeLoadParams failed, falling back to safe defaults:',
        paramError,
      );
    }

    await tempModel.dispose();

    console.log('[chat] Creating model instance...');
    model = await llamaInstance.loadModel({
      modelPath: filepath,
      ...(gpuLayers !== undefined && { gpuLayers }),
    });

    console.log(`[chat] Creating context — contextSize: ${contextSize}`);
    context = await model.createContext({
      contextSize,
      ignoreMemorySafetyChecks: true,
    });

    console.log('[chat] Creating chat session with system prompt...');
    const { LlamaChatSession } = module;

    session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: currentSystemPrompt,
    });

    console.log('[chat] Preloading system prompt into context...');
    await session.preloadPrompt('');
    console.log('[chat] Context warmed up.');

    currentModelPath = filepath;

    console.log('[chat] Model loaded successfully with system prompt', currentSystemPrompt.substring(0, 10) + '...');
    return { success: true };
  } catch (error: any) {
    console.error('[chat] Error loading model:', error);
    await unloadModel();
    return { success: false, error: error.message };
  }
}

export async function sendMessage(
  text: string,
  onToken: (token: string, segmentType?: 'thought' | 'comment') => void,
): Promise<string> {
  if (!session) {
    throw new Error('No model loaded. Please load a model first.');
  }

  abortController = new AbortController();

  try {
    console.log('[chat] Sending message:', text);

    const response = await session.prompt(text, {
      signal: abortController.signal,
      onResponseChunk: (chunk) => {
        // Determine segment type from chunk
        let segmentType: 'thought' | 'comment' | undefined = undefined;

        if (chunk.type === 'segment') {
          if (chunk.segmentType === 'thought') {
            segmentType = 'thought';
          } else if (chunk.segmentType === 'comment') {
            segmentType = 'comment';
          }

          // Optional: Log segment boundaries for debugging
          if (chunk.segmentStartTime != null) {
            console.log(`[chat] Segment start: ${chunk.segmentType}`);
          }
          if (chunk.segmentEndTime != null) {
            console.log(`[chat] Segment end: ${chunk.segmentType}`);
          }
        }

        // Call the callback with token and optional segment type
        onToken(chunk.text, segmentType);
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
  lastResolvedMemory = null;
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

// Changing system prompt requires reloading the model
export async function updateSystemPrompt(systemPrompt: string): Promise<void> {
  if (!currentModelPath) {
    throw new Error('No model loaded. Please load a model first.');
  }

  console.log('[chat] Updating system prompt (will reload model):', systemPrompt.substring(0, 100) + '...');

  // Reload the model with the new system prompt
  // This clears conversation history but ensures proper system prompt application
  await loadModel(currentModelPath, systemPrompt);

  console.log('[chat] System prompt updated successfully');
}

export function getCurrentSystemPrompt(): string {
  return currentSystemPrompt;
}

export async function tokenize(text: string): Promise<number | null> {
  if (!model) return null;
  const tokens = model.tokenize(text);
  return tokens.length;
}

export function getContextSize(): number | null {
  if (!context) return null;
  return context.contextSize;
}

export function getContextUsage(): { used: number; total: number } | null {
  if (!context || !session) return null;

  try {
    const sequence = session.sequence;
    const inputTokens = sequence.tokenMeter.usedInputTokens;
    const outputTokens = sequence.tokenMeter.usedOutputTokens;
    const totalUsed = inputTokens + outputTokens;
    const totalTokens = context.contextSize;

    return {
      used: totalUsed,
      total: totalTokens
    };
  } catch (error) {
    return null;
  }
}

export function getModelMemoryUsage() {
  return lastResolvedMemory;
}

import type {
  Llama,
  LlamaChatSession,
  LlamaContext,
  LlamaModel,
  LLamaChatPromptOptions,
} from 'node-llama-cpp';
import { loadSettings, onMemorySettingsChanged, getModelsDirectory } from './settings';
import type { Profile } from '../renderer/types/profile';
import { createChatFunctions } from './chatFunctions';
import path from 'path';

let llamaModule: typeof import('node-llama-cpp') | null = null;
let chatFunctions: ReturnType<typeof createChatFunctions> | null = null;
// ── Only the tools selected by the active profile ──
let activeSessionFunctions: Partial<ReturnType<typeof createChatFunctions>> | null = null;  // ← NEW
let llama: Llama | null = null;
let model: LlamaModel | null = null;
let context: LlamaContext | null = null;
let session: LlamaChatSession | null = null;
let abortController: AbortController | null = null;
let currentModelPath: string | null = null;
let currentProfile: Profile | null = null;
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

    chatFunctions = createChatFunctions(llamaModule.defineChatSessionFunction);
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
  if (!currentProfile) return;
  console.log('[chat] Memory settings changed — reloading profile with new params...');
  await loadProfile(currentProfile);
}

reloadUnsubscribe = onMemorySettingsChanged(() => {
  reloadCurrentModel().catch((err) => {
    console.error('[chat] Failed to reload profile after memory settings change:', err);
  });
});

// ── Build the per-session function map from a profile's tool list ──────────── NEW
function buildSessionFunctions(
  profile: Profile,
  all: ReturnType<typeof createChatFunctions>,
): Partial<ReturnType<typeof createChatFunctions>> | null {
  // If the profile has no tools array, or an empty one, disable all tools.
  if (!profile.tools || profile.tools.length === 0) {
    console.log('[chat] No tools selected for this profile — functions disabled.');
    return null;
  }

  const filtered: Partial<ReturnType<typeof createChatFunctions>> = {};
  for (const key of profile.tools) {
    if (key in all) {
      (filtered as Record<string, unknown>)[key] =
        (all as Record<string, unknown>)[key];
    }
  }

  const selectedKeys = Object.keys(filtered);
  console.log(`[chat] Active tools for this profile: [${selectedKeys.join(', ')}]`);
  return selectedKeys.length > 0 ? filtered : null;
}

export async function loadProfile(
  profile: Profile,
): Promise<{ success: boolean; error?: string }> {
  console.log('[chat] Loading profile:', profile.name);

  const modelsDir = getModelsDirectory();
  const fullModelPath = path.join(modelsDir, profile.model);

  console.log('[chat] Model relative path:', profile.model);
  console.log('[chat] Models directory:', modelsDir);
  console.log('[chat] Full model path:', fullModelPath);
  console.log('[chat] System prompt:', profile.systemPrompt.substring(0, 100) + '...');

  await unloadModel();

  let tempModel: LlamaModel | null = null;

  try {
    const { llama: llamaInstance, llamaModule: module } = await ensureLlamaLoaded();

    if (!llamaInstance) {
      throw new Error('Llama instance could not be initialized.');
    }

    // ── Resolve which tools are active for this profile ──────────────────── NEW
    activeSessionFunctions = chatFunctions
      ? buildSessionFunctions(profile, chatFunctions)
      : null;

    console.log('[chat] Computing load params...');
    let gpuLayers: number | undefined = undefined;
    let contextSize: number = 2048;

    console.log('[chat] Creating temporary model for param calculation...');
    tempModel = await llamaInstance.loadModel({ modelPath: fullModelPath });

    try {
      const params = await computeLoadParams(tempModel);
      gpuLayers   = params.gpuLayers;
      contextSize = params.contextSize;
      console.log(`[chat] Params computed: gpuLayers=${gpuLayers}, contextSize=${contextSize}`);
    } catch (paramError: any) {
      console.error('[chat] computeLoadParams failed:', paramError);
      if (tempModel) { await tempModel.dispose(); tempModel = null; }
      throw new Error(`Failed to compute load parameters: ${paramError.message || 'Insufficient memory'}`);
    }

    if (tempModel) {
      console.log('[chat] Disposing temporary model...');
      await tempModel.dispose();
      tempModel = null;
    }

    console.log('[chat] Creating model instance...');
    model = await llamaInstance.loadModel({
      modelPath: fullModelPath,
      ...(gpuLayers !== undefined && { gpuLayers }),
    });

    console.log(`[chat] Creating context — contextSize: ${contextSize}`);
    context = await model.createContext({
      contextSize,
      ignoreMemorySafetyChecks: true,
    });

    console.log('[chat] Creating chat session...');
    const { LlamaChatSession } = module;

    session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: profile.systemPrompt,
    });

    // Warm the KV cache with only the tools this profile has enabled.
    console.log('[chat] Preloading system prompt and function schemas into context...');
    await session.preloadPrompt('', {
      functions: activeSessionFunctions ?? undefined,   // ← CHANGED
    });
    console.log('[chat] Context warmed up.');

    currentModelPath = fullModelPath;
    currentProfile = profile;

    console.log('[chat] Profile loaded successfully');
    return { success: true };
  } catch (error: any) {
    console.error('[chat] Error loading profile:', error);

    if (tempModel) {
      try { await tempModel.dispose(); } catch (e) {
        console.error('[chat] Error disposing temp model:', e);
      }
    }

    await unloadModel();
    return {
      success: false,
      error: error?.message || 'Unknown error occurred while loading profile',
    };
  }
}

function buildPromptOptions(profile: Profile | null): Partial<LLamaChatPromptOptions> {
  if (!profile) return {};

  const options: Partial<LLamaChatPromptOptions> = {};
  if (profile.temperature !== undefined && profile.temperature > 0) options.temperature = profile.temperature;
  if (profile.topK !== undefined && profile.topK > 0)               options.topK        = profile.topK;
  if (profile.topP !== undefined && profile.topP < 1)               options.topP        = profile.topP;
  if (profile.minP !== undefined && profile.minP > 0)               options.minP        = profile.minP;
  if (profile.seed !== undefined)                                    options.seed        = profile.seed;
  if (profile.xtc  !== undefined)                                    options.xtc         = profile.xtc;
  return options;
}

export async function sendMessage(
  text: string,
  onToken: (token: string, segmentType?: 'thought' | 'comment') => void,
): Promise<string> {
  if (!session) {
    throw new Error('No profile loaded. Please load a profile first.');
  }

  abortController = new AbortController();

  try {
    console.log('[chat] Sending message:', text);

    const promptOptions: Partial<LLamaChatPromptOptions> = {
      signal: abortController.signal,
      functions: activeSessionFunctions ?? undefined,   // ← CHANGED (use filtered set)
      onResponseChunk: (chunk) => {
        let segmentType: 'thought' | 'comment' | undefined = undefined;

        if (chunk.type === 'segment') {
          if (chunk.segmentType === 'thought')       segmentType = 'thought';
          else if (chunk.segmentType === 'comment')  segmentType = 'comment';

          if (chunk.segmentStartTime != null) console.log(`[chat] Segment start: ${chunk.segmentType}`);
          if (chunk.segmentEndTime   != null) console.log(`[chat] Segment end: ${chunk.segmentType}`);
        }

        onToken(chunk.text, segmentType);
      },
      ...buildPromptOptions(currentProfile),
    };

    const response = await session.prompt(text, promptOptions);
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
  activeSessionFunctions = null;   // ← NEW: clear on unload
  try {
    if (session) session = null;
    if (context) { await context.dispose(); context = null; }
    if (model)   { await model.dispose();   model   = null; }
    console.log('[chat] Model unloaded');
  } catch (error) {
    console.error('[chat] Error unloading model:', error);
  }
}

export function getCurrentProfile(): Profile | null { return currentProfile; }

export async function tokenize(text: string): Promise<number | null> {
  if (!model) return null;
  return model.tokenize(text).length;
}

export function getContextSize(): number | null {
  return context ? context.contextSize : null;
}

export function getContextUsage(): { used: number; total: number } | null {
  if (!context || !session) return null;
  try {
    const sequence    = session.sequence;
    const inputTokens = sequence.tokenMeter.usedInputTokens;
    const outputTokens = sequence.tokenMeter.usedOutputTokens;
    return { used: inputTokens + outputTokens, total: context.contextSize };
  } catch {
    return null;
  }
}

export function getModelMemoryUsage() { return lastResolvedMemory; }

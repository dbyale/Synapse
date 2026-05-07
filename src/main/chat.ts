import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { graphics } from 'systeminformation';
import { loadSettings, onMemorySettingsChanged, getModelsDirectory } from './settings';
import type { Profile } from '../renderer/types/profile';
import { createChatFunctions } from './chatFunctions';

const execFileAsync = promisify(execFile);

// --- State Management ---
let serverProcess: ChildProcess | null = null;
let messageHistory: any[] = [];
let abortController: AbortController | null = null;
let currentProfile: Profile | null = null;
let chatFunctions: any = null;
let activeTools: any[] = [];
let emitFunctionEvent: ((event: 'calling' | 'call' | 'result', name: string, data: string) => void) | null = null;

// Caches for IPC compatibility (Prevents "Object could not be cloned" errors)
let lastResolvedMemory: any = null;
let currentContextSize: number | null = null;
let lastUsage: { used: number; total: number } | null = null;

// --- Internal Helpers ---

/**
 * Resolves paths for the 'assets' folder in both Development and Production (ERB specific)
 */
function getAssetPath(...paths: string[]): string {
  const isProd = app.isPackaged;
  const base = isProd
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');
  return path.join(base, ...paths);
}

/**
 * Detects the best available hardware backend
 */
async function detectBackend(): Promise<string> {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return `macos-${arch}`;
  }

  if (platform === 'win32') {
    try {
      const gpu = await graphics();
      const isNvidia = gpu.controllers.some(c =>
        c.vendor.toLowerCase().includes('nvidia')
      );
      if (isNvidia) return 'win-cuda-12.4-x64';
      return 'win-vulkan-x64';
    } catch (e) {
      return 'win-cpu-x64';
    }
  }

  return 'ubuntu-x64';
}

/**
 * Runs gguf-parser to get recommended GPU layers (ngl)
 */
async function getNglEstimation(modelPath: string, vramMB: number, ctxSize: number, backendPath: string) {
  const parserBin = process.platform === 'win32' ? 'gguf-parser.exe' : 'gguf-parser';
  const parserPath = path.join(backendPath, parserBin);

  try {
    const { stdout } = await execFileAsync(parserPath, [
      'estimate', '--model', modelPath, '--vram', vramMB.toString(), '--ctx', ctxSize.toString(), '--json'
    ]);
    const data = JSON.parse(stdout);
    return {
      ngl: data.offload_layers ?? 0,
      memory: {
        modelVramUsage: data.model_vram ?? 0,
        contextVramUsage: data.ctx_vram ?? 0,
        modelRamUsage: data.model_ram ?? 0,
        contextRamUsage: data.ctx_ram ?? 0
      }
    };
  } catch (e) {
    console.error('[chat] gguf-parser estimation failed:', e);
    return { ngl: 0, memory: null };
  }
}

/**
 * Periodically updates the token usage from the server slots
 */
async function updateUsageCache() {
  try {
    const res = await fetch('http://127.0.0.1:8080/slots');
    if (!res.ok) return;
    const slots = await res.json();
    if (slots && slots[0]) {
      lastUsage = {
        used: slots[0].n_past,
        total: currentContextSize || 2048
      };
    }
  } catch (e) {
    // Server might be closed
  }
}

// --- Public API ---

export function setEmitFunctionCallback(callback: any): void {
  emitFunctionEvent = callback;
}

export async function loadProfile(profile: Profile): Promise<{ success: boolean; error?: string }> {
  console.log('[chat] Loading profile:', profile.name);
  await unloadModel();

  try {
    const settings = loadSettings();
    const modelsDir = getModelsDirectory();
    const fullModelPath = path.join(modelsDir, profile.model);

    // 1. Detect Backend Folder
    const backendFolder = await detectBackend();
    const backendPath = getAssetPath('bin', backendFolder);
    const serverBin = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const serverPath = path.join(backendPath, serverBin);

    // 2. Perform Memory Estimation
    const vramLimit = settings.allocatedVRAM ?? 4096;
    const ctxSize = 2048; // Standard context fallback
    const estimation = await getNglEstimation(fullModelPath, vramLimit, ctxSize, backendPath);

    // Cache for IPC getters
    lastResolvedMemory = estimation.memory;
    currentContextSize = ctxSize;
    lastUsage = { used: 0, total: ctxSize };

    // 3. Prepare Tools (converts existing chatFunctions to OpenAI schema)
    if (!chatFunctions) {
      // Pass a dummy function to strip node-llama-cpp dependency
      chatFunctions = createChatFunctions(((fn: any) => fn) as any);
    }

    activeTools = (profile.tools || [])
      .map(toolName => {
        const fn = chatFunctions[toolName];
        if (!fn) return null;
        return {
          type: 'function',
          function: {
            name: toolName,
            description: fn.description,
            parameters: fn.parameters
          }
        };
      })
      .filter(Boolean);

    // 4. Start Server Process
    console.log(`[chat] Spawning ${backendFolder} server with NGL: ${estimation.ngl}`);
    serverProcess = spawn(serverPath, [
      '--model', fullModelPath,
      '--n-gpu-layers', estimation.ngl.toString(),
      '--ctx-size', ctxSize.toString(),
      '--port', '8080',
      '--host', '127.0.0.1',
      '--no-mmap'
    ]);

    // 5. Wait for server readiness
    let isReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('http://127.0.0.1:8080/health');
        if (res.ok) { isReady = true; break; }
      } catch (e) { /* ignore */ }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!isReady) throw new Error("Llama server failed to start within timeout.");

    currentProfile = profile;
    messageHistory = [{ role: 'system', content: profile.systemPrompt }];

    console.log('[chat] Profile loaded successfully');
    return { success: true };
  } catch (error: any) {
    console.error('[chat] Error loading profile:', error);
    await unloadModel();
    return { success: false, error: error?.message || 'Unknown error' };
  }
}

export async function sendMessage(
  text: string,
  onToken: (token: string, segmentType?: 'thought' | 'comment') => void,
): Promise<string> {
  if (!currentProfile) throw new Error('No profile loaded.');

  messageHistory.push({ role: 'user', content: text });
  abortController = new AbortController();

  try {
    const runInference = async (): Promise<string> => {
      const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messageHistory,
          tools: activeTools.length > 0 ? activeTools : undefined,
          stream: true,
          temperature: currentProfile?.temperature,
          top_p: currentProfile?.topP,
          repeat_penalty: currentProfile?.repeatPenalty?.penalty
        }),
        signal: abortController?.signal
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let currentToolCalls: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') break;

          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices[0].delta;

            // Tokens
            if (delta.content) {
              fullText += delta.content;
              onToken(delta.content);
            }

            // Reasoning (Thought)
            if (delta.reasoning_content) {
              onToken(delta.reasoning_content, 'thought');
            }

            // Tools
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!currentToolCalls[idx]) {
                  currentToolCalls[idx] = { id: tc.id, name: '', args: '' };
                  if (tc.function?.name) {
                    currentToolCalls[idx].name = tc.function.name;
                    emitFunctionEvent?.('calling', tc.function.name, '');
                  }
                }
                if (tc.function?.arguments) {
                  currentToolCalls[idx].args += tc.function.arguments;
                }
              }
            }
          } catch (e) { /* partial json */ }
        }
      }

      // If tools were called, execute them and recurse
      if (currentToolCalls.length > 0) {
        const assistantMsg = {
          role: 'assistant',
          tool_calls: currentToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args }
          }))
        };
        messageHistory.push(assistantMsg);

        for (const tc of currentToolCalls) {
          const handler = chatFunctions[tc.name]?.handler;
          const args = JSON.parse(tc.args);

          emitFunctionEvent?.('call', tc.name, tc.args);
          const result = await handler(args);
          emitFunctionEvent?.('result', tc.name, JSON.stringify(result));

          messageHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          });
        }

        return runInference(); // Recursive loop
      }

      return fullText;
    };

    const result = await runInference();
    messageHistory.push({ role: 'assistant', content: result });
    updateUsageCache(); // Async update for next poll
    return result;

  } catch (error: any) {
    if (error.name === 'AbortError') return 'Generation aborted.';
    throw error;
  } finally {
    abortController = null;
  }
}

export function abort() {
  abortController?.abort();
}

export async function unloadModel() {
  abort();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  currentProfile = null;
  messageHistory = [];
  lastResolvedMemory = null;
  currentContextSize = null;
  lastUsage = null;
}

// --- IPC Compatible Getters (Synchronous data return) ---

export function getContextSize(): number | null {
  return currentContextSize;
}

export function getContextUsage(): { used: number; total: number } | null {
  return lastUsage;
}

export function getModelMemoryUsage() {
  return lastResolvedMemory ? { ...lastResolvedMemory } : null;
}

export function getCurrentProfile(): Profile | null {
  return currentProfile;
}

export async function tokenize(text: string): Promise<number | null> {
  try {
    const res = await fetch('http://127.0.0.1:8080/tokenize', {
      method: 'POST',
      body: JSON.stringify({ content: text })
    });
    const data = await res.json();
    return data.tokens?.length || 0;
  } catch {
    return null;
  }
}

// Listener for settings change
onMemorySettingsChanged(() => {
  if (currentProfile) {
    loadProfile(currentProfile).catch(console.error);
  }
});

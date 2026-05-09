import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { graphics } from 'systeminformation';
import { loadSettings, onMemorySettingsChanged, getModelsDirectory } from './settings';
import type { Profile } from '../renderer/types/profile';
import { createChatFunctions } from './chatFunctions';
import { solveMaxConfig } from './estimator';

export interface GenerationStats {
  tokens: number;
  timeMs: number;
  tokensPerSecond: number;
}

export interface SendMessageResponse {
  content: string;
  stats?: GenerationStats;
}

interface TokenUsageStore {
  totalInputTokens: number;
  totalOutputTokens: number;
}

// --- State ---
let serverProcess: ChildProcess | null = null;
let messageHistory: any[] = [];
let abortController: AbortController | null = null;
let currentProfile: Profile | null = null;
let chatFunctions: any = null;
let activeTools: any[] = [];
let emitFunctionEvent: any = null;

let lastResolvedMemory: any = null;
let currentContextSize: number | null = null;
let lastUsage: { used: number; total: number } | null = null;

function getTokenUsagePath(): string {
  return path.join(app.getPath('userData'), 'tokenUsage.json');
}

function loadTokenUsage(): TokenUsageStore {
  try {
    return JSON.parse(fs.readFileSync(getTokenUsagePath(), 'utf-8'));
  } catch {
    return { totalInputTokens: 0, totalOutputTokens: 0 };
  }
}

function saveTokenUsage(store: TokenUsageStore): void {
  try {
    fs.writeFileSync(getTokenUsagePath(), JSON.stringify(store), 'utf-8');
  } catch (e) {
    console.error('[chat] Failed to save token usage:', e);
  }
}

function addTokenUsage(inputTokens: number, outputTokens: number): void {
  const current = loadTokenUsage();
  saveTokenUsage({
    totalInputTokens: current.totalInputTokens + inputTokens,
    totalOutputTokens: current.totalOutputTokens + outputTokens,
  });
}

export function getCumulativeTokenUsage(): TokenUsageStore {
  return loadTokenUsage();
}

function getAssetPath(...paths: string[]): string {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, '../../assets');
  return path.join(base, ...paths);
}

async function detectBackend(): Promise<string> {
  const platform = process.platform;
  if (platform === 'darwin') return `macos-${process.arch}`;
  try {
    const gpu = await graphics();
    const isNvidia = gpu.controllers.some(c => c.vendor.toLowerCase().includes('nvidia'));
    if (platform === 'win32') return isNvidia ? 'win-cuda-12.4-x64' : 'win-vulkan-x64';
  } catch (e) {}
  return platform === 'win32' ? 'win-cpu-x64' : 'ubuntu-x64';
}

export function setEmitFunctionCallback(cb: any) { emitFunctionEvent = cb; }

export async function loadProfile(profile: Profile): Promise<{ success: boolean; error?: string }> {
  console.log('[chat] Loading Profile:', profile.name);
  await unloadModel();

  let serverErrorLog = '';

  try {
    const settings = loadSettings();
    const fullModelPath = path.join(getModelsDirectory(), profile.model);
    const backendFolder = await detectBackend();
    const serverBin = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const serverPath = path.join(getAssetPath('bin', backendFolder), serverBin);

    const vramMB = settings.allocatedVRAM ?? 4096;
    const ramMB = settings.allocatedRAM ?? 8192;
    const result = await solveMaxConfig(fullModelPath, vramMB, ramMB);

    lastResolvedMemory = result.memory;
    currentContextSize = result.ctx;

    if (!chatFunctions) chatFunctions = createChatFunctions(((fn: any) => fn) as any);
    activeTools = (profile.tools || []).map(t => chatFunctions[t]).filter(Boolean).map(f => ({
      type: 'function',
      function: { name: f.name || Object.keys(chatFunctions).find(k => chatFunctions[k] === f), description: f.description, parameters: f.params }
    }));

    serverProcess = spawn(serverPath, [
      '--model', fullModelPath,
      '--n-gpu-layers', result.ngl.toString(),
      '--ctx-size', result.ctx.toString(),
      '--port', '8080',
      '--host', '127.0.0.1',
      '--parallel', '1',
      '--metrics',
      '--log-disable'
    ]);

    serverProcess.stderr?.on('data', (d) => {
      serverErrorLog += d.toString();
    });

    let ready = false;
    for (let i = 0; i < 45; i++) {
      try {
        const res = await fetch('http://127.0.0.1:8080/health');
        if (res.ok) { ready = true; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!ready) {
      console.error('[llama-server] Startup failed. Logs:\n', serverErrorLog);
      throw new Error("Inference server failed to respond.");
    }

    const systemTokens = (await tokenize(profile.systemPrompt)) ?? 0;
    const toolTokens = activeTools.length > 0 ? (await tokenize(JSON.stringify(activeTools))) ?? 0 : 0;
    lastUsage = { used: systemTokens + toolTokens, total: result.ctx };

    currentProfile = profile;
    messageHistory = [{ role: 'system', content: profile.systemPrompt }];
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function sendMessage(text: string, onToken: (t: string, type?: 'thought' | 'comment') => void): Promise<SendMessageResponse> {
  if (!currentProfile) throw new Error("No profile loaded");

  const userTokens = (await tokenize(text)) ?? 0;
  if (lastUsage) {
    lastUsage = { used: lastUsage.used + userTokens, total: lastUsage.total };
  }

  messageHistory.push({ role: 'user', content: text });
  abortController = new AbortController();

  const runCompletion = async (): Promise<SendMessageResponse> => {
    const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messageHistory,
        tools: activeTools.length > 0 ? activeTools : undefined,
        stream: true,
        stream_options: { include_usage: true },
        temperature: currentProfile?.temperature ?? 0.7
      }),
      signal: abortController?.signal
    });

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";
    let toolCalls: any[] = [];
    let stats: GenerationStats | undefined;

    try {
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') break;

          try {
            const data = JSON.parse(dataStr);

            if (data.usage) {
              lastUsage = { used: data.usage.total_tokens, total: currentContextSize || 2048 };

              addTokenUsage(
                data.usage.prompt_tokens ?? 0,
                data.usage.completion_tokens ?? 0,
              );

              stats = {
                tokens: data.usage.completion_tokens,
                timeMs: data.timings?.predicted_ms || 0,
                tokensPerSecond: data.timings?.predicted_per_second || 0
              };
            }

            const delta = data.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              fullResponse += delta.content;
              onToken(delta.content);
            }
            if (delta.reasoning_content) {
              onToken(delta.reasoning_content, 'thought');
            }
            if (delta.tool_calls) {
              delta.tool_calls.forEach((tc: any) => {
                if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id, name: '', args: '' };
                if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                if (tc.function?.arguments) toolCalls[tc.index].args += tc.function.arguments;
              });
            }

            if (lastUsage && !data.usage) {
              lastUsage = { used: lastUsage.used + 1, total: lastUsage.total };
            }
          } catch (e) {}
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (toolCalls.length > 0) {
      messageHistory.push({ role: 'assistant', tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })) });
      for (const tc of toolCalls) {
        const handler = chatFunctions[tc.name]?.handler;
        if (emitFunctionEvent) emitFunctionEvent('calling', tc.name, '');
        if (emitFunctionEvent) emitFunctionEvent('call', tc.name, tc.args);
        const result = await handler(JSON.parse(tc.args));
        if (emitFunctionEvent) emitFunctionEvent('result', tc.name, JSON.stringify(result));
        messageHistory.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      return runCompletion();
    }
    return { content: fullResponse, stats };
  };

  try {
    const result = await runCompletion();
    messageHistory.push({ role: 'assistant', content: result.content });
    return result;
  } catch (e: any) {
    if (e.name === 'AbortError') return { content: 'Aborted' };
    throw e;
  }
}

export function abort() { abortController?.abort(); }

export async function unloadModel() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  messageHistory = [];
  currentContextSize = null;
  lastUsage = null;
}

export function getContextSize() { return currentContextSize; }
export function getContextUsage() { return lastUsage; }
export function getModelMemoryUsage() { return lastResolvedMemory ? { ...lastResolvedMemory } : null; }
export function getCurrentProfile() { return currentProfile; }

export async function tokenize(text: string): Promise<number | null> {
  try {
    const res = await fetch('http://127.0.0.1:8080/tokenize', { method: 'POST', body: JSON.stringify({ content: text }) });
    return (await res.json()).tokens?.length || 0;
  } catch { return null; }
}

onMemorySettingsChanged(() => { if (currentProfile) loadProfile(currentProfile).catch(console.error); });

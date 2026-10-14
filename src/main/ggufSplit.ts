import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import { loadSettings } from './settings';
import { resolveSplitBinary } from './backendPaths';

const activeMerges = new Map<string, ChildProcess>();

async function resolveSplitPath(): Promise<string> {
  const { splitPath } = await resolveSplitBinary(loadSettings());
  if (!fs.existsSync(splitPath)) {
    throw new Error(
      `llama-gguf-split binary not found at ${splitPath}. Re-download the backend (it now ships alongside llama-server).`,
    );
  }
  return splitPath;
}

export function cancelMerge(key: string): boolean {
  const child = activeMerges.get(key);
  if (!child) return false;
  try {
    child.kill();
  } catch {
    // Already exited.
  }
  return true;
}

export async function mergeGgufSplits(
  firstPartPath: string,
  mergedPath: string,
): Promise<{ stdout: string; stderr: string }> {
  const splitPath = await resolveSplitPath();
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      activeMerges.delete(mergedPath);
      fn();
    };
    const child = spawn(splitPath, ['--merge', firstPartPath, mergedPath]);
    activeMerges.set(mergedPath, child);
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < 4 * 1024 * 1024) stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 4 * 1024 * 1024) stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      finish(() =>
        reject(new Error(`llama-gguf-split failed: ${err.message}`)),
      );
    });
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        finish(() =>
          reject(
            new Error(
              `llama-gguf-split --merge failed with exit code ${code}${stderr ? `\n${stderr.slice(-4000)}` : ''}`,
            ),
          ),
        );
      } else {
        finish(() => resolve({ stdout, stderr }));
      }
    });
  });
}

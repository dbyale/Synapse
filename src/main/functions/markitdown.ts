import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { loadSettings } from '../settings';
import { resolveSelectedPython } from '../pythonInfo';
import { ensurePythonPackage } from '../pythonPackageInstaller';

const execFileAsync = promisify(execFile);

async function resolvePythonBinary(): Promise<string> {
  const runtime = await resolveSelectedPython(loadSettings());
  if (!runtime) {
    throw new Error(
      'No Python runtime is available. Install the Synapse-managed Python ' +
        'from setup, or select a system Python in Settings.',
    );
  }
  return runtime.binary;
}

let markitdownReady = false;
let markitdownCheckInProgress: Promise<{
  success: boolean;
  error?: string;
}> | null = null;

async function ensureMarkitdown(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (markitdownReady) return { success: true };
  if (markitdownCheckInProgress) return markitdownCheckInProgress;

  markitdownCheckInProgress = (async () => {
    const result = await ensurePythonPackage('markitdown', 'markitdown');
    if (result.success) markitdownReady = true;
    return result;
  })().finally(() => {
    markitdownCheckInProgress = null;
  });

  return markitdownCheckInProgress;
}

export async function convertFileToMarkdown(
  filePath: string,
): Promise<{ success: boolean; markdown?: string; error?: string }> {
  const runId = randomUUID();
  const dir = join(tmpdir(), `md-convert-${runId}`);
  let codePath: string | null = null;

  try {
    const install = await ensureMarkitdown();
    if (!install.success) {
      return { success: false, error: install.error };
    }

    const binary = await resolvePythonBinary();

    const script = `
from markitdown import MarkItDown
import json
try:
    md = MarkItDown()
    result = md.convert(${JSON.stringify(filePath)})
    print(json.dumps({"success": True, "markdown": result.text_content}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;

    await mkdir(dir, { recursive: true });
    codePath = join(dir, 'convert.py');
    await writeFile(codePath, script, 'utf8');

    const { stdout } = await execFileAsync(binary, [codePath], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      timeout: 60_000,
    });

    const parsed = JSON.parse(stdout.trim());
    return parsed;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMessage };
  } finally {
    if (codePath) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

let resolvedBinary: string | null = null;

async function resolvePythonBinary(): Promise<string> {
  if (resolvedBinary !== null) return resolvedBinary;

  const candidates = ['python3', 'python', 'py'];
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version']);
      resolvedBinary = bin;
      return bin;
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    'No Python binary found on this system. ' +
      'Please install Python 3 and ensure it is in your PATH.',
  );
}

let markitdownReady = false;
let markitdownCheckInProgress: Promise<{ success: boolean; error?: string }> | null = null;

async function ensureMarkitdown(): Promise<{ success: boolean; error?: string }> {
  if (markitdownReady) return { success: true };
  if (markitdownCheckInProgress) return await markitdownCheckInProgress;

  markitdownCheckInProgress = (async () => {
    try {
      const binary = await resolvePythonBinary();
      await execFileAsync(
        binary,
        ['-m', 'pip', 'install', 'markitdown[pdf,docx,pptx,xlsx,xls,audio-transcription]', '--quiet', '--upgrade'],
        { timeout: 120_000 },
      );
      markitdownReady = true;
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to install markitdown: ${msg}` };
    }
  })();

  return await markitdownCheckInProgress;
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

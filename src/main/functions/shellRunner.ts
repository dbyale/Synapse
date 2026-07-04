import { exec } from 'child_process';
import { promisify } from 'util';
import { cwd } from 'process';

const execAsync = promisify(exec);

export interface ShellRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  executionTimeMs: number;
  error?: string;
}

export async function runShellCommand(
  command: string,
  workdir?: string,
  timeoutMs: number = 30000,
): Promise<ShellRunResult> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workdir || cwd(),
      timeout: timeoutMs,
      maxBuffer: 100 * 1024,
    });

    return {
      success: true,
      stdout: stdout || '(no output)',
      stderr: stderr || null,
      exitCode: 0,
      timedOut: false,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (err: any) {
    const timedOut = err.killed || err.signal === 'SIGTERM';
    return {
      success: err.code === 0,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || 'Unknown error',
      exitCode: err.code ?? null,
      timedOut,
      executionTimeMs: Date.now() - startTime,
      error: timedOut ? 'Command timed out' : err.message,
    };
  }
}

export interface ShellEnvironmentInfo {
  platform: string;
  shell: string;
  arch: string;
  hostname: string;
  homedir: string;
}

export function getShellEnvironmentInfo(): ShellEnvironmentInfo {
  return {
    platform: process.platform,
    shell: process.env.SHELL || process.env.ComSpec || 'cmd.exe',
    arch: process.arch,
    hostname: require('os').hostname(),
    homedir: require('os').homedir(),
  };
}

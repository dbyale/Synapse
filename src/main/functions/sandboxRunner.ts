import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

const DOCKER_IMAGE = 'synapse-sandbox:latest';

// ── Types ────────────────────────────────────────────────────────

export interface SandboxEnv {
  containerId: string;
  containerName: string;
  workspacePath: string;
  createdAt: string;
  networkEnabled: boolean;
}

interface SavedSandbox {
  containerName: string;
  workspacePath: string;
  createdAt: string;
  networkEnabled: boolean;
}

interface SandboxStateFile {
  version: number;
  environments: SavedSandbox[];
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  executionTimeMs: number;
  error?: string;
}

export interface FileReadResult {
  success: boolean;
  content?: string;
  error?: string;
}

export interface FileWriteResult {
  success: boolean;
  path: string;
  error?: string;
}

export interface ListDirResult {
  success: boolean;
  entries?: string[];
  error?: string;
}

// ── Static analysis blocklist ──────────────────────────────────

const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/docker\s+(exec|run|build|pull|ps)/i, 'Docker commands are not allowed inside sandbox'],
  [/nsenter/, 'nsenter is not allowed'],
  [/unshare/, 'unshare is not allowed'],
  [/mount\s+--bind/, 'bind mounts are not allowed'],
  [/modprobe/, 'modprobe is not allowed'],
  [/insmod/, 'insmod is not allowed'],
];

function validateCommand(command: string): void {
  for (const [pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Sandbox security violation — ${reason}`);
    }
  }
}

// ── Docker detection ────────────────────────────────────────────

let dockerPath: string | null | undefined = undefined;

export interface DockerInfo {
  available: boolean;
  path: string | null;
  error: string | null;
}

export async function detectDocker(): Promise<DockerInfo> {
  if (dockerPath === undefined) {
    const candidates = ['docker', 'docker.exe'];
    for (const bin of candidates) {
      try {
        const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000 });
        console.log(`[sandbox] Docker found via "${bin}": ${stdout.trim()}`);
        dockerPath = bin;
        break;
      } catch {
        // try next
      }
    }

    // On Windows, check common Docker install paths
    if (dockerPath === undefined && process.platform === 'win32') {
      const commonPaths = [
        'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
        `${process.env.LOCALAPPDATA}\\Docker\\resources\\bin\\docker.exe`,
        `${process.env.ProgramFiles}\\Docker\\Docker\\resources\\bin\\docker.exe`,
      ];
      for (const p of commonPaths) {
        try {
          await execFileAsync(p, ['--version'], { timeout: 5000 });
          console.log(`[sandbox] Docker found via full path: "${p}"`);
          dockerPath = p;
          break;
        } catch {
          // try next
        }
      }
    }

    if (dockerPath === undefined) {
      dockerPath = null; // mark as resolved and not found
    }
  }

  if (dockerPath === null) {
    return { available: false, path: null, error: 'Docker binary not found in PATH or common install locations.' };
  }

  // Verify daemon is reachable
  try {
    await execFileAsync(dockerPath, ['info', '--format', '{{.ServerVersion}}'], { timeout: 10000 });
    return { available: true, path: dockerPath, error: null };
  } catch (err: any) {
    const msg = `Docker binary found at "${dockerPath}" but daemon is unreachable: ${err.message || String(err)}`;
    console.error(`[sandbox] ${msg}`);
    return { available: false, path: dockerPath, error: msg };
  }
}

export async function checkDockerAvailable(): Promise<boolean> {
  const info = await detectDocker();
  return info.available;
}

// ── Docker binary resolution ──────────────────────────────────────

function getDockerBin(): string {
  if (dockerPath && typeof dockerPath === 'string') return dockerPath;
  return process.platform === 'win32' ? 'docker.exe' : 'docker';
}

// ── State persistence ────────────────────────────────────────────

function sandboxStatePath(): string {
  return path.join(app.getPath('userData'), 'sandboxes.json');
}

async function saveSandboxState(): Promise<void> {
  try {
    const saved: SavedSandbox[] = [];
    for (const env of environments.values()) {
      saved.push({
        containerName: env.containerName,
        workspacePath: env.workspacePath,
        createdAt: env.createdAt,
        networkEnabled: env.networkEnabled,
      });
    }
    const data: SandboxStateFile = { version: 1, environments: saved };
    await fs.writeFile(sandboxStatePath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[sandbox] Failed to save state:', err);
  }
}

async function loadSandboxState(): Promise<void> {
  try {
    const raw = await fs.readFile(sandboxStatePath(), 'utf-8');
    const data: SandboxStateFile = JSON.parse(raw);
    if (!data.environments) return;

    const bin = getDockerBin();
    for (const saved of data.environments) {
      try {
        const { stdout } = await execFileAsync(bin, ['ps', '-a', '-q', '-f', `name=${saved.containerName}`], { timeout: 5000 });
        const containerId = stdout.trim();
        if (!containerId) continue; // container no longer exists, skip

        const env: SandboxEnv = {
          containerId,
          containerName: saved.containerName,
          workspacePath: saved.workspacePath,
          createdAt: saved.createdAt,
          networkEnabled: saved.networkEnabled,
        };
        environments.set(saved.containerName, env);
      } catch {
        // container doesn't exist or docker error — skip
      }
    }

    // Prune orphans by re-saving
    await saveSandboxState();
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error('[sandbox] Failed to load state:', err);
    }
  }
}

export async function shutdownAllSandboxes(): Promise<{ stopped: number; errors: string[] }> {
  const errors: string[] = [];
  let stopped = 0;
  const bin = getDockerBin();

  for (const [name, env] of environments) {
    try {
      await execFileAsync(bin, ['stop', name], { timeout: 15000 });
      stopped++;
    } catch (err: any) {
      errors.push(`${name}: ${err.message || String(err)}`);
    }
    // Keep container in environments map for re-start
  }

  await saveSandboxState();
  console.log(`[sandbox] Shutdown: stopped ${stopped} container(s), ${errors.length} error(s)`);
  return { stopped, errors };
}

export async function getSavedEnvironments(): Promise<Array<{
  containerName: string;
  workspacePath: string;
  createdAt: string;
  networkEnabled: boolean;
  status: string;
}>> {
  const bin = getDockerBin();
  const result: Array<{
    containerName: string;
    workspacePath: string;
    createdAt: string;
    networkEnabled: boolean;
    status: string;
  }> = [];

  for (const env of environments.values()) {
    let status = 'unknown';
    try {
      const { stdout } = await execFileAsync(bin, ['ps', '-a', '--format', '{{.Status}}', '-f', `name=${env.containerName}`], { timeout: 5000 });
      status = stdout.trim().split('\n')[0] || 'unknown';
    } catch {
      status = 'unreachable';
    }
    result.push({
      containerName: env.containerName,
      workspacePath: env.workspacePath,
      createdAt: env.createdAt,
      networkEnabled: env.networkEnabled,
      status,
    });
  }
  return result;
}

export async function startSandboxEnvironment(
  containerName: string,
): Promise<{ success: boolean; containerId?: string; containerName?: string; workspacePath?: string; error?: string }> {
  const env = environments.get(containerName);
  if (!env) {
    return { success: false, error: `No saved environment with name "${containerName}".` };
  }

  const bin = getDockerBin();
  try {
    await execFileAsync(bin, ['start', containerName], { timeout: 15000 });
    const { stdout: idOut } = await execFileAsync(bin, ['ps', '-q', '-f', `name=${containerName}`], { timeout: 5000 });
    env.containerId = idOut.trim();

    return {
      success: true,
      containerId: env.containerId,
      containerName: env.containerName,
      workspacePath: env.workspacePath,
    };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

// ── Environment management ──────────────────────────────────────

const environments = new Map<string, SandboxEnv>();

// Load saved state on module init
loadSandboxState();

async function ensureSandboxImage(): Promise<void> {
  const bin = getDockerBin();
  try {
    await execFileAsync(bin, ['image', 'inspect', DOCKER_IMAGE], { timeout: 10000 });
  } catch {
    const tempName = `synapse-sandbox-temp-${randomUUID().slice(0, 8)}`;
    try {
      await execFileAsync(bin, ['pull', 'alpine:latest'], { timeout: 120000 });
      await execFileAsync(bin, ['create', '--name', tempName, 'alpine:latest', 'tail', '-f', '/dev/null'], { timeout: 15000 });
      await execFileAsync(bin, ['start', tempName], { timeout: 15000 });
      await execFileAsync(bin, ['exec', tempName, 'apk', 'add', '--no-cache', 'git', 'bash', 'coreutils', 'findutils'], { timeout: 120000 });
      await execFileAsync(bin, ['commit', tempName, DOCKER_IMAGE], { timeout: 30000 });
    } finally {
      try {
        await execFileAsync(bin, ['rm', '-f', tempName], { timeout: 10000 });
      } catch { }
    }
  }
}

export async function createSandboxEnvironment(
  options?: { memoryLimit?: string; cpuLimit?: number },
): Promise<{
  success: boolean;
  containerId?: string;
  containerName?: string;
  workspacePath?: string;
  error?: string;
}> {
  try {
    const dockerInfo = await detectDocker();
    if (!dockerInfo.available) {
      return {
        success: false,
        error: dockerInfo.error || 'Docker is not available.',
      };
    }

    await ensureSandboxImage();

    const bin = getDockerBin();
    const containerName = `synapse-sandbox-${randomUUID().slice(0, 8)}`;
    const memoryLimit = options?.memoryLimit ?? '512m';
    const cpuLimit = options?.cpuLimit ?? 2;

    await execFileAsync(bin, [
      'create',
      '--name', containerName,
      '--network', 'none',
      '--memory', memoryLimit,
      '--cpus', String(cpuLimit),
      '--security-opt', 'no-new-privileges:true',
      '--cap-drop', 'ALL',
      DOCKER_IMAGE,
      'tail', '-f', '/dev/null',
    ], { timeout: 30000 });

    await execFileAsync(bin, ['start', containerName], { timeout: 15000 });

    const { stdout: idOut } = await execFileAsync(bin, ['ps', '-q', '-f', `name=${containerName}`], { timeout: 5000 });

    const env: SandboxEnv = {
      containerId: idOut.trim(),
      containerName,
      workspacePath: '/workspace',
      createdAt: new Date().toISOString(),
      networkEnabled: false,
    };

    environments.set(containerName, env);
    await saveSandboxState();

    return {
      success: true,
      containerId: env.containerId,
      containerName: env.containerName,
      workspacePath: env.workspacePath,
    };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function createNetworkedSandboxEnvironment(
  options?: { memoryLimit?: string; cpuLimit?: number; network?: string },
): Promise<{
  success: boolean;
  containerId?: string;
  containerName?: string;
  workspacePath?: string;
  error?: string;
}> {
  try {
    const dockerInfo = await detectDocker();
    if (!dockerInfo.available) {
      return {
        success: false,
        error: dockerInfo.error || 'Docker is not available.',
      };
    }

    await ensureSandboxImage();

    const bin = getDockerBin();
    const containerName = `synapse-sandbox-${randomUUID().slice(0, 8)}`;
    const memoryLimit = options?.memoryLimit ?? '512m';
    const cpuLimit = options?.cpuLimit ?? 2;
    const network = options?.network ?? 'bridge';

    await execFileAsync(bin, [
      'create',
      '--name', containerName,
      '--network', network,
      '--memory', memoryLimit,
      '--cpus', String(cpuLimit),
      '--security-opt', 'no-new-privileges:true',
      '--cap-drop', 'ALL',
      DOCKER_IMAGE,
      'tail', '-f', '/dev/null',
    ], { timeout: 30000 });

    await execFileAsync(bin, ['start', containerName], { timeout: 15000 });

    const { stdout: idOut } = await execFileAsync(bin, ['ps', '-q', '-f', `name=${containerName}`], { timeout: 5000 });

    const env: SandboxEnv = {
      containerId: idOut.trim(),
      containerName,
      workspacePath: '/workspace',
      createdAt: new Date().toISOString(),
      networkEnabled: true,
    };

    environments.set(containerName, env);
    await saveSandboxState();

    return {
      success: true,
      containerId: env.containerId,
      containerName: env.containerName,
      workspacePath: env.workspacePath,
    };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

function getActiveEnvironment(containerName?: string): SandboxEnv | undefined {
  if (containerName) return environments.get(containerName);
  let latest: SandboxEnv | undefined;
  for (const env of environments.values()) {
    if (!latest || new Date(env.createdAt) > new Date(latest.createdAt)) {
      latest = env;
    }
  }
  return latest;
}

export async function destroySandboxEnvironment(
  containerName?: string,
): Promise<{ success: boolean; error?: string }> {
  const env = getActiveEnvironment(containerName);
  if (!env) {
    return { success: false, error: 'No active sandbox environment to destroy.' };
  }
  const bin = getDockerBin();
  try {
    await execFileAsync(bin, ['stop', env.containerName], { timeout: 15000 });
    await execFileAsync(bin, ['rm', '-v', env.containerName], { timeout: 15000 });
    environments.delete(env.containerName);
    await saveSandboxState();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function stopSandboxEnvironment(
  containerName?: string,
): Promise<{ success: boolean; error?: string }> {
  const env = getActiveEnvironment(containerName);
  if (!env) {
    return { success: false, error: 'No active sandbox environment to stop.' };
  }
  const bin = getDockerBin();
  try {
    await execFileAsync(bin, ['stop', env.containerName], { timeout: 15000 });
    await saveSandboxState();
    return { success: true, error: undefined };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

// ── Command execution ──────────────────────────────────────────

export async function sandboxExec(
  command: string,
  workdir?: string,
  timeoutMs?: number,
  containerName?: string,
): Promise<CommandResult> {
  const env = getActiveEnvironment(containerName);
  if (!env) {
    return {
      success: false,
      stdout: '',
      stderr: 'No active sandbox environment. Create one with sandbox_environment_create first.',
      exitCode: null,
      timedOut: false,
      executionTimeMs: 0,
    };
  }

  try {
    validateCommand(command);
  } catch (err: any) {
    return {
      success: false,
      stdout: '',
      stderr: err.message,
      exitCode: null,
      timedOut: false,
      executionTimeMs: 0,
    };
  }

  const bin = getDockerBin();
  const startTime = Date.now();
  const timeout = Math.min(timeoutMs ?? 60000, 120000);

  try {
    const execArgs = ['exec', '-i'];
    if (workdir) execArgs.push('-w', workdir);
    execArgs.push(env.containerName, 'sh', '-c', command);

    const result = await execFileAsync(bin, execArgs, {
      timeout,
      maxBuffer: 100 * 1024,
    });

    return {
      success: true,
      stdout: result.stdout || '(no output)',
      stderr: result.stderr || '',
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

// ── File operations via docker exec ────────────────────────────

function execWithStdin(
  bin: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { }
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: null });
    });

    proc.stdin?.end(input);
  });
}

export async function sandboxReadFile(
  filePath: string,
  containerName?: string,
): Promise<FileReadResult> {
  const env = getActiveEnvironment(containerName);
  if (!env) return { success: false, error: 'No active sandbox environment.' };

  const bin = getDockerBin();
  try {
    const result = await execFileAsync(bin, [
      'exec', env.containerName, 'cat', '--', filePath,
    ], { timeout: 10000, maxBuffer: 100 * 1024 });

    if (result.stderr && !result.stdout) return { success: false, error: result.stderr };
    return { success: true, content: result.stdout };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function sandboxWriteFile(
  filePath: string,
  content: string,
  containerName?: string,
): Promise<FileWriteResult> {
  const env = getActiveEnvironment(containerName);
  if (!env) return { success: false, path: filePath, error: 'No active sandbox environment.' };

  const bin = getDockerBin();
  try {
    const dir = path.posix.dirname(filePath);
    await execFileAsync(bin, ['exec', env.containerName, 'mkdir', '-p', '--', dir], { timeout: 10000 });

    const result = await execWithStdin(
      bin,
      ['exec', '-i', env.containerName, 'sh', '-c', `cat > '${filePath.replace(/'/g, "'\\''")}'`],
      content,
      10000,
    );

    if (result.exitCode !== 0 && result.exitCode !== null) {
      return { success: false, path: filePath, error: result.stderr || `Exit code ${result.exitCode}` };
    }
    return { success: true, path: filePath };
  } catch (err: any) {
    return { success: false, path: filePath, error: err.message || String(err) };
  }
}

export async function sandboxListDirectory(
  dirPath: string,
  containerName?: string,
): Promise<ListDirResult> {
  const env = getActiveEnvironment(containerName);
  if (!env) return { success: false, error: 'No active sandbox environment.' };

  const bin = getDockerBin();
  try {
    const result = await execFileAsync(bin, [
      'exec', env.containerName, 'ls', '-1a', '--', dirPath,
    ], { timeout: 10000 });

    if (result.stderr && !result.stdout) return { success: false, error: result.stderr };
    const entries = result.stdout.split('\n').filter((e: string) => e.length > 0);
    return { success: true, entries };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

// ── Status ──────────────────────────────────────────────────────

export interface SandboxStatus {
  dockerAvailable: boolean;
  dockerPath: string | null;
  active: boolean;
  containerName?: string;
  workspacePath?: string;
  createdAt?: string;
  error?: string;
}

export async function getSandboxStatus(containerName?: string): Promise<SandboxStatus> {
  const dockerInfo = await detectDocker();
  const base: SandboxStatus = {
    dockerAvailable: dockerInfo.available,
    dockerPath: dockerInfo.path,
    active: false,
    error: dockerInfo.error ?? undefined,
  };
  if (!dockerInfo.available) return base;
  const env = getActiveEnvironment(containerName);
  if (env) {
    base.active = true;
    base.containerName = env.containerName;
    base.workspacePath = env.workspacePath;
    base.createdAt = env.createdAt;
  }
  return base;
}

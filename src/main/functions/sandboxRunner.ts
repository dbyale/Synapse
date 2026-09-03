import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import fsSync from 'fs';
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
  [
    /docker\s+(exec|run|build|pull|ps)/i,
    'Docker commands are not allowed inside sandbox',
  ],
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

// ── Sandbox runtime settings ────────────────────────────────────

let autoLaunchEnabled = true;
let autoLaunchTimeoutSec = 90;

export function setSandboxAutoLaunch(enabled: boolean): void {
  autoLaunchEnabled = !!enabled;
}

export function setSandboxAutoLaunchTimeout(sec: number): void {
  const n = Math.round(Number(sec));
  if (!Number.isFinite(n)) return;
  autoLaunchTimeoutSec = Math.max(30, Math.min(180, n));
}

export function isSandboxAutoLaunchEnabled(): boolean {
  return autoLaunchEnabled;
}

export function getSandboxAutoLaunchTimeoutSec(): number {
  return autoLaunchTimeoutSec;
}

let dockerPath: string | null | undefined;

export interface DockerInfo {
  available: boolean;
  path: string | null;
  error: string | null;
}

function getDockerBin(): string {
  if (dockerPath && typeof dockerPath === 'string') return dockerPath;
  return process.platform === 'win32' ? 'docker.exe' : 'docker';
}

// ── Linux distro helpers ────────────────────────────────────────

function getLinuxDistroId(): string {
  if (process.platform !== 'linux') return process.platform;
  try {
    const raw: string = fsSync.readFileSync('/etc/os-release', 'utf-8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*ID\s*=\s*"?([^"\n]+)"?\s*$/);
      if (m) return m[1].trim().toLowerCase();
    }
  } catch {
    // ignore — fall through to generic
  }
  return 'linux';
}

function getLinuxDockerInstructions(distroId: string): string {
  const id = distroId.toLowerCase();
  const common = [
    'Docker Desktop (Linux): systemctl --user start docker-desktop  (enable: systemctl --user enable docker-desktop)',
    'Rootless Engine: systemctl --user start docker',
    'Verify: docker info  or  docker ps',
  ];

  let engineCmds: string[];
  if (
    ['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary', 'zorin'].includes(id)
  ) {
    engineCmds = [
      'Docker Engine (systemd): sudo systemctl start docker  (enable on boot: sudo systemctl enable --now docker)',
      'Fallback SysV: sudo service docker start',
      'Install if missing: sudo apt update && sudo apt install docker.io   (or https://docs.docker.com/engine/install/)',
    ];
  } else if (
    ['fedora', 'rhel', 'centos', 'rocky', 'almalinux', 'ol'].includes(id)
  ) {
    engineCmds = [
      'Docker Engine (systemd): sudo systemctl start docker  (enable: sudo systemctl enable --now docker)',
      'Install if missing: sudo dnf install moby-engine docker-compose-plugin  (or https://docs.docker.com/engine/install/fedora/)',
    ];
  } else if (['arch', 'manjaro', 'endeavouros', 'garuda'].includes(id)) {
    engineCmds = [
      'Docker Engine (systemd): sudo systemctl start docker  (also: sudo systemctl start docker.socket; enable: sudo systemctl enable --now docker)',
      'Install if missing: sudo pacman -S docker  (https://wiki.archlinux.org/title/Docker)',
    ];
  } else if (
    id.startsWith('opensuse') ||
    id === 'sles' ||
    id === 'opensuse-tumbleweed' ||
    id === 'opensuse-leap'
  ) {
    engineCmds = [
      'Docker Engine (systemd): sudo systemctl start docker  (enable: sudo systemctl enable --now docker)',
      'Install if missing: sudo zypper install docker  (https://docs.docker.com/engine/install/opensuse/)',
    ];
  } else if (['gentoo'].includes(id)) {
    engineCmds = [
      'OpenRC: sudo rc-service docker start  (systemd: sudo systemctl start docker)',
      'Install if missing: emerge --ask app-containers/docker',
    ];
  } else if (['nixos'].includes(id)) {
    engineCmds = [
      'NixOS: add services.docker.enable = true; to configuration.nix then sudo nixos-rebuild switch, or sudo systemctl start docker',
    ];
  } else if (['alpine'].includes(id)) {
    engineCmds = [
      'Alpine: sudo rc-service docker start  (enable: sudo rc-update add docker default)',
      'Install if missing: sudo apk add docker',
    ];
  } else {
    engineCmds = [
      'Docker Engine (systemd): sudo systemctl start docker  (enable: sudo systemctl enable --now docker)',
      'Fallback SysV/OpenRC: sudo service docker start  /  sudo rc-service docker start',
    ];
  }

  const lines = [
    '',
    'On Linux, start the Docker daemon with ONE of:',
    ...engineCmds.map((c) => `  • ${c}`),
    ...common.map((c) => `  • ${c}`),
    '',
    'Then retry sandbox_environment_create. On Linux, Sandbox Settings shows distro-specific instructions — automatic start is disabled on this platform.',
    'If you installed Docker Desktop, ensure it is running; otherwise ensure the Engine service is active.',
  ];
  return lines.join('\n');
}

function buildLinuxBinaryNotFoundError(): string {
  const distroId = getLinuxDistroId();
  const instructions = getLinuxDockerInstructions(distroId);
  return `Docker binary not found in PATH or common install locations.${instructions}`;
}

function buildLinuxDaemonError(
  dockerPathVal: string,
  originalMsg: string,
): string {
  const distroId = getLinuxDistroId();
  const instructions = getLinuxDockerInstructions(distroId);
  return `Docker binary found at "${dockerPathVal}" but daemon is unreachable: ${originalMsg}${instructions}`;
}

// ── Docker Desktop auto-launch (non-Linux) ──────────────────────

let dockerLaunchInProgress: Promise<boolean> | null = null;

function getDockerDesktopPaths(): string[] {
  const plat = process.platform;
  if (plat === 'win32') {
    const paths: string[] = [];
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 =
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    paths.push(
      path.join(programFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
      path.join(programFilesX86, 'Docker', 'Docker', 'Docker Desktop.exe'),
    );
    if (localAppData) {
      paths.push(path.join(localAppData, 'Docker', 'Docker Desktop.exe'));
    }
    // Common alternate seen in some installs
    paths.push('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe');
    return [...new Set(paths)];
  }
  if (plat === 'darwin') {
    return [
      '/Applications/Docker.app/Contents/MacOS/Docker Desktop',
      '/Applications/Docker.app/Contents/MacOS/Docker',
      '/Applications/Docker.app',
    ];
  }
  return [];
}

function findDockerDesktopPath(): string | null {
  for (const p of getDockerDesktopPaths()) {
    try {
      if (fsSync.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function isDockerDesktopInstalled(): boolean {
  return findDockerDesktopPath() !== null;
}

async function launchDockerDesktop(): Promise<boolean> {
  const plat = process.platform;
  const desktopPath = findDockerDesktopPath();

  try {
    if (plat === 'win32') {
      if (!desktopPath) return false;
      console.log(`[sandbox] Launching Docker Desktop: "${desktopPath}"`);
      // Use detached spawn so Electron doesn't wait
      const child = spawn(`"${desktopPath}"`, [], {
        shell: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      } as any);
      child.unref();
      return true;
    }
    if (plat === 'darwin') {
      if (desktopPath) {
        // Prefer `open -a Docker` for .app bundles, direct spawn for binary
        if (desktopPath.endsWith('.app')) {
          console.log('[sandbox] Launching Docker Desktop via open -a Docker');
          const child = spawn('open', ['-a', 'Docker'], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          return true;
        }
        console.log(`[sandbox] Launching Docker Desktop: "${desktopPath}"`);
        const child = spawn(desktopPath, [], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return true;
      }
      // Fallback: try open -a Docker even if path not found
      console.log(
        '[sandbox] Launching Docker Desktop via open -a Docker (fallback)',
      );
      const child = spawn('open', ['-a', 'Docker'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return true;
    }
  } catch (err) {
    console.error('[sandbox] Failed to launch Docker Desktop:', err);
    return false;
  }
  return false;
}

async function waitForDockerDaemon(
  timeoutMs: number,
  intervalMs = 2000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const bin = getDockerBin();
  while (Date.now() < deadline) {
    try {
      await execFileAsync(bin, ['info', '--format', '{{.ServerVersion}}'], {
        timeout: 5000,
      });
      console.log('[sandbox] Docker daemon is now reachable');
      return true;
    } catch {
      // not ready yet
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)));
  }
  return false;
}

async function attemptAutoLaunchAndWait(): Promise<DockerInfo> {
  if (process.platform === 'linux') {
    // Linux is instructions-only — never auto-launch
    return {
      available: false,
      path: dockerPath as string | null,
      error: buildLinuxDaemonError(
        String(dockerPath),
        'Daemon unreachable and auto-launch is disabled on Linux.',
      ),
    };
  }

  if (!autoLaunchEnabled) {
    return {
      available: false,
      path: dockerPath as string | null,
      error: `Docker binary found at "${dockerPath}" but daemon is unreachable. Auto-launch is disabled in Sandbox Settings.`,
    };
  }

  if (!isDockerDesktopInstalled()) {
    return {
      available: false,
      path: dockerPath as string | null,
      error: `Docker binary found at "${dockerPath}" but daemon is unreachable and Docker Desktop is not installed at known locations (${getDockerDesktopPaths().join(', ')}). Please start the Docker daemon or install Docker Desktop.`,
    };
  }

  if (dockerLaunchInProgress) {
    console.log(
      '[sandbox] Docker Desktop launch already in progress, waiting...',
    );
    const ok = await dockerLaunchInProgress;
    if (ok) {
      try {
        await execFileAsync(
          getDockerBin(),
          ['info', '--format', '{{.ServerVersion}}'],
          { timeout: 10000 },
        );
        return { available: true, path: dockerPath as string, error: null };
      } catch (err: any) {
        return {
          available: false,
          path: dockerPath as string | null,
          error: `Docker Desktop was launched but daemon is still unreachable: ${err.message || String(err)}`,
        };
      }
    }
    return {
      available: false,
      path: dockerPath as string | null,
      error: `Failed to launch Docker Desktop (concurrent launch failed).`,
    };
  }

  const timeoutMs = Math.max(30, Math.min(180, autoLaunchTimeoutSec)) * 1000;
  console.log(
    `[sandbox] Docker daemon unreachable — auto-launching Docker Desktop (timeout ${timeoutMs}ms)`,
  );

  dockerLaunchInProgress = (async () => {
    const launched = await launchDockerDesktop();
    if (!launched) return false;
    const ready = await waitForDockerDaemon(timeoutMs);
    return ready;
  })();

  let launchedOk = false;
  try {
    launchedOk = await dockerLaunchInProgress;
  } finally {
    dockerLaunchInProgress = null;
  }

  if (launchedOk) {
    try {
      await execFileAsync(
        getDockerBin(),
        ['info', '--format', '{{.ServerVersion}}'],
        { timeout: 10000 },
      );
      return { available: true, path: dockerPath as string, error: null };
    } catch (err: any) {
      return {
        available: false,
        path: dockerPath as string | null,
        error: `Docker Desktop was launched but daemon did not become ready within ${autoLaunchTimeoutSec}s: ${err.message || String(err)}`,
      };
    }
  }

  return {
    available: false,
    path: dockerPath as string | null,
    error: `Docker Desktop was launched but daemon did not become ready within ${autoLaunchTimeoutSec}s. Please open Docker Desktop manually and retry.`,
  };
}

// ── Docker detection ────────────────────────────────────────────

export async function detectDocker(): Promise<DockerInfo> {
  if (dockerPath === undefined) {
    const candidates = ['docker', 'docker.exe'];
    for (const bin of candidates) {
      try {
        const { stdout } = await execFileAsync(bin, ['--version'], {
          timeout: 5000,
        });
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
    if (process.platform === 'linux') {
      const err = buildLinuxBinaryNotFoundError();
      console.error(`[sandbox] ${err}`);
      return { available: false, path: null, error: err };
    }
    return {
      available: false,
      path: null,
      error: 'Docker binary not found in PATH or common install locations.',
    };
  }

  // Verify daemon is reachable
  try {
    await execFileAsync(
      dockerPath,
      ['info', '--format', '{{.ServerVersion}}'],
      { timeout: 10000 },
    );
    return { available: true, path: dockerPath, error: null };
  } catch (err: any) {
    // Linux: instructions-only
    if (process.platform === 'linux') {
      const msg = buildLinuxDaemonError(
        String(dockerPath),
        err.message || String(err),
      );
      console.error(`[sandbox] ${msg}`);
      return { available: false, path: dockerPath, error: msg };
    }

    // Non-Linux: attempt auto-launch if enabled and Desktop is installed
    const originalMsg = err.message || String(err);
    if (autoLaunchEnabled && isDockerDesktopInstalled()) {
      console.log(
        `[sandbox] Daemon unreachable at "${dockerPath}" — attempting auto-launch (timeout ${autoLaunchTimeoutSec}s)`,
      );
      const launched = await attemptAutoLaunchAndWait();
      if (launched.available) return launched;
      // fall through to return launched error (includes timeout details)
      console.error(`[sandbox] ${launched.error}`);
      return launched;
    }

    const msg = `Docker binary found at "${dockerPath}" but daemon is unreachable: ${originalMsg}`;
    console.error(`[sandbox] ${msg}`);
    // Append hint about setting when not launching
    const hint = autoLaunchEnabled
      ? ' Docker Desktop not found at known locations; please start it manually.'
      : ' Auto-launch is disabled in Sandbox Settings — enable it to start Docker Desktop automatically.';
    return { available: false, path: dockerPath, error: msg + hint };
  }
}

export async function checkDockerAvailable(): Promise<boolean> {
  const info = await detectDocker();
  return info.available;
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
    await fs.writeFile(
      sandboxStatePath(),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
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
        const { stdout } = await execFileAsync(
          bin,
          ['ps', '-a', '-q', '-f', `name=${saved.containerName}`],
          { timeout: 5000 },
        );
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

export async function shutdownAllSandboxes(): Promise<{
  stopped: number;
  errors: string[];
}> {
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
  console.log(
    `[sandbox] Shutdown: stopped ${stopped} container(s), ${errors.length} error(s)`,
  );
  return { stopped, errors };
}

export async function getSavedEnvironments(): Promise<
  Array<{
    containerName: string;
    workspacePath: string;
    createdAt: string;
    networkEnabled: boolean;
    status: string;
  }>
> {
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
      const { stdout } = await execFileAsync(
        bin,
        [
          'ps',
          '-a',
          '--format',
          '{{.Status}}',
          '-f',
          `name=${env.containerName}`,
        ],
        { timeout: 5000 },
      );
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

export async function startSandboxEnvironment(containerName: string): Promise<{
  success: boolean;
  containerId?: string;
  containerName?: string;
  workspacePath?: string;
  error?: string;
}> {
  const env = environments.get(containerName);
  if (!env) {
    return {
      success: false,
      error: `No saved environment with name "${containerName}".`,
    };
  }

  const bin = getDockerBin();
  try {
    await execFileAsync(bin, ['start', containerName], { timeout: 15000 });
    const { stdout: idOut } = await execFileAsync(
      bin,
      ['ps', '-q', '-f', `name=${containerName}`],
      { timeout: 5000 },
    );
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
    await execFileAsync(bin, ['image', 'inspect', DOCKER_IMAGE], {
      timeout: 10000,
    });
  } catch {
    const tempName = `synapse-sandbox-temp-${randomUUID().slice(0, 8)}`;
    try {
      await execFileAsync(bin, ['pull', 'alpine:latest'], { timeout: 120000 });
      await execFileAsync(
        bin,
        [
          'create',
          '--name',
          tempName,
          'alpine:latest',
          'tail',
          '-f',
          '/dev/null',
        ],
        { timeout: 15000 },
      );
      await execFileAsync(bin, ['start', tempName], { timeout: 15000 });
      await execFileAsync(
        bin,
        [
          'exec',
          tempName,
          'apk',
          'add',
          '--no-cache',
          'git',
          'bash',
          'coreutils',
          'findutils',
        ],
        { timeout: 120000 },
      );
      await execFileAsync(bin, ['commit', tempName, DOCKER_IMAGE], {
        timeout: 30000,
      });
    } finally {
      try {
        await execFileAsync(bin, ['rm', '-f', tempName], { timeout: 10000 });
      } catch {}
    }
  }
}

export async function createSandboxEnvironment(options?: {
  memoryLimit?: string;
  cpuLimit?: number;
}): Promise<{
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

    await execFileAsync(
      bin,
      [
        'create',
        '--name',
        containerName,
        '--network',
        'none',
        '--memory',
        memoryLimit,
        '--cpus',
        String(cpuLimit),
        '--security-opt',
        'no-new-privileges:true',
        '--cap-drop',
        'ALL',
        DOCKER_IMAGE,
        'tail',
        '-f',
        '/dev/null',
      ],
      { timeout: 30000 },
    );

    await execFileAsync(bin, ['start', containerName], { timeout: 15000 });

    const { stdout: idOut } = await execFileAsync(
      bin,
      ['ps', '-q', '-f', `name=${containerName}`],
      { timeout: 5000 },
    );

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

export async function createNetworkedSandboxEnvironment(options?: {
  memoryLimit?: string;
  cpuLimit?: number;
  network?: string;
}): Promise<{
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

    await execFileAsync(
      bin,
      [
        'create',
        '--name',
        containerName,
        '--network',
        network,
        '--memory',
        memoryLimit,
        '--cpus',
        String(cpuLimit),
        '--security-opt',
        'no-new-privileges:true',
        '--cap-drop',
        'ALL',
        DOCKER_IMAGE,
        'tail',
        '-f',
        '/dev/null',
      ],
      { timeout: 30000 },
    );

    await execFileAsync(bin, ['start', containerName], { timeout: 15000 });

    const { stdout: idOut } = await execFileAsync(
      bin,
      ['ps', '-q', '-f', `name=${containerName}`],
      { timeout: 5000 },
    );

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
    return {
      success: false,
      error: 'No active sandbox environment to destroy.',
    };
  }
  const bin = getDockerBin();
  try {
    await execFileAsync(bin, ['stop', env.containerName], { timeout: 15000 });
    await execFileAsync(bin, ['rm', '-v', env.containerName], {
      timeout: 15000,
    });
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

export async function renameSandboxEnvironment(
  containerName: string,
  newNameRaw: string,
): Promise<{ success: boolean; containerName?: string; error?: string }> {
  const env = environments.get(containerName);
  if (!env) {
    return {
      success: false,
      error: `No saved environment with name "${containerName}".`,
    };
  }

  const newName = newNameRaw.startsWith('synapse-')
    ? newNameRaw
    : `synapse-${newNameRaw}`;

  if (environments.has(newName)) {
    return {
      success: false,
      error: `An environment with name "${newName}" already exists.`,
    };
  }

  const bin = getDockerBin();
  try {
    await execFileAsync(bin, ['rename', containerName, newName], {
      timeout: 15000,
    });

    environments.delete(containerName);
    env.containerName = newName;
    environments.set(newName, env);
    await saveSandboxState();

    return { success: true, containerName: newName };
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
      stderr:
        'No active sandbox environment. Create one with sandbox_environment_create first.',
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
    const proc = spawn(bin, args, {
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {}
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

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

let maxReadSize = 40000;

export function setSandboxMaxReadSize(size: number): void {
  maxReadSize = size;
}

export async function sandboxReadFile(
  filePath: string,
  containerName?: string,
): Promise<FileReadResult> {
  const env = getActiveEnvironment(containerName);
  if (!env) return { success: false, error: 'No active sandbox environment.' };

  const bin = getDockerBin();
  try {
    const result = await execFileAsync(
      bin,
      ['exec', env.containerName, 'cat', '--', filePath],
      { timeout: 10000, maxBuffer: 100 * 1024 },
    );

    if (result.stderr && !result.stdout)
      return { success: false, error: result.stderr };
    if (result.stdout.length > maxReadSize) {
      return {
        success: true,
        content: `Warning: Operation over ${maxReadSize} characters and may overload context. If reading this file is necessary, use offsets and limits to read smaller sections`,
      };
    }
    return { success: true, content: result.stdout };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

export interface SandboxImageResult {
  success: boolean;
  dataUrl?: string;
  mimeType?: string;
  error?: string;
}

export async function sandboxReadImageAsDataUrl(
  filePath: string,
  containerName?: string,
): Promise<SandboxImageResult> {
  const env = getActiveEnvironment(containerName);
  if (!env) return { success: false, error: 'No active sandbox environment.' };

  const mimeType = IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mimeType) {
    return {
      success: false,
      error: `Not a recognized image file: ${filePath} (supported extensions: png, jpg, jpeg, gif, webp, bmp, tiff)`,
    };
  }

  const bin = getDockerBin();
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['exec', env.containerName, 'base64', filePath],
      { timeout: 30000, maxBuffer: 200 * 1024 * 1024 },
    );
    const base64 = stdout.replace(/\s+/g, '');
    return {
      success: true,
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
    };
  } catch (err: any) {
    return { success: false, error: err.stderr || err.message || String(err) };
  }
}

function generateDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diffs: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i] ?? '';
    const newLine = newLines[i] ?? '';
    if (oldLine !== newLine) {
      if (oldLine) diffs.push(`- ${oldLine}`);
      if (newLine) diffs.push(`+ ${newLine}`);
    }
  }
  return diffs.length > 0 ? diffs.join('\n') : '(no changes)';
}

export interface FileEditResult {
  success: boolean;
  diff?: string;
  message?: string;
  error?: string;
}

export async function sandboxEditFile(params: {
  filePath: string;
  edits: Array<{ oldText: string; newText: string }>;
  dryRun?: boolean;
  containerName?: string;
}): Promise<FileEditResult> {
  try {
    if (!params || typeof params !== 'object') {
      return {
        success: false,
        error: 'sandboxEditFile requires a params object',
      };
    }
    if (typeof params.filePath !== 'string' || params.filePath === '') {
      return { success: false, error: 'filePath must be a non-empty string' };
    }
    if (!Array.isArray(params.edits) || params.edits.length === 0) {
      return {
        success: false,
        error:
          'edits must be a non-empty array of { oldText, newText } objects',
      };
    }
    const readResult = await sandboxReadFile(
      params.filePath,
      params.containerName,
    );
    if (!readResult.success || readResult.content === undefined) {
      return {
        success: false,
        error: readResult.error || `File not found: ${params.filePath}`,
      };
    }

    const originalContent = readResult.content;

    for (let i = 0; i < params.edits.length; i++) {
      const edit = params.edits[i];
      if (typeof edit.oldText !== 'string' || edit.oldText === '') {
        return {
          success: false,
          error: `Edit ${i}: oldText must be a non-empty string`,
        };
      }
      if (typeof edit.newText !== 'string') {
        return { success: false, error: `Edit ${i}: newText must be a string` };
      }
      const origMatches = originalContent.split(edit.oldText);
      const origCount = origMatches.length - 1;
      if (origCount === 0) {
        return {
          success: false,
          error: `Edit ${i}: oldText not found in file: ${edit.oldText}`,
        };
      }
      if (origCount > 1) {
        return {
          success: false,
          error: `Edit ${i}: oldText matches multiple times (${origCount}) in file, model must be more specific: ${edit.oldText}`,
        };
      }
    }

    let content = originalContent;

    for (const edit of params.edits) {
      const matches = content.split(edit.oldText);
      const matchCount = matches.length - 1;
      if (matchCount === 0) {
        return {
          success: false,
          error: `Edit failed: oldText no longer exists in file after applying previous edits: ${edit.oldText}`,
        };
      }
      if (matchCount > 1) {
        return {
          success: false,
          error: `Edit failed: previous edits caused oldText to match multiple times (${matchCount}) in file: ${edit.oldText}`,
        };
      }
      content = matches.join(edit.newText);
    }

    const diff = generateDiff(originalContent, content);

    if (!params.dryRun) {
      const writeResult = await sandboxWriteFile(
        params.filePath,
        content,
        params.containerName,
      );
      if (!writeResult.success) {
        return {
          success: false,
          error: writeResult.error || 'Failed to write file',
        };
      }
    }

    return {
      success: true,
      diff,
      message: params.dryRun
        ? 'DRY RUN: Changes not applied'
        : 'File edited successfully',
    };
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
  if (!env)
    return {
      success: false,
      path: filePath,
      error: 'No active sandbox environment.',
    };

  const bin = getDockerBin();
  try {
    const dir = path.posix.dirname(filePath);
    await execFileAsync(
      bin,
      ['exec', env.containerName, 'mkdir', '-p', '--', dir],
      { timeout: 10000 },
    );

    const result = await execWithStdin(
      bin,
      [
        'exec',
        '-i',
        env.containerName,
        'sh',
        '-c',
        `cat > '${filePath.replace(/'/g, "'\\''")}'`,
      ],
      content,
      10000,
    );

    if (result.exitCode !== 0 && result.exitCode !== null) {
      return {
        success: false,
        path: filePath,
        error: result.stderr || `Exit code ${result.exitCode}`,
      };
    }
    return { success: true, path: filePath };
  } catch (err: any) {
    return {
      success: false,
      path: filePath,
      error: err.message || String(err),
    };
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
    const result = await execFileAsync(
      bin,
      ['exec', env.containerName, 'ls', '-1a', '--', dirPath],
      { timeout: 10000 },
    );

    if (result.stderr && !result.stdout)
      return { success: false, error: result.stderr };
    const entries = result.stdout
      .split('\n')
      .filter((e: string) => e.length > 0);
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

export async function getSandboxStatus(
  containerName?: string,
): Promise<SandboxStatus> {
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

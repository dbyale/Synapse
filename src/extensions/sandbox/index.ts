import type { ExtensionToolDef } from '../types';
import {
  checkDockerAvailable,
  createSandboxEnvironment,
  createNetworkedSandboxEnvironment,
  destroySandboxEnvironment,
  stopSandboxEnvironment,
  startSandboxEnvironment,
  getSavedEnvironments,
  sandboxExec,
  sandboxReadFile,
  sandboxWriteFile,
  sandboxListDirectory,
  getSandboxStatus,
} from '../../main/functions/sandboxRunner';
import manifest from './manifest.json';

export const tools: Record<string, ExtensionToolDef> = {
  sandbox_environment_create: {
    meta: {
      name: 'sandbox_environment_create',
      label: 'Create Sandbox Environment',
      description: 'Create a new Docker-based sandboxed environment for safe code execution.',
      descriptionForModel:
        'Create a new sandboxed virtual environment using Docker. All subsequent commands (shell, file operations, git) run inside this container, completely isolated from the host system.\n' +
        '\n' +
        'PURPOSE — use this tool to:\n' +
        '  • Create a safe, isolated workspace where the model has full control\n' +
        '  • Execute untrusted code or experiments without risk to the host\n' +
        '  • Run git operations, shell commands, and file read/write in a sandbox\n' +
        '\n' +
        'SANDBOX PROPERTIES:\n' +
        '  • No host bind mount — the container filesystem is completely isolated from the host\n' +
        '  • Full writable filesystem via Docker overlay — uses host disk, no artificial size limit\n' +
        '  • No network access — containers run with --network none\n' +
        '  • All capabilities dropped — no privilege escalation possible\n' +
        '  • Memory and CPU limits applied\n' +
        '  • Git, bash, coreutils, and findutils pre-installed\n' +
        '\n' +
        'IMPORTANT: Destroying this container with sandbox_environment_destroy permanently deletes ALL files inside it. There is no host-side copy. All work is lost on destroy.\n' +
        '\n' +
        'USAGE:\n' +
        '  1. Call sandbox_environment_create (no arguments needed)\n' +
        '  2. Use sandbox_run_command for shell/git operations\n' +
        '  3. Use sandbox_read/write_file for file operations\n' +
        '  4. Call sandbox_environment_destroy when done (this permanently deletes everything)\n' +
        '\n' +
        'NOTE: Docker Desktop must be installed on the host system.',
      icon: 'ShieldPlus',
    },
    params: {
      type: 'object',
      properties: {
        memory_limit: {
          type: 'string',
          description: 'Memory limit for the container (e.g., "512m", "1g"). Default: "512m".',
        },
        cpu_limit: {
          type: 'number',
          description: 'CPU limit for the container (number of CPUs). Default: 2.',
        },
      },
    },
    async handler(params: { memory_limit?: string; cpu_limit?: number }) {
      return await createSandboxEnvironment({
        memoryLimit: params.memory_limit,
        cpuLimit: params.cpu_limit,
      });
    },
  },

  sandbox_environment_create_networked: {
    meta: {
      name: 'sandbox_environment_create_networked',
      label: 'Create Networked Sandbox Environment',
      description: 'Create a sandbox environment with network access for cloning repos, installing packages, etc.',
      descriptionForModel:
        'Create a sandboxed virtual environment with network access. Unlike sandbox_environment_create (which has --network none), this container can reach the internet.\n' +
        '\n' +
        'PURPOSE — use this tool to:\n' +
        '  • Clone git repositories from remote URLs\n' +
        '  • Install packages via npm, pip, apk, or other package managers\n' +
        '  • Download files or data from the internet\n' +
        '  • Run code that requires API access or network calls\n' +
        '\n' +
        'PROPERTIES:\n' +
        '  • Network enabled (default Docker bridge network)\n' +
        '  • No host bind mount — the container filesystem is completely isolated from the host\n' +
        '  • Full writable filesystem via Docker overlay — uses host disk, no artificial size limit\n' +
        '  • All capabilities dropped — no privilege escalation possible\n' +
        '  • Memory and CPU limits applied\n' +
        '  • Git, bash, coreutils, and findutils pre-installed\n' +
        '\n' +
        'IMPORTANT: Destroying this container with sandbox_environment_destroy permanently deletes ALL files inside it. There is no host-side copy. All work is lost on destroy.\n' +
        '\n' +
        'USAGE:\n' +
        '  1. Call sandbox_environment_create_networked (no arguments needed)\n' +
        '  2. Clone repos, install packages via sandbox_run_command\n' +
        '  3. Use sandbox_read/write_file for file operations\n' +
        '  4. Call sandbox_environment_destroy when done (this permanently deletes everything)\n' +
        '\n' +
        'SECURITY NOTE: This container has network access but no host filesystem access. Use sandbox_environment_create (no network) when you only need local file operations for maximum isolation.',
      icon: 'Globe',
    },
    params: {
      type: 'object',
      properties: {
        network: {
          type: 'string',
          description: 'Docker network to use (optional, default "bridge"). Use "host" for host networking if needed.',
        },
        memory_limit: {
          type: 'string',
          description: 'Memory limit for the container (e.g., "512m", "1g"). Default: "512m".',
        },
        cpu_limit: {
          type: 'number',
          description: 'CPU limit for the container (number of CPUs). Default: 2.',
        },
      },
    },
    async handler(params: { network?: string; memory_limit?: string; cpu_limit?: number }) {
      return await createNetworkedSandboxEnvironment({
        network: params.network,
        memoryLimit: params.memory_limit,
        cpuLimit: params.cpu_limit,
      });
    },
  },

  sandbox_environment_destroy: {
    meta: {
      name: 'sandbox_environment_destroy',
      label: 'Destroy Sandbox Environment',
      description: 'Permanently delete the sandbox container and ALL files inside it.',
      descriptionForModel:
        'DESTROY the currently active sandbox environment. This stops and removes the Docker container, permanently deleting ALL files inside it. There is no host-side copy — everything in the container is gone forever.\n' +
        '\n' +
        '⚠️  DATA LOSS WARNING: The container uses a Docker overlay filesystem for storage. Destroying the container deletes the overlay layer, permanently removing all files, git history, installed packages, and working state. Nothing is saved on the host.\n' +
        '\n' +
        'Only call this when you are completely done and the user has confirmed they do not need any of the files inside.\n' +
        'If you want to pause work and resume later, use sandbox_environment_stop instead (stops the container but keeps files intact for later restart).',
      icon: 'ShieldOff',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      return await destroySandboxEnvironment();
    },
  },

  sandbox_environment_stop: {
    meta: {
      name: 'sandbox_environment_stop',
      label: 'Stop Sandbox Environment',
      description: 'Stop the active sandbox container and save its state without deleting it.',
      descriptionForModel:
        'Stop the currently active sandbox environment and save its state. The Docker container is preserved — it will appear in sandbox_environment_list_saved and can be resumed later with sandbox_environment_start.\n' +
        '\n' +
        'NOTE: The container uses a Docker overlay filesystem for storage. Files survive docker stop and are available again after docker start. Data is NOT lost on stop.\n' +
        '\n' +
        'Use this when you want to pause work and resume in a future session. The container retains all files, installed packages, and git state across restarts.\n' +
        '\n' +
        'DIFFERENCE FROM DESTROY:\n' +
        '  • sandbox_environment_stop  → docker stop + save (container kept, files preserved)\n' +
        '  • sandbox_environment_destroy → docker stop + docker rm + state removed (permanent deletion)',
      icon: 'Pause',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      return await stopSandboxEnvironment();
    },
  },

  sandbox_environment_list_saved: {
    meta: {
      name: 'sandbox_environment_list_saved',
      label: 'List Saved Environments',
      description: 'List all saved sandbox environments that can be restarted.',
      descriptionForModel:
        'List all previously created sandbox environments that are persisted on disk. Each entry shows the container name, workspace path, creation time, whether it has network access, and its current Docker status (e.g. "Up 2 hours" or "Exited (0) 5 minutes ago").\n' +
        '\n' +
        'Use this to discover environments from previous sessions. If an environment is stopped, restart it with sandbox_environment_start.\n' +
        '\n' +
        'Environments are persisted across app restarts and are stopped gracefully when the application exits.',
      icon: 'Archive',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      return await getSavedEnvironments();
    },
  },

  sandbox_environment_start: {
    meta: {
      name: 'sandbox_environment_start',
      label: 'Start Saved Environment',
      description: 'Start a saved sandbox environment that was previously stopped.',
      descriptionForModel:
        'Start a previously created sandbox environment that is currently stopped. Use sandbox_environment_list_saved first to find available environments.\n' +
        '\n' +
        'After starting, the environment becomes the active sandbox — all subsequent sandbox_run_command, sandbox_read_file, sandbox_write_file, and sandbox_list_directory calls will operate inside it.\n' +
        '\n' +
        'NOTE: The overlay filesystem preserves all files across stop/start. Any files, git repos, or installed packages from the previous session are still available.',
      icon: 'Play',
    },
    params: {
      type: 'object',
      properties: {
        container_name: {
          type: 'string',
          description: 'Name of the saved container to start (from sandbox_environment_list_saved output).',
        },
      },
      required: ['container_name'],
    },
    async handler(params: { container_name: string }) {
      return await startSandboxEnvironment(params.container_name);
    },
  },

  sandbox_run_command: {
    meta: {
      name: 'sandbox_run_command',
      label: 'Run Sandbox Command',
      description: 'Execute a shell command inside the sandbox container.',
      descriptionForModel:
        'Execute a shell command inside the active sandbox container. Supports full shell syntax (pipes, redirects, chaining).\n' +
        '\n' +
        'The container must be running — use sandbox_environment_start if it is stopped.\n' +
        '\n' +
        'PURPOSE — use this tool to:\n' +
        '  • Run git operations (git status, git diff, git commit, etc.)\n' +
        '  • Install packages inside the sandbox (npm, pip, apk, etc.)\n' +
        '  • Build, test, and run code within the isolated environment\n' +
        '  • Perform filesystem operations using shell commands\n' +
        '\n' +
        'SECURITY:\n' +
        '  • All commands run inside the Docker container, not on the host\n' +
        '  • Static analysis blocks dangerous escape attempts before execution\n' +
        '  • Network access depends on how the environment was created (none for isolated, bridge for networked)\n' +
        '  • 60-second timeout by default (max 120s)\n' +
        '  • Output capped at 100 KB\n' +
        '\n' +
        'NOTES:\n' +
        '  • Working directory defaults to /workspace\n' +
        '  • The container has a full writable overlay filesystem — files can be created anywhere\n' +
        '  • Destroying the container deletes ALL files permanently — no host-side backup',
      icon: 'Terminal',
    },
    params: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute inside the sandbox container.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory inside the container (optional, defaults to /workspace).',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (optional, default 60000, max 120000).',
        },
      },
      required: ['command'],
    },
    async handler(params: { command: string; workdir?: string; timeout?: number }) {
      return await sandboxExec(params.command, params.workdir, params.timeout);
    },
  },

  sandbox_read_file: {
    meta: {
      name: 'sandbox_read_file',
      label: 'Read Sandbox File',
      description: 'Read a file from inside the sandbox container.',
      descriptionForModel:
        'Read the contents of a file located inside the sandbox container.\n' +
        '\n' +
        'All files are inside the container only — there is no host filesystem access.\n' +
        'Output is capped at 100 KB.',
      icon: 'FileText',
    },
    params: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file inside the container (e.g., /workspace/myfile.txt).',
        },
      },
      required: ['path'],
    },
    async handler(params: { path: string }) {
      return await sandboxReadFile(params.path);
    },
  },

  sandbox_write_file: {
    meta: {
      name: 'sandbox_write_file',
      label: 'Write Sandbox File',
      description: 'Write content to a file inside the sandbox container.',
      descriptionForModel:
        'Create or overwrite a file inside the sandbox container. Parent directories are created automatically.\n' +
        '\n' +
        'All files stay inside the container only — there is no host filesystem access.\n' +
        'The container\'s overlay filesystem uses host disk space, but files are invisible from the host.\n' +
        'Destroying the container permanently deletes these files.',
      icon: 'Edit',
    },
    params: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path inside the container where the file will be written (e.g., /workspace/myfile.txt).',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
    async handler(params: { path: string; content: string }) {
      return await sandboxWriteFile(params.path, params.content);
    },
  },

  sandbox_list_directory: {
    meta: {
      name: 'sandbox_list_directory',
      label: 'List Sandbox Directory',
      description: 'List the contents of a directory inside the sandbox container.',
      descriptionForModel:
        'List all files and directories inside a given path in the sandbox container.\n' +
        'Returns one entry per line, including hidden files.',
      icon: 'Folder',
    },
    params: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path inside the container to list (e.g., /workspace).',
        },
      },
      required: ['path'],
    },
    async handler(params: { path: string }) {
      return await sandboxListDirectory(params.path);
    },
  },

  sandbox_environment_status: {
    meta: {
      name: 'sandbox_environment_status',
      label: 'Sandbox Environment Status',
      description: 'Check if Docker is available and whether a sandbox environment is active.',
      descriptionForModel:
        'Check the status of the sandbox system:\n' +
        '  • Whether Docker is available and running\n' +
        '  • Whether a sandbox environment is currently active\n' +
        '  • The active container name and workspace path if one exists\n' +
        '\n' +
        'Call this first to determine if you need to create a sandbox environment.',
      icon: 'ShieldCheck',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      return await getSandboxStatus();
    },
  },
};

export { manifest };

import type { ExtensionToolDef } from '../types';
import { runShellCommand, getShellEnvironmentInfo } from '../../main/functions/shellRunner';
import manifest from './manifest.json';

export const tools: Record<string, ExtensionToolDef> = {
  request_shell_command: {
    meta: {
      name: 'request_shell_command',
      label: 'Request Shell Command',
      description: 'Ask the user to approve running a shell command.',
      descriptionForModel:
        'Ask the user to approve a shell command before it runs. ' +
        'Use this instead of run_shell_command when the command could have side effects ' +
        '(modifying files, installing packages, running network operations, etc.). ' +
        'The user will see the command and can choose Allow or Deny. ' +
        'Always explain why you need to run the command before calling this tool.',
      icon: 'Shield',
    },
    params: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to ask the user about.',
        },
        explanation: {
          type: 'string',
          description: 'Brief explanation of why this command needs to run.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory for the command (optional).',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (optional, default 30000, max 60000).',
        },
      },
      required: ['command'],
    },
    async handler(params: { command: string; explanation?: string; workdir?: string; timeout?: number; _confirmed?: boolean }) {
      if (!params._confirmed) {
        return {
          _userInput: {
            type: 'confirm',
            prompt: params.explanation || 'Run this command?',
            options: undefined,
            allowOther: undefined,
          },
        };
      }
      const timeout = Math.min(params.timeout ?? 30000, 60000);
      return await runShellCommand(params.command, params.workdir, timeout);
    },
  },
  get_shell_info: {
    meta: {
      name: 'get_shell_info',
      label: 'Shell Environment Info',
      description: 'Get information about the shell environment (platform, shell path, architecture, hostname).',
      icon: 'Info',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      return getShellEnvironmentInfo();
    },
  },
  run_shell_command: {
    meta: {
      name: 'run_shell_command',
      label: 'Run Shell Command',
      description: 'Execute a shell command and return its output.',
      descriptionForModel:
        'Execute a shell command and return stdout, stderr, and exit code. ' +
        '\n' +
        'PURPOSE — use this tool to:\n' +
        '  • Check system state (running processes, disk usage, environment variables)\n' +
        '  • Run build tools, compilers, or scripts the user has installed\n' +
        '  • Interact with version control beyond basic git operations\n' +
        '  • Run file operations that require shell features (pipes, redirects, globs)\n' +
        '\n' +
        'CRITICAL RULES:\n' +
        '  • The command runs on the user\'s real machine with their permissions.\n' +
        '  • NEVER run destructive commands (rm -rf, format, dd, shutdown, etc.).\n' +
        '  • NEVER install or modify system packages without explicit user consent.\n' +
        '  • NEVER read sensitive files (/etc/shadow, .ssh/*, .env with secrets).\n' +
        '  • ALWAYS explain to the user what command you are about to run and why.\n' +
        '  • ALWAYS wait for user approval before running potentially impactful commands.\n' +
        '  • The user can see both the command AND its output - do not hide what you run.\n' +
        '\n' +
        'OUTPUT HANDLING:\n' +
        '  • stdout and stderr are returned as strings.\n' +
        '  • stderr does not always indicate failure - many tools write progress to stderr.\n' +
        '  • Check exitCode === 0 for true success.\n' +
        '  • Present results to the user in a clear, readable format.\n' +
        '\n' +
        'LIMITS: 30-second timeout. Output capped at 100 KB.',
      icon: 'Terminal',
    },
    params: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The shell command to execute. Can include pipes (|), redirects (>), and multiple commands (&&, ;). ' +
            'Runs in a real shell on the user\'s machine.',
        },
        workdir: {
          type: 'string',
          description:
            'Working directory for the command (optional). Defaults to the current working directory.',
        },
        timeout: {
          type: 'number',
          description:
            'Timeout in milliseconds (optional, default 30000, max 60000).',
        },
      },
      required: ['command'],
    },
    async handler(params: { command: string; workdir?: string; timeout?: number }) {
      const timeout = Math.min(params.timeout ?? 30000, 60000);
      return await runShellCommand(params.command, params.workdir, timeout);
    },
  },
};

export { manifest };

import type { ExtensionToolDef } from '../types';
import {
  gitStatus,
  gitDiffUnstaged,
  gitDiffStaged,
  gitDiff,
  gitCommit,
  gitAdd,
  gitReset,
  gitLog,
  gitCreateBranch,
  gitCheckout,
  gitShow,
  gitBranch,
} from '../../main/functions/git';
import manifest from './manifest.json';

export const tools: Record<string, ExtensionToolDef> = {
  git_status: {
    meta: {
      name: 'git_status',
      label: 'Git Status',
      description: 'Get the working tree status of a Git repository, showing untracked, modified, and staged files',
      icon: 'GitFork',
    },
    params: {
      type: 'object',
      properties: { repo_path: { type: 'string', description: 'Path to the Git repository' } },
      required: ['repo_path'],
    },
    async handler(params: { repo_path: string }) { return await gitStatus(params); },
  },
  git_diff_unstaged: {
    meta: {
      name: 'git_diff_unstaged',
      label: 'Git Diff Unstaged',
      description: 'Show the diff of unstaged changes in a Git repository with configurable context lines',
      icon: 'GitFork',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        context_lines: { type: 'number', description: 'Number of context lines to show (default: 3)' },
      },
      required: ['repo_path'],
    },
    async handler(params: { repo_path: string; context_lines?: number }) { return await gitDiffUnstaged(params); },
  },
  git_diff_staged: {
    meta: {
      name: 'git_diff_staged',
      label: 'Git Diff Staged',
      description: 'Show the diff of staged changes in a Git repository with configurable context lines',
      icon: 'GitFork',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        context_lines: { type: 'number', description: 'Number of context lines to show (default: 3)' },
      },
      required: ['repo_path'],
    },
    async handler(params: { repo_path: string; context_lines?: number }) { return await gitDiffStaged(params); },
  },
  git_diff: {
    meta: {
      name: 'git_diff',
      label: 'Git Diff',
      description: 'Show the diff between the working tree and a specific branch or commit',
      icon: 'GitFork',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        target: { type: 'string', description: 'Branch name or commit hash to compare against' },
        context_lines: { type: 'number', description: 'Number of context lines to show (default: 3)' },
      },
      required: ['repo_path', 'target'],
    },
    async handler(params: { repo_path: string; target: string; context_lines?: number }) { return await gitDiff(params); },
  },
  git_commit: {
    meta: {
      name: 'git_commit',
      label: 'Git Commit',
      description: 'Commit staged changes to a Git repository with a commit message',
      icon: 'Upload',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['repo_path', 'message'],
    },
    async handler(params: { repo_path: string; message: string }) { return await gitCommit(params); },
  },
  git_add: {
    meta: {
      name: 'git_add',
      label: 'Git Add',
      description: 'Stage files for commit in a Git repository, supporting glob patterns',
      icon: 'Upload',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        files: { type: 'array', items: { type: 'string' }, description: 'Files or glob patterns to stage' },
      },
      required: ['repo_path', 'files'],
    },
    async handler(params: { repo_path: string; files: string[] }) { return await gitAdd(params); },
  },
  git_reset: {
    meta: {
      name: 'git_reset',
      label: 'Git Reset',
      description: 'Unstage all staged changes in a Git repository without modifying working tree files',
      icon: 'RefreshCw',
    },
    params: {
      type: 'object',
      properties: { repo_path: { type: 'string', description: 'Path to the Git repository' } },
      required: ['repo_path'],
    },
    async handler(params: { repo_path: string }) { return await gitReset(params); },
  },
  git_log: {
    meta: {
      name: 'git_log',
      label: 'Git Log',
      description: 'Show commit history for a Git repository with optional date range filtering',
      icon: 'Clock',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        max_count: { type: 'number', description: 'Maximum number of commits to show (default: 10)' },
        start_timestamp: { type: 'string', description: 'Start date in ISO 8601 format or relative date (e.g., "2 weeks ago")' },
        end_timestamp: { type: 'string', description: 'End date in ISO 8601 format or relative date' },
      },
      required: ['repo_path'],
    },
    async handler(params: { repo_path: string; max_count?: number; start_timestamp?: string; end_timestamp?: string }) { return await gitLog(params); },
  },
  git_create_branch: {
    meta: {
      name: 'git_create_branch',
      label: 'Git Create Branch',
      description: 'Create a new branch in a Git repository, optionally based on another branch',
      icon: 'GitBranch',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        branch_name: { type: 'string', description: 'Name of the new branch' },
        base_branch: { type: 'string', description: 'Base branch to create from (default: current branch)' },
      },
      required: ['repo_path', 'branch_name'],
    },
    async handler(params: { repo_path: string; branch_name: string; base_branch?: string }) { return await gitCreateBranch(params); },
  },
  git_checkout: {
    meta: {
      name: 'git_checkout',
      label: 'Git Checkout',
      description: 'Switch to a different branch in a Git repository',
      icon: 'GitBranch',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        branch_name: { type: 'string', description: 'Name of the branch to switch to' },
      },
      required: ['repo_path', 'branch_name'],
    },
    async handler(params: { repo_path: string; branch_name: string }) { return await gitCheckout(params); },
  },
  git_show: {
    meta: {
      name: 'git_show',
      label: 'Git Show',
      description: 'Show the contents of a commit including message, author, date, and changes',
      icon: 'Eye',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        revision: { type: 'string', description: 'Commit hash or reference (e.g., "HEAD", "HEAD~1")' },
      },
      required: ['repo_path', 'revision'],
    },
    async handler(params: { repo_path: string; revision: string }) { return await gitShow(params); },
  },
  git_branch: {
    meta: {
      name: 'git_branch',
      label: 'Git Branch',
      description: 'List branches in a Git repository with filtering by type and content patterns',
      icon: 'GitBranch',
    },
    params: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the Git repository' },
        branch_type: { type: 'string', description: 'Branch type: "local", "remote", or "all" (default: "local")' },
        contains: { type: 'string', description: 'Show only branches that contain this commit or tag' },
        not_contains: { type: 'string', description: 'Show only branches that do not contain this commit or tag' },
      },
      required: ['repo_path'],
    },
    async handler(params: { repo_path: string; branch_type?: string; contains?: string; not_contains?: string }) { return await gitBranch(params); },
  },
};

export { manifest };

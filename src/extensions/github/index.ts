import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import type { ExtensionToolDef } from '../types';
import {
  sanitizePath,
  normalizePath,
  validatePath,
} from '../../main/functions/fileSystem';
import manifest from './manifest.json';

const execFileAsync = promisify(execFile);

const SETTINGS_FILE = path.join(
  app.getPath('userData'),
  'extension-settings',
  'github.json',
);

interface GitHubSettings {
  appId?: string;
  installationId?: string;
  privateKey?: string;
  allowedRepos?: string[];
  coAuthorName?: string;
  coAuthorEmail?: string;
}

function loadSettings(): GitHubSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch {
    // settings file doesn't exist or is invalid
  }
  return { allowedRepos: [] };
}

function saveSettings(settings: GitHubSettings): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

async function createOctokit(settings: GitHubSettings): Promise<any> {
  const { Octokit } = await import('octokit');

  if (!settings.appId || !settings.installationId || !settings.privateKey) {
    throw new Error(
      'GitHub App not configured. Set up App ID, Installation ID, and Private Key in extension settings.',
    );
  }

  const jwt = await import('jsonwebtoken');
  const now = Math.floor(Date.now() / 1000);
  const appToken = jwt.default.sign(
    { iss: settings.appId, iat: now, exp: now + 600 },
    settings.privateKey,
    { algorithm: 'RS256' },
  );
  const response = await fetch(
    `https://api.github.com/app/installations/${settings.installationId}/access_tokens`,
    {
      headers: {
        Authorization: `Bearer ${appToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
      method: 'POST',
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to get installation token: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();

  return new Octokit({ auth: data.token });
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const parts = repo
    .replace('https://github.com/', '')
    .replace('.git', '')
    .split('/');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid repository format: "${repo}". Use "owner/repo" format.`,
    );
  }
  return { owner: parts[0], repo: parts[1] };
}

function isRepoAllowed(repo: string, settings: GitHubSettings): boolean {
  if (!settings.allowedRepos || settings.allowedRepos.length === 0) return true;
  return settings.allowedRepos.some((r) => {
    try {
      const allowed = parseRepo(r);
      const target = parseRepo(repo);
      return (
        allowed.owner.toLowerCase() === target.owner.toLowerCase() &&
        allowed.repo.toLowerCase() === target.repo.toLowerCase()
      );
    } catch {
      return r.toLowerCase() === repo.toLowerCase();
    }
  });
}

async function ensureRepoAllowed(repo: string): Promise<void> {
  const settings = loadSettings();
  if (settings.allowedRepos && settings.allowedRepos.length > 0) {
    if (isRepoAllowed(repo, settings)) return;
    throw new Error(
      `Repository "${repo}" is not in the allowed list. Add it in extension settings.`,
    );
  }
}

async function addRepoToAllowed(repo: string): Promise<void> {
  const settings = loadSettings();
  if (!settings.allowedRepos) settings.allowedRepos = [];
  const canonical = repo.replace('https://github.com/', '').replace('.git', '');
  if (
    !settings.allowedRepos.some(
      (r) => r.toLowerCase() === canonical.toLowerCase(),
    )
  ) {
    settings.allowedRepos.push(canonical);
    saveSettings(settings);
  }
}

function appendCoAuthor(message: string, settings: GitHubSettings): string {
  if (!settings.coAuthorName || !settings.coAuthorEmail) return message;
  const trailer = `\n\nCo-authored-by: ${settings.coAuthorName} <${settings.coAuthorEmail}>`;
  if (message.includes(trailer)) return message;
  return message + trailer;
}

interface CommitEntry {
  repoPath: string;
  content: string;
}

function normalizeRepoPath(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error('Each file must have a non-empty "repoPath" string.');
  }
  const trimmed = raw.trim().replace(/^\/+/, '');
  if (trimmed === '') {
    throw new Error('Each file must have a non-empty "repoPath" (tree.path cannot be blank).');
  }
  if (trimmed.includes('\0')) {
    throw new Error(`Invalid repoPath "${raw}": contains null byte.`);
  }
  const segments = trimmed.split('/');
  if (segments.some((s) => s === '..')) {
    throw new Error(`Invalid repoPath "${raw}": ".." segments are not allowed.`);
  }
  if (segments.some((s) => s.trim() === '')) {
    throw new Error(`Invalid repoPath "${raw}": empty path segment.`);
  }
  return trimmed;
}

function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required parameter "${field}".`);
  }
  return value.trim();
}

async function resolveCommitBase(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ commitSha: string; treeSha: string }> {
  const ref = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const commitSha: string = ref.data.object.sha;
  const commit = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: commitSha,
  });
  const treeSha: string = commit.data.tree.sha;
  if (!treeSha) {
    throw new Error('Failed to resolve base tree for branch.');
  }
  return { commitSha, treeSha };
}

async function commitEntries(
  octokit: any,
  owner: string,
  repoName: string,
  repoFull: string,
  branch: string,
  message: string,
  settings: GitHubSettings,
  entries: CommitEntry[],
): Promise<string> {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Parameter "files" must be a non-empty array.');
  }
  const normalized = entries.map((e: any) => {
    const repoPath = normalizeRepoPath(e?.repoPath);
    if (typeof e?.content !== 'string') {
      throw new Error(`File "${e?.repoPath ?? ''}" must have string "content".`);
    }
    return { repoPath, content: e.content as string };
  });

  const { commitSha, treeSha } = await resolveCommitBase(
    octokit,
    owner,
    repoName,
    branch,
  );

  const treeItems = await Promise.all(
    normalized.map(async (file) => {
      const blob = await octokit.rest.git.createBlob({
        owner,
        repo: repoName,
        content: file.content,
        encoding: 'utf-8',
      });
      return {
        path: file.repoPath,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.data.sha,
      };
    }),
  );

  const commitMessage = appendCoAuthor(message, settings);
  const newTree = await octokit.rest.git.createTree({
    owner,
    repo: repoName,
    base_tree: treeSha,
    tree: treeItems,
  });
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo: repoName,
    message: commitMessage,
    tree: newTree.data.sha,
    parents: [commitSha],
  });
  await octokit.rest.git.updateRef({
    owner,
    repo: repoName,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });

  const listed = normalized.map((f) => f.repoPath).join(', ');
  return `Commit ${commit.data.sha.slice(0, 7)} created on ${branch} in ${repoFull}: ${normalized.length} file(s) (${listed})`;
}

function normalizeSandboxPosixPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Each file must have a non-empty "sandboxPath" string.');
  }
  if (raw.includes('\0')) {
    throw new Error('Invalid sandboxPath: contains null byte.');
  }
  let p = raw.trim();
  if (!path.posix.isAbsolute(p)) {
    p = path.posix.join('/workspace', p);
  }
  p = path.posix.normalize(p);
  if (p === '' || p === '.') {
    throw new Error('Invalid sandboxPath.');
  }
  if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  return p;
}

function getDockerBinLocal(): string {
  return process.platform === 'win32' ? 'docker.exe' : 'docker';
}

async function readSandboxFileUncapped(
  containerName: string,
  sandboxPath: string,
): Promise<string> {
  const normalized = normalizeSandboxPosixPath(sandboxPath);
  const bin = getDockerBinLocal();
  // No size cap here by design: GitHub blob limit is the cap.
  // Local docker exec (not sandboxReadFile) so sandboxRunner stays untouched.
  const result = await execFileAsync(bin, ['exec', containerName, 'cat', '--', normalized], {
    timeout: 120000,
    maxBuffer: 100 * 1024 * 1024,
  } as any);
  const stdout = (result as any)?.stdout ?? '';
  const stderr = (result as any)?.stderr ?? '';
  if (stderr && !stdout) {
    throw new Error(`Failed to read sandbox file "${sandboxPath}": ${stderr}`);
  }
  return typeof stdout === 'string' ? stdout : String(stdout ?? '');
}

const tools: Record<string, ExtensionToolDef> = {
  list_repositories: {
    meta: {
      name: 'list_repositories',
      label: 'List Repositories',
      description:
        'List all GitHub repositories accessible by the configured authentication',
      icon: 'BookOpen',
    },
    params: {
      type: 'object',
      properties: {
        affiliation: {
          type: 'string',
          description:
            'Filter by affiliation: "owner", "collaborator", "organization_member" (optional)',
        },
      },
    },
    async handler(_params: { affiliation?: string }) {
      try {
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const result =
          await octokit.rest.apps.listReposAccessibleToInstallation();
        const repos = result.data.repositories.map((r: any) => ({
          name: r.full_name,
          private: r.private,
          fork: r.fork,
          description: r.description,
          url: r.html_url,
          defaultBranch: r.default_branch,
        }));
        return JSON.stringify(repos, null, 2);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  get_repository: {
    meta: {
      name: 'get_repository',
      label: 'Get Repository',
      description: 'Get details about a specific GitHub repository',
      icon: 'BookOpen',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
      },
    },
    async handler(params: { repo: string }) {
      try {
        await ensureRepoAllowed(params.repo);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(params.repo);
        const result = await octokit.rest.repos.get({ owner, repo });
        return JSON.stringify(result.data, null, 2);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  list_branches: {
    meta: {
      name: 'list_branches',
      label: 'List Branches',
      description: 'List all branches in a GitHub repository',
      icon: 'GitBranch',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
      },
    },
    async handler(params: { repo: string }) {
      try {
        await ensureRepoAllowed(params.repo);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(params.repo);
        const result = await octokit.rest.repos.listBranches({ owner, repo });
        return result.data
          .map((b: any) => `- ${b.name}${b.protected ? ' (protected)' : ''}`)
          .join('\n');
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  create_branch: {
    meta: {
      name: 'create_branch',
      label: 'Create Branch',
      description:
        'Create a new branch in a repository from an existing base branch or commit SHA',
      icon: 'GitBranch',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
        newBranch: { type: 'string', description: 'Name for the new branch' },
        baseBranch: {
          type: 'string',
          description: 'Source branch name (default: main)',
        },
      },
    },
    async handler(params: {
      repo: string;
      newBranch: string;
      baseBranch?: string;
    }) {
      try {
        await ensureRepoAllowed(params.repo);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(params.repo);
        const baseRef = await octokit.rest.git.getRef({
          owner,
          repo,
          ref: `heads/${params.baseBranch || 'main'}`,
        });
        await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${params.newBranch}`,
          sha: baseRef.data.object.sha,
        });
        return `Branch "${params.newBranch}" created successfully in ${params.repo}`;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  create_pr: {
    meta: {
      name: 'create_pr',
      label: 'Create Pull Request',
      description: 'Create a pull request between two branches in a repository',
      icon: 'GitPullRequest',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
        title: { type: 'string', description: 'Title of the pull request' },
        head: {
          type: 'string',
          description: 'The name of the branch where the changes are',
        },
        base: {
          type: 'string',
          description:
            'The name of the branch you want the changes pulled into',
        },
        body: {
          type: 'string',
          description: 'Description/body of the pull request (optional)',
        },
        draft: {
          type: 'boolean',
          description: 'Create as draft PR (optional)',
        },
      },
    },
    async handler(params: {
      repo: string;
      title: string;
      head: string;
      base: string;
      body?: string;
      draft?: boolean;
    }) {
      try {
        await ensureRepoAllowed(params.repo);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(params.repo);
        const result = await octokit.rest.pulls.create({
          owner,
          repo,
          title: params.title,
          head: params.head,
          base: params.base,
          body: params.body,
          draft: params.draft ?? false,
        });
        return `PR #${result.data.number} created: ${result.data.html_url}`;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  create_issue: {
    meta: {
      name: 'create_issue',
      label: 'Create Issue',
      description: 'Create a new issue in a repository',
      icon: 'CircleAlert',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
        title: { type: 'string', description: 'Title of the issue' },
        body: {
          type: 'string',
          description: 'Description/body of the issue (optional)',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply (optional)',
        },
        assignees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Usernames to assign (optional)',
        },
      },
    },
    async handler(params: {
      repo: string;
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
    }) {
      try {
        await ensureRepoAllowed(params.repo);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(params.repo);
        const result = await octokit.rest.issues.create({
          owner,
          repo,
          title: params.title,
          body: params.body,
          labels: params.labels,
          assignees: params.assignees,
        });
        return `Issue #${result.data.number} created: ${result.data.html_url}`;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  list_issues: {
    meta: {
      name: 'list_issues',
      label: 'List Issues',
      description: 'List issues and pull requests in a repository',
      icon: 'CircleAlert',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
        state: {
          type: 'string',
          description:
            'Filter by state: "open", "closed", "all" (default: open)',
        },
        labels: {
          type: 'string',
          description:
            'Comma-separated list of label names to filter by (optional)',
        },
        sort: {
          type: 'string',
          description:
            'Sort: "created", "updated", "comments" (default: created)',
        },
      },
    },
    async handler(params: {
      repo: string;
      state?: string;
      labels?: string;
      sort?: string;
    }) {
      try {
        await ensureRepoAllowed(params.repo);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(params.repo);
        const result = await octokit.rest.issues.listForRepo({
          owner,
          repo,
          state: params.state || 'open',
          labels: params.labels,
          sort: params.sort || 'created',
        });
        const issues = result.data
          .map(
            (i: any) =>
              `#${i.number} ${i.title} (${i.state})${i.pull_request ? ' [PR]' : ''}`,
          )
          .join('\n');
        return issues || '(no issues found)';
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  create_fork: {
    meta: {
      name: 'create_fork',
      label: 'Create Fork',
      description:
        'Fork a repository. The forked repo is automatically added to the allowed list.',
      icon: 'GitFork',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format to fork',
        },
        organization: {
          type: 'string',
          description:
            'Optional organization to fork into (instead of personal account)',
        },
      },
    },
    async handler(params: { repo: string; organization?: string }) {
      try {
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(params.repo);
        const result = await octokit.rest.repos.createFork({
          owner,
          repo,
          organization: params.organization,
        });
        const forkedRepo = result.data.full_name;
        await addRepoToAllowed(forkedRepo);
        return `Fork created: ${forkedRepo} (${result.data.html_url})\nThis repository has been added to the allowed list.`;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  create_commit_text: {
    meta: {
      name: 'create_commit_text',
      label: 'Create Commit with Text',
      description:
        'Create a commit on a GitHub repository from raw text. Each file takes inline text and the destination path within the commit.',
      icon: 'GitCommit',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
        branch: { type: 'string', description: 'Branch to commit to' },
        message: { type: 'string', description: 'Commit message' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description:
                  'Destination file path within the commit (e.g. "src/app.ts"). This becomes tree.path.',
              },
              content: {
                type: 'string',
                description: 'Raw text content to write to repoPath (text, utf-8)',
              },
            },
            required: ['repoPath', 'content'],
          },
          description: 'Array of files to create or update',
        },
      },
      required: ['repo', 'branch', 'message', 'files'],
    },
    async handler(params: {
      repo: string;
      branch: string;
      message: string;
      files: Array<{ repoPath: string; content: string }>;
    }) {
      try {
        const repoFull = requireNonBlank(params?.repo, 'repo');
        const branch = requireNonBlank(params?.branch, 'branch');
        const message = requireNonBlank(params?.message, 'message');
        await ensureRepoAllowed(repoFull);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(repoFull);
        return await commitEntries(
          octokit,
          owner,
          repo,
          repoFull,
          branch,
          message,
          settings,
          params.files as any,
        );
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  create_commit_files: {
    meta: {
      name: 'create_commit_files',
      label: 'Create Commit with Host Files',
      description:
        'Create a commit on a GitHub repository from host files. Reads each hostPath server-side (uncapped, text utf-8) and commits it to repoPath. Returns status only, never file contents.',
      icon: 'GitCommit',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
        branch: { type: 'string', description: 'Branch to commit to' },
        message: { type: 'string', description: 'Commit message' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description:
                  'Destination file path within the commit (e.g. "src/app.ts"). This becomes tree.path.',
              },
              hostPath: {
                type: 'string',
                description:
                  'Source path on the HOST filesystem to read (text, utf-8). Supports ~ and placeholders; must be within allowedDirectories if set.',
              },
            },
            required: ['repoPath', 'hostPath'],
          },
          description: 'Array of host files to read and commit',
        },
      },
      required: ['repo', 'branch', 'message', 'files'],
    },
    async handler(params: {
      repo: string;
      branch: string;
      message: string;
      files: Array<{ repoPath: string; hostPath: string }>;
    }) {
      try {
        const repoFull = requireNonBlank(params?.repo, 'repo');
        const branch = requireNonBlank(params?.branch, 'branch');
        const message = requireNonBlank(params?.message, 'message');
        if (!Array.isArray(params?.files) || params.files.length === 0) {
          throw new Error('Parameter "files" must be a non-empty array.');
        }
        await ensureRepoAllowed(repoFull);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(repoFull);

        // Uncapped server-side read: no maxReadSize check by design.
        // GitHub blob limit is the cap; errors surface from the API.
        const entries: CommitEntry[] = [];
        for (const f of params.files as any[]) {
          const repoPath = normalizeRepoPath(f?.repoPath);
          if (typeof f?.hostPath !== 'string' || f.hostPath.trim() === '') {
            throw new Error(`File "${f?.repoPath ?? ''}" must have a non-empty "hostPath".`);
          }
          const p = normalizePath(sanitizePath(f.hostPath));
          validatePath(p);
          let content: string;
          try {
            content = await fsPromises.readFile(p, 'utf-8');
          } catch (e) {
            throw new Error(
              `Failed to read host file "${f.hostPath}": ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          entries.push({ repoPath, content });
        }

        return await commitEntries(
          octokit,
          owner,
          repo,
          repoFull,
          branch,
          message,
          settings,
          entries,
        );
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  create_commit_sandbox_files: {
    meta: {
      name: 'create_commit_sandbox_files',
      label: 'Create Commit with Sandbox Files',
      description:
        'Create a commit on a GitHub repository from sandbox container files. Reads each sandboxPath server-side via docker exec cat (uncapped, text utf-8) and commits it to repoPath. container_name is required. Returns status only.',
      icon: 'GitCommit',
    },
    params: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format',
        },
        branch: { type: 'string', description: 'Branch to commit to' },
        message: { type: 'string', description: 'Commit message' },
        container_name: {
          type: 'string',
          description: 'Name of the sandbox container to read files from (required)',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description:
                  'Destination file path within the commit (e.g. "src/app.ts"). This becomes tree.path.',
              },
              sandboxPath: {
                type: 'string',
                description:
                  'Source path INSIDE the sandbox container (e.g. "/workspace/out.txt"; relative resolves against /workspace).',
              },
            },
            required: ['repoPath', 'sandboxPath'],
          },
          description: 'Array of sandbox files to read and commit',
        },
      },
      required: ['repo', 'branch', 'message', 'container_name', 'files'],
    },
    async handler(params: {
      repo: string;
      branch: string;
      message: string;
      container_name: string;
      files: Array<{ repoPath: string; sandboxPath: string }>;
    }) {
      try {
        const repoFull = requireNonBlank(params?.repo, 'repo');
        const branch = requireNonBlank(params?.branch, 'branch');
        const message = requireNonBlank(params?.message, 'message');
        const containerName = requireNonBlank(params?.container_name, 'container_name');
        if (!Array.isArray(params?.files) || params.files.length === 0) {
          throw new Error('Parameter "files" must be a non-empty array.');
        }
        await ensureRepoAllowed(repoFull);
        const settings = loadSettings();
        const octokit = await createOctokit(settings);
        const { owner, repo } = parseRepo(repoFull);

        const entries: CommitEntry[] = [];
        for (const f of params.files as any[]) {
          const repoPath = normalizeRepoPath(f?.repoPath);
          if (typeof f?.sandboxPath !== 'string' || f.sandboxPath.trim() === '') {
            throw new Error(`File "${f?.repoPath ?? ''}" must have a non-empty "sandboxPath".`);
          }
          let content: string;
          try {
            content = await readSandboxFileUncapped(containerName, f.sandboxPath);
          } catch (e) {
            throw new Error(
              `Failed to read sandbox file "${f.sandboxPath}" in container "${containerName}": ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          entries.push({ repoPath, content });
        }

        return await commitEntries(
          octokit,
          owner,
          repo,
          repoFull,
          branch,
          message,
          settings,
          entries,
        );
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },

  get_allowed_repos: {
    meta: {
      name: 'get_allowed_repos',
      label: 'Get Allowed Repositories',
      description: 'List all repositories currently in the allowed list',
      icon: 'Shield',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      try {
        const settings = loadSettings();
        return settings.allowedRepos && settings.allowedRepos.length > 0
          ? settings.allowedRepos.join('\n')
          : 'All repositories allowed (no restrictions configured)';
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
};

export { tools };
export { manifest };

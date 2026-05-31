import { execSync } from 'child_process';

/**
 * Get the status of a git repository in porcelain format
 */
export function gitStatus({ repo_path }: { repo_path: string }): string {
  try {
    const output = execSync('git status --porcelain', {
      cwd: repo_path,
      encoding: 'utf-8',
    });
    return output;
  } catch (error) {
    return `Error getting git status: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Get unstaged changes diff with optional context lines
 */
export function gitDiffUnstaged({
  repo_path,
  context_lines,
}: {
  repo_path: string;
  context_lines?: number;
}): string {
  try {
    const contextFlag = context_lines !== undefined ? `-U${context_lines}` : '';
    const command = `git diff ${contextFlag}`.trim();
    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return output;
  } catch (error) {
    return `Error getting unstaged diff: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Get staged changes diff with optional context lines
 */
export function gitDiffStaged({
  repo_path,
  context_lines,
}: {
  repo_path: string;
  context_lines?: number;
}): string {
  try {
    const contextFlag = context_lines !== undefined ? `-U${context_lines}` : '';
    const command = `git diff --cached ${contextFlag}`.trim();
    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return output;
  } catch (error) {
    return `Error getting staged diff: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Get diff between current state and a target revision with optional context lines
 */
export function gitDiff({
  repo_path,
  target,
  context_lines,
}: {
  repo_path: string;
  target: string;
  context_lines?: number;
}): string {
  try {
    const contextFlag = context_lines !== undefined ? `-U${context_lines}` : '';
    const command = `git diff ${target} ${contextFlag}`.trim();
    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return output;
  } catch (error) {
    return `Error getting diff for target ${target}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Commit changes with a message
 */
export function gitCommit({
  repo_path,
  message,
}: {
  repo_path: string;
  message: string;
}): string {
  try {
    const escapedMessage = message.replace(/"/g, '\\"');
    const command = `git commit -m "${escapedMessage}"`;
    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
    });
    return output;
  } catch (error) {
    return `Error committing changes: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Add files to the staging area
 */
export function gitAdd({
  repo_path,
  files,
}: {
  repo_path: string;
  files: string[];
}): string {
  try {
    const quotedFiles = files
      .map((f) => `"${f.replace(/"/g, '\\"')}"`)
      .join(' ');
    const command = `git add ${quotedFiles}`;
    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
    });
    return output || 'Files added successfully';
  } catch (error) {
    return `Error adding files: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Reset the staging area
 */
export function gitReset({ repo_path }: { repo_path: string }): string {
  try {
    const output = execSync('git reset', {
      cwd: repo_path,
      encoding: 'utf-8',
    });
    return output || 'Reset completed successfully';
  } catch (error) {
    return `Error resetting: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Get commit log with optional filters
 */
export function gitLog({
  repo_path,
  max_count,
  start_timestamp,
  end_timestamp,
}: {
  repo_path: string;
  max_count?: number;
  start_timestamp?: string;
  end_timestamp?: string;
}):
  | Array<{ hash: string; author: string; date: string; message: string }>
  | string {
  try {
    let command = 'git log --format=%H%n%an%n%aI%n%s%n---END---';

    if (max_count !== undefined) {
      command += ` --max-count=${max_count}`;
    }
    if (start_timestamp) {
      command += ` --since="${start_timestamp}"`;
    }
    if (end_timestamp) {
      command += ` --until="${end_timestamp}"`;
    }

    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    // Parse the output into structured objects
    const commits: Array<{
      hash: string;
      author: string;
      date: string;
      message: string;
    }> = [];
    const entries = output.split('---END---').filter((entry) => entry.trim());

    for (const entry of entries) {
      const lines = entry.trim().split('\n');
      if (lines.length >= 4) {
        commits.push({
          hash: lines[0],
          author: lines[1],
          date: lines[2],
          message: lines[3],
        });
      }
    }

    return commits;
  } catch (error) {
    return `Error getting log: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Create a new branch
 */
export function gitCreateBranch({
  repo_path,
  branch_name,
  base_branch,
}: {
  repo_path: string;
  branch_name: string;
  base_branch?: string;
}): string {
  try {
    const base = base_branch || 'HEAD';
    const command = `git branch ${branch_name} ${base}`;
    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
    });
    return output || `Branch '${branch_name}' created successfully`;
  } catch (error) {
    return `Error creating branch: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Checkout a branch
 */
export function gitCheckout({
  repo_path,
  branch_name,
}: {
  repo_path: string;
  branch_name: string;
}): string {
  try {
    const output = execSync(`git checkout ${branch_name}`, {
      cwd: repo_path,
      encoding: 'utf-8',
    });
    return output;
  } catch (error) {
    return `Error checking out branch: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Show a specific revision
 */
export function gitShow({
  repo_path,
  revision,
}: {
  repo_path: string;
  revision: string;
}): string {
  try {
    const output = execSync(`git show ${revision}`, {
      cwd: repo_path,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return output;
  } catch (error) {
    return `Error showing revision: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * List branches with optional filters
 */
export function gitBranch({
  repo_path,
  branch_type,
  contains,
  not_contains,
}: {
  repo_path: string;
  branch_type?: string;
  contains?: string;
  not_contains?: string;
}): string[] | string {
  try {
    let command = 'git branch';

    if (branch_type === 'remote') {
      command += ' -r';
    } else if (branch_type === 'all') {
      command += ' -a';
    }

    if (contains) {
      command += ` --contains ${contains}`;
    }
    if (not_contains) {
      command += ` --no-contains ${not_contains}`;
    }

    const output = execSync(command, {
      cwd: repo_path,
      encoding: 'utf-8',
    });

    // Parse branch names, removing leading '* ' from current branch
    const branches = output
      .split('\n')
      .map((line) => line.replace(/^\*\s+/, '').trim())
      .filter((line) => line.length > 0);

    return branches;
  } catch (error) {
    return `Error listing branches: ${error instanceof Error ? error.message : String(error)}`;
  }
}

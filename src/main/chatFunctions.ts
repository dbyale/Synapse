import type { defineChatSessionFunction as DefineChatSessionFunctionType } from 'node-llama-cpp';

import { fetchPage } from './functions/fetchPage';
import {
  readTextFile,
  readMediaFile,
  readMultipleFiles,
  writeFile,
  editFile,
  createDirectory,
  listDirectory,
  listDirectoryWithSizes,
  moveFile,
  searchFiles,
  directoryTree,
  getFileInfo,
  listAllowedDirectories,
} from './functions/fileSystem';
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
} from './functions/git';
import { AVAILABLE_TOOLS, TOOL_METADATA } from '../data/defaultTools';

type DefineFn = typeof DefineChatSessionFunctionType;

function isDSTActive(timezone: string, date: Date): boolean {
  try {
    const year = date.getFullYear();
    const januaryDate = new Date(year, 0, 1);
    const julyDate = new Date(year, 6, 1);

    const getUTCOffset = (d: Date): number => {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const year = parseInt(parts.find(p => p.type === 'year')?.value || '0', 10);
      const month = parseInt(parts.find(p => p.type === 'month')?.value || '0', 10);
      const day = parseInt(parts.find(p => p.type === 'day')?.value || '0', 10);
      const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);

      const localDate = new Date(year, month - 1, day, hour, minute, second);
      return (d.getTime() - localDate.getTime()) / (1000 * 60);
    };

    const januaryOffset = getUTCOffset(januaryDate);
    const julyOffset = getUTCOffset(julyDate);
    const currentOffset = getUTCOffset(date);

    const standardOffset = Math.min(januaryOffset, julyOffset);
    const daylightOffset = Math.max(januaryOffset, julyOffset);

    return currentOffset === daylightOffset;
  } catch {
    return false;
  }
}

function formatDateTimeWithOffset(date: Date, timezone: string): string {
  try {
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone }).format(date);

    const year = fmt({ year: 'numeric' });
    const month = fmt({ month: '2-digit' });
    const day = fmt({ day: '2-digit' });
    const hour = fmt({ hour: '2-digit', hour12: false });
    const minute = fmt({ minute: '2-digit' });
    const second = fmt({ second: '2-digit' });

    const localDateString = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const localDate = new Date(localDateString);
    const utcOffsetMs = date.getTime() - localDate.getTime();
    const utcOffsetMinutes = utcOffsetMs / (1000 * 60);
    const utcOffsetHours = Math.floor(utcOffsetMinutes / 60);
    const utcOffsetMinsRemainder = Math.abs(utcOffsetMinutes % 60);

    const offsetStr = `${utcOffsetHours >= 0 ? '+' : ''}${String(utcOffsetHours).padStart(2, '0')}:${String(Math.round(utcOffsetMinsRemainder)).padStart(2, '0')}`;

    return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetStr}`;
  } catch {
    return date.toISOString();
  }
}

export function createChatFunctions(defineFn: DefineFn) {
  return {
    get_current_time: defineFn({
      description: 'Get the current time in a specified timezone. Returns the current datetime in ISO 8601 format with UTC offset, the timezone name, and whether daylight saving time is active.',
      params: {
        type: 'object',
        properties: {
          timezone: {
            oneOf: [
              { type: 'null' },
              { type: 'string', description: 'IANA timezone name (e.g., "America/New_York", "Europe/London", "Asia/Tokyo")' },
            ],
            description: 'IANA timezone name. If not provided, uses system timezone.',
          },
        },
      },
      async handler(params) {
        const requestedZone = params.timezone ?? null;
        const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const zone = requestedZone ?? systemZone;
        const now = new Date();
        try {
          const datetime = formatDateTimeWithOffset(now, zone);
          const is_dst = isDSTActive(zone, now);
          return { timezone: zone, datetime, is_dst };
        } catch {
          return {
            error: `Unrecognized timezone "${zone}". Using system timezone: ${systemZone}`,
            timezone: systemZone,
            datetime: formatDateTimeWithOffset(now, systemZone),
            is_dst: isDSTActive(systemZone, now),
          };
        }
      },
    }),

    convert_time: defineFn({
      description: 'Convert a time from one timezone to another. Takes a time in HH:MM 24-hour format and converts it between timezones. Returns the source and target datetimes with timezone info and DST status, plus the time difference between the two zones.',
      params: {
        type: 'object',
        properties: {
          source_timezone: { type: 'string', description: 'IANA timezone name of the source time (e.g., "America/New_York")' },
          time: { type: 'string', description: 'Time in 24-hour HH:MM format (e.g., "14:30")' },
          target_timezone: { type: 'string', description: 'IANA timezone name of the target timezone (e.g., "Europe/London")' },
        },
        required: ['source_timezone', 'time', 'target_timezone'],
      },
      async handler(params) {
        const { source_timezone, time, target_timezone } = params;
        try {
          const timeParts = time.split(':');
          if (timeParts.length !== 2) return { error: 'Invalid time format. Use HH:MM (24-hour format).' };
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return { error: 'Invalid time. Hours must be 0-23, minutes 0-59.' };
          }
          const today = new Date();
          const sourceDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0);
          const fmt = (opts: Intl.DateTimeFormatOptions, tz: string) =>
            new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(sourceDate);
          const sourceYear = fmt({ year: 'numeric' }, source_timezone);
          const sourceMonth = fmt({ month: '2-digit' }, source_timezone);
          const sourceDay = fmt({ day: '2-digit' }, source_timezone);
          const sourceHour = fmt({ hour: '2-digit', hour12: false }, source_timezone);
          const sourceMinute = fmt({ minute: '2-digit' }, source_timezone);
          const sourceSecond = fmt({ second: '2-digit' }, source_timezone);
          const sourceLocalString = `${sourceYear}-${sourceMonth}-${sourceDay}T${sourceHour}:${sourceMinute}:${sourceSecond}`;
          const sourceLocalDate = new Date(sourceLocalString);
          const sourceUTCOffsetMs = sourceDate.getTime() - sourceLocalDate.getTime();
          const sourceUTCOffsetMinutes = sourceUTCOffsetMs / (1000 * 60);
          const utcDate = new Date(sourceDate.getTime() - sourceUTCOffsetMs);
          const targetYear = fmt({ year: 'numeric' }, target_timezone);
          const targetMonth = fmt({ month: '2-digit' }, target_timezone);
          const targetDay = fmt({ day: '2-digit' }, target_timezone);
          const targetHour = fmt({ hour: '2-digit', hour12: false }, target_timezone);
          const targetMinute = fmt({ minute: '2-digit' }, target_timezone);
          const targetSecond = fmt({ second: '2-digit' }, target_timezone);
          const targetLocalString = `${targetYear}-${targetMonth}-${targetDay}T${targetHour}:${targetMinute}:${targetSecond}`;
          const targetLocalDate = new Date(targetLocalString);
          const targetUTCOffsetMs = utcDate.getTime() - targetLocalDate.getTime();
          const targetUTCOffsetMinutes = targetUTCOffsetMs / (1000 * 60);
          const sourceDateTime = formatDateTimeWithOffset(sourceDate, source_timezone);
          const targetDateTime = formatDateTimeWithOffset(utcDate, target_timezone);
          const timeDiffMinutes = (targetUTCOffsetMinutes - sourceUTCOffsetMinutes);
          const timeDiffHours = timeDiffMinutes / 60;
          const sign = timeDiffHours >= 0 ? '+' : '';
          const timeDiffStr = timeDiffHours % 1 === 0
            ? `${sign}${timeDiffHours.toFixed(0)}h`
            : `${sign}${timeDiffHours.toFixed(1)}h`;
          return {
            source: { timezone: source_timezone, datetime: sourceDateTime, is_dst: isDSTActive(source_timezone, sourceDate) },
            target: { timezone: target_timezone, datetime: targetDateTime, is_dst: isDSTActive(target_timezone, utcDate) },
            time_difference: timeDiffStr,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { error: `Failed to convert time: ${errorMessage}` };
        }
      },
    }),

    fetchPage: defineFn({
      description: 'Fetches information from a URL. Use start_index to read large pages in chunks and find the information you need. When the exact URL is unknown use a search engine to find the correct URL, or, visit the site homepage and use fetchPage to explore the site and find the correct URL.',
      params: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
          max_length: { type: 'integer', description: 'Maximum number of characters to return (default: 5000)' },
          start_index: { type: 'integer', description: 'Start content from this character index (default: 0)' },
          raw: { type: 'boolean', description: 'Get raw content without markdown conversion (default: false)' },
        },
        required: ['url'],
      },
      async handler(params) {
        const { url, max_length = 5000, start_index = 0, raw = false } = params;
        try {
          const content = await fetchPage(url, raw);
          if (content.startsWith('Error:')) return content;
          const sliced = content.slice(start_index, start_index + max_length);
          return sliced || 'No content found at the specified index.';
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('timeout')) return `Error: Request timeout while fetching ${url}`;
          if (errorMessage.includes('Invalid URL')) return `Error: Invalid URL provided: ${url}`;
          return `Error: Failed to fetch ${url}. ${errorMessage}`;
        }
      },
    }),

    // Filesystem tools
    read_text_file: defineFn({
      description: 'Read a text file. Optionally retrieve only the first N or last N lines.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the text file' },
          head: { type: 'number', description: 'Return only the first N lines' },
          tail: { type: 'number', description: 'Return only the last N lines' },
        },
      },
      async handler(params: { path: string; head?: number; tail?: number }) {
        return await readTextFile(params);
      },
    }),

    read_media_file: defineFn({
      description: 'Read a media file (image, video, audio, PDF) and return it as base64-encoded data with MIME type.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the media file' },
        },
      },
      async handler(params: { path: string }) {
        return await readMediaFile(params);
      },
    }),

    read_multiple_files: defineFn({
      description: 'Read multiple text files in one operation.',
      params: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to read' },
        },
      },
      async handler(params: { paths: string[] }) {
        return await readMultipleFiles(params);
      },
    }),

    write_file: defineFn({
      description: 'Write content to a file. Creates the file and parent directories if needed.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path where the file will be written' },
          content: { type: 'string', description: 'Content to write to the file' },
        },
      },
      async handler(params: { path: string; content: string }) {
        return await writeFile(params);
      },
    }),

    edit_file: defineFn({
      description: 'Edit a file by replacing text. Supports dryRun mode to preview changes without writing.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit' },
          edits: {
            type: 'array',
            items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } } },
            description: 'Array of text replacements to apply',
          },
          dryRun: { type: 'boolean', description: 'If true, preview changes without writing (default: false)' },
        },
      },
      async handler(params: { path: string; edits: Array<{ oldText: string; newText: string }>; dryRun?: boolean }) {
        return await editFile(params);
      },
    }),

    create_directory: defineFn({
      description: 'Create a directory and any parent directories as needed.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the directory to create' },
        },
      },
      async handler(params: { path: string }) {
        return await createDirectory(params);
      },
    }),

    list_directory: defineFn({
      description: 'List the contents of a directory.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the directory to list' },
        },
      },
      async handler(params: { path: string }) {
        return await listDirectory(params);
      },
    }),

    list_directory_with_sizes: defineFn({
      description: 'List directory contents with file sizes. This operation is much slower than list_directory and should only be used when sizes are important. Optionally sort by name or size.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the directory to list' },
          sortBy: { type: 'string', description: 'Sort by "name" or "size" (optional)' },
        },
      },
      async handler(params: { path: string; sortBy?: string }) {
        return await listDirectoryWithSizes(params);
      },
    }),

    move_file: defineFn({
      description: 'Move or rename a file to a new location.',
      params: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Current path of the file' },
          destination: { type: 'string', description: 'New path for the file' },
        },
      },
      async handler(params: { source: string; destination: string }) {
        return await moveFile(params);
      },
    }),

    search_files: defineFn({
      description: 'Search for files matching a glob pattern in a directory (recursively).',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Root directory to search in' },
          pattern: { type: 'string', description: 'Glob pattern to match (e.g., "*.json", "test-*.ts")' },
          excludePatterns: { type: 'array', items: { type: 'string' }, description: 'Patterns to exclude from search (optional)' },
        },
      },
      async handler(params: { path: string; pattern: string; excludePatterns?: string[] }) {
        return await searchFiles(params);
      },
    }),

    directory_tree: defineFn({
      description: 'Generate a tree representation of a directory structure.',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Root directory for the tree' },
          excludePatterns: { type: 'array', items: { type: 'string' }, description: 'Patterns to exclude from the tree (optional)' },
        },
      },
      async handler(params: { path: string; excludePatterns?: string[] }) {
        return await directoryTree(params);
      },
    }),

    get_file_info: defineFn({
      description: 'Get detailed information about a file or directory (size, permissions, timestamps, etc.).',
      params: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file or directory' },
        },
      },
      async handler(params: { path: string }) {
        return await getFileInfo(params);
      },
    }),

    list_allowed_directories: defineFn({
      description: 'List all configured allowed directories for filesystem operations.',
      params: { type: 'object', properties: {} },
      async handler() {
        return await listAllowedDirectories();
      },
    }),

    // === Git Functions ===
    git_status: defineFn({
      description: 'Get the working tree status of a Git repository. Shows untracked, modified, and staged files.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
        },
        required: ['repo_path'],
      },
      async handler(params: { repo_path: string }) {
        return await gitStatus(params);
      },
    }),

    git_diff_unstaged: defineFn({
      description: 'Show the diff of unstaged changes in a Git repository.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          context_lines: { type: 'number', description: 'Number of context lines to show (default: 3)' },
        },
        required: ['repo_path'],
      },
      async handler(params: { repo_path: string; context_lines?: number }) {
        return await gitDiffUnstaged(params);
      },
    }),

    git_diff_staged: defineFn({
      description: 'Show the diff of staged changes in a Git repository.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          context_lines: { type: 'number', description: 'Number of context lines to show (default: 3)' },
        },
        required: ['repo_path'],
      },
      async handler(params: { repo_path: string; context_lines?: number }) {
        return await gitDiffStaged(params);
      },
    }),

    git_diff: defineFn({
      description: 'Show the diff between the working tree and a specific branch or commit. Useful for comparing against main, develop, or any commit hash.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          target: { type: 'string', description: 'Branch name or commit hash to compare against (e.g., "main", "develop", or a commit hash)' },
          context_lines: { type: 'number', description: 'Number of context lines to show (default: 3)' },
        },
        required: ['repo_path', 'target'],
      },
      async handler(params: { repo_path: string; target: string; context_lines?: number }) {
        return await gitDiff(params);
      },
    }),

    git_commit: defineFn({
      description: 'Commit staged changes with a commit message. All staged changes will be included in the commit.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          message: { type: 'string', description: 'Commit message' },
        },
        required: ['repo_path', 'message'],
      },
      async handler(params: { repo_path: string; message: string }) {
        return await gitCommit(params);
      },
    }),

    git_add: defineFn({
      description: 'Stage files for commit in a Git repository. Supports glob patterns.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          files: { type: 'array', items: { type: 'string' }, description: 'Files or glob patterns to stage (e.g., ["*.js", "src/main.ts"])' },
        },
        required: ['repo_path', 'files'],
      },
      async handler(params: { repo_path: string; files: string[] }) {
        return await gitAdd(params);
      },
    }),

    git_reset: defineFn({
      description: 'Unstage all staged changes in a Git repository. Does not modify working tree files.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
        },
        required: ['repo_path'],
      },
      async handler(params: { repo_path: string }) {
        return await gitReset(params);
      },
    }),

    git_log: defineFn({
      description: 'Show commit history for a Git repository. Optionally filter by date range using ISO 8601 dates, relative dates like "2 weeks ago", or absolute dates.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          max_count: { type: 'number', description: 'Maximum number of commits to show (default: 10)' },
          start_timestamp: { type: 'string', description: 'Start date in ISO 8601 format, relative date (e.g., "2 weeks ago"), or absolute date' },
          end_timestamp: { type: 'string', description: 'End date in ISO 8601 format, relative date (e.g., "2 weeks ago"), or absolute date' },
        },
        required: ['repo_path'],
      },
      async handler(params: { repo_path: string; max_count?: number; start_timestamp?: string; end_timestamp?: string }) {
        return await gitLog(params);
      },
    }),

    git_create_branch: defineFn({
      description: 'Create a new branch in a Git repository. Optionally base it on another branch.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          branch_name: { type: 'string', description: 'Name of the new branch' },
          base_branch: { type: 'string', description: 'Base branch to create from (default: current branch)' },
        },
        required: ['repo_path', 'branch_name'],
      },
      async handler(params: { repo_path: string; branch_name: string; base_branch?: string }) {
        return await gitCreateBranch(params);
      },
    }),

    git_checkout: defineFn({
      description: 'Switch to a different branch in a Git repository.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          branch_name: { type: 'string', description: 'Name of the branch to switch to' },
        },
        required: ['repo_path', 'branch_name'],
      },
      async handler(params: { repo_path: string; branch_name: string }) {
        return await gitCheckout(params);
      },
    }),

    git_show: defineFn({
      description: 'Show the contents of a commit, including the commit message, author, date, and changes made.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          revision: { type: 'string', description: 'Commit hash or reference (e.g., "HEAD", "HEAD~1", or a full commit hash)' },
        },
        required: ['repo_path', 'revision'],
      },
      async handler(params: { repo_path: string; revision: string }) {
        return await gitShow(params);
      },
    }),

    git_branch: defineFn({
      description: 'List branches in a Git repository. Filter by type (local, remote, or all) and optionally filter by branch name patterns.',
      params: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Path to the Git repository' },
          branch_type: { type: 'string', description: 'Branch type to list: "local", "remote", or "all" (default: "local")' },
          contains: { type: 'string', description: 'Show only branches that contain this commit or tag' },
          not_contains: { type: 'string', description: 'Show only branches that do not contain this commit or tag' },
        },
        required: ['repo_path'],
      },
      async handler(params: { repo_path: string; branch_type?: string; contains?: string; not_contains?: string }) {
        return await gitBranch(params);
      },
    }),
  };
}

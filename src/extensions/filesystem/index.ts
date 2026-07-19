import type { ExtensionToolDef } from '../types';
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
} from '../../main/functions/fileSystem';
import manifest from './manifest.json';

export const tools: Record<string, ExtensionToolDef> = {
  read_text_file: {
    meta: {
      name: 'read_text_file',
      label: 'Read Text File',
      description: 'Read text file contents, with optional line limiting',
      descriptionForModel:
        'Reads a text file and returns its contents. If the file exceeds the configured max read size (default 40000 characters), a warning is returned instead. Use head/tail params to limit the result, or read in smaller sections.',
      icon: 'FileText',
    },
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
  },
  read_media_file: {
    meta: {
      name: 'read_media_file',
      label: 'Read Media File',
      description: 'Read media files as base64-encoded data with MIME types',
      descriptionForModel:
        'Reads a media file and returns it as base64 with MIME type. If the result exceeds the configured max read size (default 40000 characters), a warning is returned instead.',
      icon: 'Image',
    },
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the media file' },
      },
    },
    async handler(params: { path: string }) {
      return await readMediaFile(params);
    },
  },
  read_multiple_files: {
    meta: {
      name: 'read_multiple_files',
      label: 'Read Multiple Files',
      description: 'Read multiple text files simultaneously',
      descriptionForModel:
        'Reads multiple text files in parallel. If any file exceeds the configured max read size (default 40000 characters), that file returns a warning instead of its content.',
      icon: 'Clipboard',
    },
    params: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to read' },
      },
    },
    async handler(params: { paths: string[] }) {
      return await readMultipleFiles(params);
    },
  },
  write_file: {
    meta: {
      name: 'write_file',
      label: 'Write File',
      description: 'Create or overwrite a file with specified content',
      icon: 'Edit',
    },
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
  },
  edit_file: {
    meta: {
      name: 'edit_file',
      label: 'Edit File',
      description: 'Modify file content with text replacements, supporting dry-run mode',
      icon: 'Edit',
    },
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        edits: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } } }, description: 'Array of text replacements to apply' },
        dryRun: { type: 'boolean', description: 'If true, preview changes without writing (default: false)' },
      },
    },
    async handler(params: { path: string; edits: Array<{ oldText: string; newText: string }>; dryRun?: boolean }) {
      return await editFile(params);
    },
  },
  create_directory: {
    meta: {
      name: 'create_directory',
      label: 'Create Directory',
      description: 'Create a new directory and any necessary parent directories',
      icon: 'Folder',
    },
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the directory to create' },
      },
    },
    async handler(params: { path: string }) {
      return await createDirectory(params);
    },
  },
  list_directory: {
    meta: {
      name: 'list_directory',
      label: 'List Directory',
      description: 'List files and subdirectories in a specified directory',
      icon: 'Folder',
    },
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the directory to list' },
      },
    },
    async handler(params: { path: string }) {
      return await listDirectory(params);
    },
  },
  list_directory_with_sizes: {
    meta: {
      name: 'list_directory_with_sizes',
      label: 'List Directory with Sizes',
      description: 'List directory contents showing file sizes with optional sorting',
      icon: 'Folder',
    },
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
  },
  move_file: {
    meta: {
      name: 'move_file',
      label: 'Move File',
      description: 'Move or rename a file to a new location',
      icon: 'Send',
    },
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
  },
  search_files: {
    meta: {
      name: 'search_files',
      label: 'Search Files',
      description: 'Search for files matching glob patterns in a directory',
      icon: 'Search',
    },
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
  },
  directory_tree: {
    meta: {
      name: 'directory_tree',
      label: 'Directory Tree',
      description: 'Generate a formatted tree view of a directory structure',
      icon: 'Folder',
    },
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
  },
  get_file_info: {
    meta: {
      name: 'get_file_info',
      label: 'Get File Info',
      description: 'Retrieve detailed file metadata including size, permissions, and timestamps',
      icon: 'Tag',
    },
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file or directory' },
      },
    },
    async handler(params: { path: string }) {
      return await getFileInfo(params);
    },
  },
  list_allowed_directories: {
    meta: {
      name: 'list_allowed_directories',
      label: 'List Allowed Directories',
      description: 'Show all configured allowed directories for file operations',
      icon: 'Shield',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      return await listAllowedDirectories();
    },
  },
};

export { manifest };

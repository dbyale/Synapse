export const AVAILABLE_TOOLS = ['get_current_time', 'convert_time', 'fetchPage', 'read_text_file', 'read_media_file', 'read_multiple_files', 'write_file', 'edit_file', 'create_directory', 'list_directory', 'list_directory_with_sizes', 'move_file', 'search_files', 'directory_tree', 'get_file_info', 'list_allowed_directories'] as const;
export type ToolName = (typeof AVAILABLE_TOOLS)[number];

export const TOOL_METADATA: Record<ToolName, { label: string; description: string; category: string }> = {
  get_current_time: {
    label: 'Get Current Time',
    description: 'Allows the AI to get the current time in any timezone, including Daylight Savings Time.',
    category: 'Time',
  },
  convert_time: {
    label: 'Convert Time',
    description: 'Allows the AI to convert a time from one timezone to another, showing the time difference and Daylight Savings Time information.',
    category: 'Time',
  },
  fetchPage: {
    label: 'Fetch Page',
    description: 'Allows the AI to read webpages or portions of webpages from many URLs.',
    category: 'Web',
  },
    read_text_file: {
    label: 'Read Text File',
    description: 'Read text file contents, with optional line limiting',
    category: 'Filesystem',
  },
  read_media_file: {
    label: 'Read Media File',
    description: 'Read media files as base64-encoded data with MIME types',
    category: 'Filesystem',
  },
  read_multiple_files: {
    label: 'Read Multiple Files',
    description: 'Read multiple text files simultaneously',
    category: 'Filesystem',
  },
  write_file: {
    label: 'Write File',
    description: 'Create or overwrite a file with specified content',
    category: 'Filesystem',
  },
  edit_file: {
    label: 'Edit File',
    description: 'Modify file content with text replacements, supporting dry-run mode',
    category: 'Filesystem',
  },
  create_directory: {
    label: 'Create Directory',
    description: 'Create a new directory and any necessary parent directories',
    category: 'Filesystem',
  },
  list_directory: {
    label: 'List Directory',
    description: 'List files and subdirectories in a specified directory',
    category: 'Filesystem',
  },
  list_directory_with_sizes: {
    label: 'List Directory with Sizes',
    description: 'List directory contents showing file sizes with optional sorting',
    category: 'Filesystem',
  },
  move_file: {
    label: 'Move File',
    description: 'Move or rename a file to a new location',
    category: 'Filesystem',
  },
  search_files: {
    label: 'Search Files',
    description: 'Search for files matching glob patterns in a directory',
    category: 'Filesystem',
  },
  directory_tree: {
    label: 'Directory Tree',
    description: 'Generate a formatted tree view of a directory structure',
    category: 'Filesystem',
  },
  get_file_info: {
    label: 'Get File Info',
    description: 'Retrieve detailed file metadata including size, permissions, and timestamps',
    category: 'Filesystem',
  },
  list_allowed_directories: {
    label: 'List Allowed Directories',
    description: 'Show all configured allowed directories for file operations',
    category: 'Filesystem',
  },
};

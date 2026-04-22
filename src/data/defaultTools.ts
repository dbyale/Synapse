export const AVAILABLE_TOOLS = ['getCurrentDateTime', 'fetchPage'] as const;
export type ToolName = (typeof AVAILABLE_TOOLS)[number];

export const TOOL_METADATA: Record<ToolName, { label: string; description: string; category: string }> = {
  getCurrentDateTime: {
    label: 'Get Current Date & Time',
    description: 'Allows the AI to look up the current date, time, and timezone.',
    category: 'Time',
  },
  fetchPage: {
    label: 'Fetch Page',
    description: 'Allows the AI to fetch a URL and extract its contents as Markdown, with support for chunked reading via start_index.',
    category: 'Web',
  },
};

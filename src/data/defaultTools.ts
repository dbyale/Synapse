export const AVAILABLE_TOOLS = ['getCurrentDateTime', 'searchWeb'] as const;
export type ToolName = (typeof AVAILABLE_TOOLS)[number];

export const TOOL_METADATA: Record<ToolName, { label: string; description: string; category: string }> = {
  getCurrentDateTime: {
    label: 'Get Current Date & Time',
    description: 'Allows the AI to look up the current date, time, and timezone.',
    category: 'Time',
  },
  searchWeb: {
    label: 'Search the Web',
    description: 'Allows the AI to search the web and read full page content from results.',
    category: 'Web Search',
  },
};

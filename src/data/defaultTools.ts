export const AVAILABLE_TOOLS = ['get_current_time', 'convert_time', 'fetchPage'] as const;
export type ToolName = (typeof AVAILABLE_TOOLS)[number];

export const TOOL_METADATA: Record<ToolName, { label: string; description: string; category: string }> = {
  get_current_time: {
    label: 'Get Current Time',
    description: 'Allows the AI to get the current time in any IANA timezone, including UTC offset and DST status.',
    category: 'Time',
  },
  convert_time: {
    label: 'Convert Time Between Timezones',
    description: 'Allows the AI to convert a time from one timezone to another, showing the time difference and DST info for both zones.',
    category: 'Time',
  },
  fetchPage: {
    label: 'Fetch Page',
    description: 'Allows the AI to fetch a URL and extract its contents as Markdown, with support for chunked reading via start_index.',
    category: 'Web',
  },
};

// npm install turndown
// npm install -D @types/turndown

import type { defineChatSessionFunction as DefineChatSessionFunctionType } from 'node-llama-cpp';

import { fetchPage } from './functions/fetchPage';
import { AVAILABLE_TOOLS, TOOL_METADATA } from '../data/defaultTools';

type DefineFn = typeof DefineChatSessionFunctionType;

export function createChatFunctions(defineFn: DefineFn) {
  return {
    getCurrentDateTime: defineFn({
      description:
        'Get the current local date, time, and timezone. ' +
        'Returns an object with date, time, timezone, and ISO 8601 string. ',
      params: {
        type: 'object',
        properties: {
          timezone: {
            oneOf: [
              { type: 'null' },
              { type: 'string' },
            ],
          },
        },
      },
      async handler(params) {
        const requestedZone = params.timezone ?? null;
        const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const zone = requestedZone ?? systemZone;
        const now = new Date();

        try {
          const fmt = (opts: Intl.DateTimeFormatOptions) =>
            new Intl.DateTimeFormat('en-US', { ...opts, timeZone: zone }).format(now);

          return {
            date:     fmt({ year: 'numeric', month: 'long', day: 'numeric' }),
            time:     fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
            timezone: zone,
            iso:      now.toISOString(),
          };
        } catch {
          return (
            `Unrecognized timezone "${zone}". ` +
            `Current system time: ${now.toLocaleString()} (${systemZone})`
          );
        }
      },
    }),

    fetchPage: defineFn({
      description:
        'Fetches information from a URL.' +
        'Use start_index to read large pages in chunks and find the information you need.' +
        'When the exact URL is unknown use a search engine to find the correct URL, or, visit the site homepage and use fetchPage to explore the site and find the correct URL.',
      params: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
          max_length: {
            type: 'integer',
            description: 'Maximum number of characters to return (default: 5000)',
          },
          start_index: {
            type: 'integer',
            description: 'Start content from this character index (default: 0)',
          },
          raw: {
            type: 'boolean',
            description: 'Get raw content without markdown conversion (default: false)',
          },
        },
        required: ['url'],
      },
      async handler(params) {
        const {
          url,
          max_length = 5000,
          start_index = 0,
          raw = false,
        } = params;

        try {
          const content = await fetchPage(url, raw);

          // Check if the result is an error message
          if (content.startsWith('Error:')) {
            return content;
          }

          const sliced = content.slice(start_index, start_index + max_length);
          return sliced || 'No content found at the specified index.';
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('timeout')) {
            return `Error: Request timeout while fetching ${url}`;
          }

          if (errorMessage.includes('Invalid URL')) {
            return `Error: Invalid URL provided: ${url}`;
          }

          return `Error: Failed to fetch ${url}. ${errorMessage}`;
        }
      },
    }),
  };
}

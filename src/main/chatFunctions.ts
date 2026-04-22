// npm install turndown
// npm install -D @types/turndown

import type { defineChatSessionFunction as DefineChatSessionFunctionType } from 'node-llama-cpp';
import TurndownService from 'turndown';

import { AVAILABLE_TOOLS, TOOL_METADATA } from '../data/defaultTools';

type DefineFn = typeof DefineChatSessionFunctionType;

const turndown = new TurndownService();

export function createChatFunctions(defineFn: DefineFn) {
  return {
    getCurrentDateTime: defineFn({
      description:
        'Get the current local date, time, and timezone. ' +
        'Returns an object with date, time, timezone, and ISO 8601 string. ' +
        'Make sure to use this information in a format readable to humans',
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
        'Fetches a URL from the internet and extracts its contents as markdown. ' +
        'Use start_index to read large pages in chunks and find the information you need.',
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
          new URL(url);

          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          if (!response.ok) {
            return `Error: Failed to fetch URL. Status ${response.status}: ${response.statusText}`;
          }

          const contentType = response.headers.get('content-type') || '';
          let content = '';

          if (contentType.includes('application/json')) {
            const json = await response.json();
            content = JSON.stringify(json, null, 2);
          } else {
            content = await response.text();

            if (!raw && contentType.includes('text/html')) {
              content = turndown.turndown(content);
            }
          }

          content = content.replace(/\n{3,}/g, '\n\n').trim();

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

// npm install duck-duck-scrape node-fetch@2 cheerio

// Import only the TYPE — erased at compile time, webpack never sees a real import
import type { defineChatSessionFunction as DefineChatSessionFunctionType } from 'node-llama-cpp';

import { search as duckSearch } from 'duck-duck-scrape';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

import { AVAILABLE_TOOLS, TOOL_METADATA } from '../data/defaultTools';

type DefineFn = typeof DefineChatSessionFunctionType;

interface SearchResult {
  url:     string;
  title:   string;
  content: string;
}

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

    searchWeb: defineFn({
      description:
        'Search the web using DuckDuckGo and scrape the top result pages for full content. ' +
        'Returns an array of { url, title, content } objects. Best for current information, research, and detailed topic exploration.',
      params: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
          },
          max_results: {
            oneOf: [
              { type: 'null' },
              { type: 'number' },
            ],
          },
        },
        required: ['query'],
      },
      async handler(params) {
        const query = params.query as string;
        const maxResults = params.max_results ?? 1;

        try {
          const searchResults = await duckSearch(query);

          if (!searchResults.results || searchResults.results.length === 0) {
            return `No search results found for "${query}".`;
          }

          const resultsToFetch = searchResults.results.slice(0, maxResults);
          const scrapedResults: SearchResult[] = [];

          for (const result of resultsToFetch) {
            try {
              const response = await fetch(result.url, {
                timeout: 10000,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
              });

              if (!response.ok) {
                continue;
              }

              const html = await response.text();
              const $ = cheerio.load(html);

              // Remove script, style, nav, footer tags
              $('script, style, nav, footer').remove();

              // Extract body text
              const bodyText = $('body').text();

              // Collapse whitespace
              const cleanedText = bodyText
                .replace(/\s+/g, ' ')
                .trim();

              // Cap at 1500 chars
              const content = cleanedText.substring(0, 1500);

              scrapedResults.push({
                url:     result.url,
                title:   result.title,
                content: content,
              });
            } catch {
              // Skip failed pages silently
              continue;
            }
          }

          if (scrapedResults.length === 0) {
            return `Could not scrape any content from search results for "${query}".`;
          }

          return scrapedResults;
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      },
    }),
  };
}

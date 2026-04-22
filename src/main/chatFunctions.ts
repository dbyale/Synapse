// Import only the TYPE — erased at compile time, webpack never sees a real import
import type { defineChatSessionFunction as DefineChatSessionFunctionType } from 'node-llama-cpp';

import { AVAILABLE_TOOLS, TOOL_METADATA } from '../data/defaultTools';

type DefineFn = typeof DefineChatSessionFunctionType;

const DDG_API_BASE = 'https://api.duckduckgo.com/';

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
        'Search the web using the DuckDuckGo Instant Answer API. ' +
        'Returns an abstract summary, instant answer, definition, and related topics. ' +
        'Best for factual lookups, definitions, and topic summaries. ' +
        'Note: does not return full web search results — use for quick facts only.',
      params: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
          },
          skip_disambig: {
            oneOf: [
              { type: 'null' },
              { type: 'boolean' },
            ],
          },
        },
        required: ['query'],
      },
      async handler(params) {
        const url = new URL(DDG_API_BASE);
        url.searchParams.set('q',            params.query);
        url.searchParams.set('format',       'json');
        url.searchParams.set('no_html',      '1');
        url.searchParams.set('skip_disambig', params.skip_disambig ? '1' : '0');
        url.searchParams.set('t',            'node-llama-cpp-chat');

        try {
          const response = await fetch(url.toString(), {
            headers: { 'Accept': 'application/json' },
          });

          if (!response.ok) {
            return `DuckDuckGo API error: ${response.status} ${response.statusText}`;
          }

          const data = await response.json() as DDGResponse;
          const result: DDGResult = {};

          if (data.Answer)         result.answer         = data.Answer;
          if (data.AbstractText)   result.abstract        = data.AbstractText;
          if (data.AbstractSource) result.source          = data.AbstractSource;
          if (data.AbstractURL)    result.sourceUrl       = data.AbstractURL;
          if (data.Definition)     result.definition      = data.Definition;
          if (data.DefinitionURL)  result.definitionUrl   = data.DefinitionURL;

          if (data.RelatedTopics?.length) {
            result.relatedTopics = data.RelatedTopics
              .filter((t): t is DDGTopic => 'Text' in t && !!t.Text)
              .slice(0, 5)
              .map(t => ({ text: t.Text, url: t.FirstURL }));
          }

          if (Object.keys(result).length === 0) {
            return (
              `No instant answer found for "${params.query}". ` +
              'Try rephrasing, or use a more specific term.'
            );
          }

          return result;
        } catch (err) {
          return `Failed to fetch search results: ${String(err)}`;
        }
      },
    }),
  };
}

// ── DuckDuckGo Instant Answer API response types ──────────────────────────────

interface DDGResponse {
  Answer?:         string;
  AbstractText?:   string;
  AbstractSource?: string;
  AbstractURL?:    string;
  Definition?:     string;
  DefinitionURL?:  string;
  RelatedTopics?:  (DDGTopic | DDGTopicGroup)[];
}

interface DDGTopic {
  Text:     string;
  FirstURL: string;
}

interface DDGTopicGroup {
  Name:   string;
  Topics: DDGTopic[];
}

interface DDGResult {
  answer?:        string;
  abstract?:      string;
  source?:        string;
  sourceUrl?:     string;
  definition?:    string;
  definitionUrl?: string;
  relatedTopics?: { text: string; url: string }[];
}

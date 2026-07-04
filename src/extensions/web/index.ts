import type { ExtensionToolDef } from '../types';
import { fetchPage as fetchPageImpl } from '../../main/functions/fetchPage';
import manifest from './manifest.json';

export const tools: Record<string, ExtensionToolDef> = {
  fetchPage: {
    meta: {
      name: 'fetchPage',
      label: 'Fetch Page',
      description: 'Allows the AI to read webpages or portions of webpages from many URLs.',
      icon: 'Globe',
    },
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
    async handler(params: { url: string; max_length?: number; start_index?: number; raw?: boolean }) {
      const { url, max_length = 5000, start_index = 0, raw = false } = params;
      try {
        const content = await fetchPageImpl(url, raw);
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
  },
};

export { manifest };

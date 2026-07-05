import type { ExtensionToolDef } from '../types';
import { createMemoryManager } from '../../main/functions/memory';
import manifest from './manifest.json';

const memory = createMemoryManager();

export const tools: Record<string, ExtensionToolDef> = {
  save_memory: {
    meta: {
      name: 'save_memory',
      label: 'Save Memory',
      description: 'Save or update a memory as a markdown file in local storage.',
      descriptionForModel:
        'Save a new memory or update an existing one. Each memory is stored as a markdown (.md) file in the app\'s local user data directory.\n' +
        'If a memory with the same title already exists, it will be updated (preserving the original creation date, type, and tags unless new values are provided).\n' +
        'Use this to persistently store information about people, projects, concepts, events, or anything else you want the AI to remember across conversations.\n' +
        'Parameters:\n' +
        '  title (required) — unique title for the memory (used as the filename)\n' +
        '  content (required) — markdown body content with observations, notes, details\n' +
        '  type (optional) — category: person, place, concept, event, project, code, book, etc.\n' +
        '  tags (optional) — array of tag strings for categorization and search\n' +
        'TIP: Use [[WikiLinks]] in content to cross-reference other memories (e.g. [[Project Alpha]]).',
      icon: 'Save',
    },
    params: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Unique title for the memory (used as the filename).' },
        content: { type: 'string', description: 'Markdown body content with observations, notes, and details.' },
        type: { type: 'string', description: 'Category: person, place, concept, event, project, code, book, etc.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization.' },
      },
      required: ['title', 'content'],
    },
    async handler(params: { title: string; content: string; type?: string; tags?: string[] }) {
      return await memory.saveMemory(params.title, params.content, params.type, params.tags);
    },
  },

  read_memory: {
    meta: {
      name: 'read_memory',
      label: 'Read Memory',
      description: 'Read a memory markdown file by title and return its full content with metadata.',
      descriptionForModel:
        'Read a specific memory by its title. Returns the full markdown content, frontmatter metadata (type, tags, created, modified), and any cross-references found via [[WikiLinks]].\n' +
        'If the memory is not found, use search_memories or list_memories to find available memories.\n' +
        'Parameters:\n' +
        '  title (required) — the memory title to read',
      icon: 'FileText',
    },
    params: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The memory title to read.' },
      },
      required: ['title'],
    },
    async handler(params: { title: string }) {
      return await memory.readMemory(params.title);
    },
  },

  search_memories: {
    meta: {
      name: 'search_memories',
      label: 'Search Memories',
      description: 'Search across all memory files by keyword, type, or tag.',
      descriptionForModel:
        'Search all saved memories for a keyword. The query searches across memory titles, body content, types, and tags. Returns results with a content snippet and related memory cross-references.\n' +
        'You can optionally filter by type (e.g. "person", "project") or exact tag match.\n' +
        'Parameters:\n' +
        '  query (required) — keyword to search for in titles, content, types, and tags\n' +
        '  type (optional) — filter by exact memory type (person, place, concept, event, project, etc.)\n' +
        '  tag (optional) — filter by exact tag name',
      icon: 'Search',
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search for in titles, content, types, and tags.' },
        type: { type: 'string', description: 'Filter by exact memory type (person, place, concept, etc.).' },
        tag: { type: 'string', description: 'Filter by exact tag name.' },
      },
      required: ['query'],
    },
    async handler(params: { query: string; type?: string; tag?: string }) {
      return await memory.searchMemories(params.query, params.type, params.tag);
    },
  },

  delete_memory: {
    meta: {
      name: 'delete_memory',
      label: 'Delete Memory',
      description: 'Delete a memory markdown file by title.',
      descriptionForModel:
        'Permanently delete a memory by its title. This removes the markdown file from disk. This action cannot be undone.\n' +
        'Parameters:\n' +
        '  title (required) — the memory title to delete',
      icon: 'Trash2',
    },
    params: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The memory title to delete.' },
      },
      required: ['title'],
    },
    async handler(params: { title: string }) {
      return await memory.deleteMemory(params.title);
    },
  },

  list_memories: {
    meta: {
      name: 'list_memories',
      label: 'List Memories',
      description: 'List all saved memories, optionally filtered by type or tag.',
      descriptionForModel:
        'List all saved memories with their metadata (title, type, tags, created, modified). Results are sorted by modification date (newest first).\n' +
        'You can optionally filter by type or tag to narrow the list.\n' +
        'This is useful for getting an overview of what information is stored, or for finding memory titles to pass to read_memory.\n' +
        'Parameters:\n' +
        '  type (optional) — filter by exact memory type (person, place, concept, event, project, etc.)\n' +
        '  tag (optional) — filter by exact tag name',
      icon: 'List',
    },
    params: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by exact memory type (person, place, concept, etc.).' },
        tag: { type: 'string', description: 'Filter by exact tag name.' },
      },
    },
    async handler(params: { type?: string; tag?: string }) {
      return await memory.listMemories(params.type, params.tag);
    },
  },
};

export { manifest };

import type { ExtensionToolDef } from '../types';
import { createMemoryManager } from '../../main/functions/memory';
import manifest from './manifest.json';

const memory = createMemoryManager('./memory.json');

export const tools: Record<string, ExtensionToolDef> = {
  create_entities: {
    meta: {
      name: 'create_entities',
      label: 'Create Entities',
      description: 'Create new entities in the memory knowledge graph',
      icon: 'Boxes',
    },
    params: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name of the entity' },
              entityType: { type: 'string', description: 'Type of the entity' },
              observations: { type: 'array', items: { type: 'string' }, description: 'Initial observations about the entity' },
            },
          },
          description: 'Array of entities to create',
        },
      },
      required: ['entities'],
    },
    async handler(params: { entities: Array<{ name: string; entityType: string; observations?: string[] }> }) {
      try { return await memory.createEntities(params.entities); }
      catch (error) { return { error: `Failed to create entities: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  create_relations: {
    meta: {
      name: 'create_relations',
      label: 'Create Relations',
      description: 'Create relations between existing entities in the memory graph',
      icon: 'Link',
    },
    params: {
      type: 'object',
      properties: {
        relations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source entity name' },
              to: { type: 'string', description: 'Target entity name' },
              relationType: { type: 'string', description: 'Type of the relation' },
            },
          },
          description: 'Array of relations to create',
        },
      },
      required: ['relations'],
    },
    async handler(params: { relations: Array<{ from: string; to: string; relationType: string }> }) {
      try { return await memory.createRelations(params.relations); }
      catch (error) { return { error: `Failed to create relations: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  add_observations: {
    meta: {
      name: 'add_observations',
      label: 'Add Observations',
      description: 'Add observations to an existing entity in the memory graph',
      icon: 'Edit',
    },
    params: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'Name of the entity' },
              observations: { type: 'array', items: { type: 'string' }, description: 'Observations to add' },
            },
          },
          description: 'Array of entity updates with observations',
        },
      },
      required: ['updates'],
    },
    async handler(params: { updates: Array<{ entityName: string; observations: string[] }> }) {
      try { return await memory.addObservations(params.updates); }
      catch (error) { return { error: `Failed to add observations: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  delete_entities: {
    meta: {
      name: 'delete_entities',
      label: 'Delete Entities',
      description: 'Delete entities and their associated relations from the memory graph',
      icon: 'Scissors',
    },
    params: {
      type: 'object',
      properties: {
        entityNames: { type: 'array', items: { type: 'string' }, description: 'Names of entities to delete' },
      },
      required: ['entityNames'],
    },
    async handler(params: { entityNames: string[] }) {
      try { return await memory.deleteEntities(params.entityNames); }
      catch (error) { return { error: `Failed to delete entities: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  delete_observations: {
    meta: {
      name: 'delete_observations',
      label: 'Delete Observations',
      description: 'Delete specific observations from an entity in the memory graph',
      icon: 'Scissors',
    },
    params: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'Name of the entity' },
              observations: { type: 'array', items: { type: 'string' }, description: 'Observations to delete' },
            },
          },
          description: 'Array of entity updates with observations to delete',
        },
      },
      required: ['updates'],
    },
    async handler(params: { updates: Array<{ entityName: string; observations: string[] }> }) {
      try { return await memory.deleteObservations(params.updates); }
      catch (error) { return { error: `Failed to delete observations: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  delete_relations: {
    meta: {
      name: 'delete_relations',
      label: 'Delete Relations',
      description: 'Delete specific relations between entities in the memory graph',
      icon: 'Scissors',
    },
    params: {
      type: 'object',
      properties: {
        relations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source entity name' },
              to: { type: 'string', description: 'Target entity name' },
              relationType: { type: 'string', description: 'Type of the relation' },
            },
          },
          description: 'Array of relations to delete',
        },
      },
      required: ['relations'],
    },
    async handler(params: { relations: Array<{ from: string; to: string; relationType: string }> }) {
      try { return await memory.deleteRelations(params.relations); }
      catch (error) { return { error: `Failed to delete relations: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  read_graph: {
    meta: {
      name: 'read_graph',
      label: 'Read Graph',
      description: 'Read the full memory knowledge graph including all entities and relations',
      icon: 'Network',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      try { return await memory.readGraph(); }
      catch (error) { return { error: `Failed to read graph: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  search_nodes: {
    meta: {
      name: 'search_nodes',
      label: 'Search Nodes',
      description: 'Search entities and observations in the memory graph by keyword',
      icon: 'Search',
    },
    params: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query term' } },
      required: ['query'],
    },
    async handler(params: { query: string }) {
      try { return await memory.searchNodes({ searchTerm: params.query, observationKeyword: params.query }); }
      catch (error) { return { error: `Failed to search nodes: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
  open_nodes: {
    meta: {
      name: 'open_nodes',
      label: 'Open Nodes',
      description: 'Retrieve specific entities and the relations between them from the memory graph',
      icon: 'Target',
    },
    params: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Names of nodes to open' },
      },
      required: ['names'],
    },
    async handler(params: { names: string[] }) {
      try { return await memory.openNodes(params.names); }
      catch (error) { return { error: `Failed to open nodes: ${error instanceof Error ? error.message : String(error)}` }; }
    },
  },
};

export { manifest };

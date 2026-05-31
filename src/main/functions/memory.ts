import { promises as fs } from 'fs';
import path from 'path';

/**
 * Knowledge Graph Data Structures
 */
export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

/**
 * MemoryManager: Handles all knowledge graph operations with file persistence
 */
export class MemoryManager {
  private filePath: string;

  constructor(filePath: string = './memory.json') {
    this.filePath = filePath;
  }

  /**
   * Load the knowledge graph from file
   * Returns empty graph if file doesn't exist
   */
  private async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is invalid JSON - return empty graph
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entities: [], relations: [] };
      }
      // If it's a JSON parse error, also return empty graph
      if (error instanceof SyntaxError) {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  /**
   * Save the knowledge graph to file
   */
  private async saveGraph(graph: KnowledgeGraph): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (dir !== '.') {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(this.filePath, JSON.stringify(graph, null, 2), 'utf-8');
  }

  /**
   * Create multiple entities (ignore duplicates by name)
   */
  async createEntities(
    entities: Array<{ name: string; entityType: string }>,
  ): Promise<{ created: number; skipped: number }> {
    const graph = await this.loadGraph();
    const existingNames = new Set(graph.entities.map((e) => e.name));

    let created = 0;
    for (const entity of entities) {
      if (!existingNames.has(entity.name)) {
        graph.entities.push({
          name: entity.name,
          entityType: entity.entityType,
          observations: [],
        });
        existingNames.add(entity.name);
        created++;
      }
    }

    await this.saveGraph(graph);
    return { created, skipped: entities.length - created };
  }

  /**
   * Create multiple relations (skip duplicates)
   */
  async createRelations(
    relations: Array<{ from: string; to: string; relationType: string }>,
  ): Promise<{ created: number; skipped: number }> {
    const graph = await this.loadGraph();

    // Check that both entities exist
    const entityNames = new Set(graph.entities.map((e) => e.name));
    const validRelations = relations.filter(
      (r) => entityNames.has(r.from) && entityNames.has(r.to),
    );

    // Remove duplicates
    const relationKey = (r: Relation) => `${r.from}|${r.to}|${r.relationType}`;
    const existingKeys = new Set(graph.relations.map(relationKey));

    let created = 0;
    for (const relation of validRelations) {
      const key = relationKey(relation);
      if (!existingKeys.has(key)) {
        graph.relations.push(relation);
        existingKeys.add(key);
        created++;
      }
    }

    await this.saveGraph(graph);
    return { created, skipped: relations.length - created };
  }

  /**
   * Add observations to existing entities
   * Fails if entity doesn't exist
   */
  async addObservations(
    updates: Array<{ entityName: string; observations: string[] }>,
  ): Promise<{ success: boolean; message: string; updated: number }> {
    const graph = await this.loadGraph();
    const entityMap = new Map(graph.entities.map((e) => [e.name, e]));

    let updated = 0;
    const errors: string[] = [];

    for (const update of updates) {
      const entity = entityMap.get(update.entityName);
      if (!entity) {
        errors.push(`Entity "${update.entityName}" not found`);
        continue; // ← skip, don't return
      }

      // Add non-duplicate observations
      const existingSet = new Set(entity.observations);
      for (const obs of update.observations) {
        if (!existingSet.has(obs)) {
          entity.observations.push(obs);
          existingSet.add(obs);
        }
      }
      updated++;
    }

    // Always save — even if some entities were missing
    await this.saveGraph(graph);

    return {
      success: errors.length === 0,
      message:
        errors.length === 0
          ? 'Observations added'
          : `Partial success — errors: ${errors.join('; ')}`,
      updated,
    };
  }

  /**
   * Delete entities and cascade-delete their relations
   */
  async deleteEntities(entityNames: string[]): Promise<{ deleted: number }> {
    const graph = await this.loadGraph();
    const namesToDelete = new Set(entityNames);

    // Remove entities
    graph.entities = graph.entities.filter((e) => !namesToDelete.has(e.name));

    // Cascade-delete relations involving deleted entities
    graph.relations = graph.relations.filter(
      (r) => !namesToDelete.has(r.from) && !namesToDelete.has(r.to),
    );

    await this.saveGraph(graph);
    return { deleted: entityNames.length };
  }

  /**
   * Remove specific observations from entities (silent if not found)
   */
  async deleteObservations(
    updates: Array<{ entityName: string; observations: string[] }>,
  ): Promise<{ success: boolean }> {
    const graph = await this.loadGraph();
    const entityMap = new Map(graph.entities.map((e) => [e.name, e]));

    for (const update of updates) {
      const entity = entityMap.get(update.entityName);
      if (entity) {
        const obsSet = new Set(update.observations);
        entity.observations = entity.observations.filter(
          (obs) => !obsSet.has(obs),
        );
      }
    }

    await this.saveGraph(graph);
    return { success: true };
  }

  /**
   * Remove specific relations (silent if not found)
   */
  async deleteRelations(
    relations: Array<{ from: string; to: string; relationType: string }>,
  ): Promise<{ deleted: number }> {
    const graph = await this.loadGraph();
    const relationKey = (r: Relation) => `${r.from}|${r.to}|${r.relationType}`;
    const keysToDelete = new Set(relations.map(relationKey));

    const initialLength = graph.relations.length;
    graph.relations = graph.relations.filter(
      (r) => !keysToDelete.has(relationKey(r)),
    );

    await this.saveGraph(graph);
    return { deleted: initialLength - graph.relations.length };
  }

  /**
   * Return the entire knowledge graph
   */
  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  /**
   * Search entities by name, type, or observation content
   * Returns matching entities + all relations involving those entities
   */
  async searchNodes(query: {
    searchTerm?: string;
    entityType?: string;
    observationKeyword?: string;
  }): Promise<{
    entities: Entity[];
    relations: Relation[];
  }> {
    const graph = await this.loadGraph();
    const matchedEntityNames = new Set<string>();

    // Filter by search term (matches name)
    if (query.searchTerm) {
      const term = query.searchTerm.toLowerCase();
      graph.entities.forEach((e) => {
        if (e.name.toLowerCase().includes(term)) {
          matchedEntityNames.add(e.name);
        }
      });
    }

    // Filter by entity type
    if (query.entityType) {
      graph.entities.forEach((e) => {
        if (e.entityType === query.entityType) {
          matchedEntityNames.add(e.name);
        }
      });
    }

    // Filter by observation keyword
    if (query.observationKeyword) {
      const keyword = query.observationKeyword.toLowerCase();
      graph.entities.forEach((e) => {
        if (e.observations.some((obs) => obs.toLowerCase().includes(keyword))) {
          matchedEntityNames.add(e.name);
        }
      });
    }

    // Get matched entities
    const entities = graph.entities.filter((e) =>
      matchedEntityNames.has(e.name),
    );

    // Get relations involving matched entities
    const relations = graph.relations.filter(
      (r) => matchedEntityNames.has(r.from) || matchedEntityNames.has(r.to),
    );

    return { entities, relations };
  }

  /**
   * Retrieve specific entities by name + relations BETWEEN them
   */
  async openNodes(entityNames: string[]): Promise<{
    entities: Entity[];
    relations: Relation[];
  }> {
    const graph = await this.loadGraph();
    const namesSet = new Set(entityNames);

    // Get requested entities
    const entities = graph.entities.filter((e) => namesSet.has(e.name));

    // Get relations BETWEEN the requested nodes only
    const relations = graph.relations.filter(
      (r) => namesSet.has(r.from) && namesSet.has(r.to),
    );

    return { entities, relations };
  }
}

/**
 * Factory function for creating a MemoryManager instance
 */
export function createMemoryManager(
  filePath: string = './memory.json',
): MemoryManager {
  return new MemoryManager(filePath);
}

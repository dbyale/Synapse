// eslint-disable-next-line import/no-cycle
import { getExtensionRegistry } from './extensionRegistry';

type ChatFunctionDef = {
  description: string;
  params: Record<string, any>;
  handler: (params: any, context?: any) => any;
  name?: string;
  displayType?: string;
  tags?: string[];
  /**
   * Owning extension id. Settings are declared per extension, so the caller
   * needs the owner to bind that extension's settings into the tool context.
   */
  extensionId?: string;
};

export function createChatFunctions() {
  const registry = getExtensionRegistry();
  const allTools = registry.getAllTools();
  const owners = registry.getToolOwners();
  const result: Record<string, ChatFunctionDef> = {};
  for (const [name, tool] of Object.entries(allTools)) {
    result[name] = {
      name,
      description: tool.meta.descriptionForModel ?? tool.meta.description,
      params: tool.params,
      handler: tool.handler,
      displayType: tool.meta.displayType,
      tags: tool.meta.tags,
      extensionId: owners[name],
    };
  }
  return result;
}

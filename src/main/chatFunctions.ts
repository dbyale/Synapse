// eslint-disable-next-line import/no-cycle
import { getExtensionRegistry } from './extensionRegistry';

type ChatFunctionDef = {
  description: string;
  params: Record<string, any>;
  handler: (params: any) => any;
  name?: string;
  displayType?: string;
  tags?: string[];
};

export function createChatFunctions() {
  const allTools = getExtensionRegistry().getAllTools();
  const result: Record<string, ChatFunctionDef> = {};
  for (const [name, tool] of Object.entries(allTools)) {
    result[name] = {
      name,
      description: tool.meta.descriptionForModel ?? tool.meta.description,
      params: tool.params,
      handler: tool.handler,
      displayType: tool.meta.displayType,
      tags: tool.meta.tags,
    };
  }
  return result;
}

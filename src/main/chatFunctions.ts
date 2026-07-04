import { getExtensionRegistry } from './extensionRegistry';

type ChatFunctionDef = {
  description: string;
  params: Record<string, any>;
  handler: (params: any) => any;
  name?: string;
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
    };
  }
  return result;
}

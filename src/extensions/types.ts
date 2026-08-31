export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  icon: string;
  builtIn: boolean;
  iconSvgData?: string;
  hasSettings?: boolean;
}

export interface ExtensionToolMeta {
  name: string;
  label: string;
  description: string;
  descriptionForHuman?: string;
  descriptionForModel?: string;
  icon: string;
  displayType?: string;
  tags?: string[];
}

export interface ExtensionToolContext {
  sessionId: string;
  profileId: string;
}

export interface ExtensionToolDef {
  meta: ExtensionToolMeta;
  params: Record<string, any>;
  handler: (params: any, context?: ExtensionToolContext) => any;
}

export interface Extension {
  manifest: ExtensionManifest;
  tools: Record<string, ExtensionToolDef>;
  enabled: boolean;
  extensionDir?: string;
}

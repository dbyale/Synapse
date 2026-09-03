import { useState, MouseEvent, KeyboardEvent, useCallback } from 'react';
import {
  X,
  Settings,
  Puzzle,
  ChevronLeft,
  ChevronRight,
  Code2,
  ListTree,
} from 'lucide-react';
import FileSystemSettings from './FileSystemSettings';
import SandboxSettings from './SandboxSettings';
import GitHubExtensionSettings from './GitHubExtensionSettings';
import DDGSearchSettings from './DDGSearchSettings';
import ConfirmDialog from './ConfirmDialog';
import { resolveIcon } from './workflows/IconPicker';
import { svgToDataUrl } from '../utils/svgToDataUrl';
import { CodeBlock } from './MarkdownRenderer';
import './styles/ExtensionModal.css';

interface ToolInfo {
  name: string;
  label: string;
  description: string;
  descriptionForHuman?: string;
  descriptionForModel?: string;
  icon?: string;
  displayType?: string;
  tags?: string[];
}

interface ToolEntry {
  meta: ToolInfo;
  params: Record<string, any>;
}

interface ExtensionInfo {
  manifest: {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    icon: string;
    builtIn: boolean;
    iconSvgData?: string;
    hasSettings?: boolean;
  };
  tools: Record<string, ToolEntry>;
  enabled: boolean;
  extensionDir?: string;
}

interface ExtensionModalProps {
  extension: ExtensionInfo;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  array: 'array',
  object: 'object',
  null: 'null',
};

function paramTypes(param: any): string[] {
  const types: string[] = [];
  if (Array.isArray(param.type)) {
    types.push(...param.type.map((t: string) => t));
  } else if (typeof param.type === 'string') {
    types.push(param.type);
  }
  if (Array.isArray(param.oneOf)) {
    param.oneOf.forEach((option: any) => {
      if (option && typeof option.type === 'string') types.push(option.type);
    });
  }
  if (types.length === 0) types.push('any');
  return [...new Set(types)];
}

function formatType(param: any): string {
  const types = paramTypes(param);
  if (types.length === 1) return TYPE_LABELS[types[0]] ?? types[0];
  return types.map((t) => TYPE_LABELS[t] ?? t).join(' | ');
}

function formatExtra(param: any): string | null {
  const parts: string[] = [];
  if (param.enum !== undefined) {
    parts.push(`enum: ${JSON.stringify(param.enum)}`);
  }
  if (param.default !== undefined) {
    parts.push(`default: ${JSON.stringify(param.default)}`);
  }
  if (typeof param.minimum === 'number') parts.push(`min: ${param.minimum}`);
  if (typeof param.maximum === 'number') parts.push(`max: ${param.maximum}`);
  if (typeof param.minLength === 'number')
    parts.push(`minLength: ${param.minLength}`);
  if (typeof param.maxLength === 'number')
    parts.push(`maxLength: ${param.maxLength}`);
  if (param.items !== undefined) {
    parts.push(`items: ${formatType(param.items)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function SchemaParams({ params }: { params: Record<string, any> }) {
  const properties: Record<string, any> = params.properties ?? {};
  const required = Array.isArray(params.required)
    ? new Set(params.required as string[])
    : new Set<string>();
  const entries = Object.entries(properties);

  return (
    <div className="em-params">
      {params.type && params.type !== 'object' && (
        <div className="em-params-top">
          <span className="em-param-meta">
            type:{' '}
            <span className="em-param-type-chip">{formatType(params)}</span>
          </span>
        </div>
      )}
      {entries.length === 0 ? (
        <div className="em-empty em-params-empty">
          This tool accepts no parameters.
        </div>
      ) : (
        entries.map(([name, prop]) => (
          <div key={name} className="em-param-row">
            <div className="em-param-row-head">
              <code className="em-param-name">{name}</code>
              <span className="em-param-chip">{formatType(prop)}</span>
              {required.has(name) && (
                <span className="em-param-chip em-param-chip--required">
                  required
                </span>
              )}
            </div>
            {prop.description && (
              <div className="em-param-desc">{prop.description}</div>
            )}
            {prop.descriptionForModel && (
              <div className="em-param-desc em-param-desc--model">
                Model: {prop.descriptionForModel}
              </div>
            )}
            {formatExtra(prop) && (
              <div className="em-param-extra">{formatExtra(prop)}</div>
            )}
          </div>
        ))
      )}
      {params.additionalProperties !== undefined && (
        <div className="em-params-top">
          <span className="em-param-meta">
            additionalProperties:{' '}
            <span className="em-param-chip">
              {typeof params.additionalProperties === 'boolean'
                ? String(params.additionalProperties)
                : formatType(params.additionalProperties)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function ToolDetail({ tool, onBack }: { tool: ToolEntry; onBack: () => void }) {
  const [view, setView] = useState<'params' | 'raw'>('params');
  const { meta } = tool;
  const modelDescription = meta.descriptionForModel ?? meta.description;

  const rawJson = JSON.stringify(
    { name: meta.name, description: modelDescription, parameters: tool.params },
    null,
    2,
  );

  return (
    <div className="em-tool-detail">
      <button type="button" className="em-back-btn" onClick={onBack}>
        <ChevronLeft size={14} />
        All tools
      </button>

      <div className="em-tool-detail-head">
        <div className="em-tool-name">{meta.label}</div>
        <code className="em-tool-name-code">name: {meta.name}</code>
      </div>

      <div className="em-tool-section">
        <div className="em-tool-section-title">
          Description given to the model
        </div>
        <div className="em-tool-detail-desc">{modelDescription}</div>
        {meta.descriptionForHuman &&
          meta.descriptionForHuman !== modelDescription && (
            <>
              <div className="em-tool-section-title em-tool-section-title--sub">
                Description for users
              </div>
              <div className="em-tool-detail-desc em-tool-detail-desc--human">
                {meta.descriptionForHuman}
              </div>
            </>
          )}
      </div>

      <div className="em-tool-view-tabs">
        <button
          type="button"
          className={`em-tool-view-tab${view === 'params' ? ' em-tool-view-tab--active' : ''}`}
          onClick={() => setView('params')}
        >
          <ListTree size={13} />
          Parameters
        </button>
        <button
          type="button"
          className={`em-tool-view-tab${view === 'raw' ? ' em-tool-view-tab--active' : ''}`}
          onClick={() => setView('raw')}
        >
          <Code2 size={13} />
          Raw JSON
        </button>
      </div>

      {view === 'params' ? (
        <SchemaParams params={tool.params} />
      ) : (
        <div className="em-tool-raw">
          <div className="em-tool-raw-head">
            <span className="em-tool-raw-label">
              Exact JSON sent to the model
            </span>
          </div>
          <CodeBlock lang="json" code={rawJson} />
        </div>
      )}
    </div>
  );
}

export default function ExtensionModal({
  extension,
  onClose,
}: ExtensionModalProps) {
  const [tab, setTab] = useState<'tools' | 'settings'>('tools');
  const [selectedTool, setSelectedTool] = useState<ToolEntry | null>(null);
  const [showRestartDialog, setShowRestartDialog] = useState(false);

  const isExtensionActiveInCurrentProfile = useCallback(() => {
    try {
      if (!extension.enabled) return false;
      const selectedId = localStorage.getItem('selectedProfileId');
      if (!selectedId) return false;
      const stored = localStorage.getItem('profiles');
      if (!stored) return false;
      const profiles = JSON.parse(stored) as Array<{
        id: string;
        tools?: string[];
      }>;
      const cur = profiles.find((p) => p.id === selectedId);
      if (!cur) return false;
      // If profile has no explicit tools list, consider all enabled extensions as loaded
      if (!cur.tools || !Array.isArray(cur.tools) || cur.tools.length === 0) {
        return true;
      }
      const toolKeys = Object.keys(extension.tools);
      // If extension has no tools, consider it not loaded (no restart needed)
      if (toolKeys.length === 0) return false;
      return toolKeys.some((k) => cur.tools!.includes(k));
    } catch {
      return false;
    }
  }, [extension.tools, extension.enabled]);

  const handleSettingsSaved = useCallback(async () => {
    if (!isExtensionActiveInCurrentProfile()) return;
    try {
      const isRunning = await window.electronAPI
        .chatIsRunning()
        .catch(() => false);
      if (!isRunning) return;
      let hasContext = false;
      try {
        const { contextSize } = await window.electronAPI.chatContextSize();
        hasContext = contextSize != null && contextSize > 0;
      } catch {
        hasContext = false;
      }
      if (hasContext) {
        setShowRestartDialog(true);
      } else {
        // isRunning && !hasContext → auto restart, no prompt, preserve session
        try {
          await window.electronAPI.chatReloadProfile();
        } catch {
          // Silently fail
        }
      }
    } catch {
      // Ignore
    }
  }, [isExtensionActiveInCurrentProfile]);

  const handleRestartNow = useCallback(async () => {
    setShowRestartDialog(false);
    try {
      await window.electronAPI.chatReloadProfile();
    } catch {
      // Silently fail
    }
  }, []);

  const handleRestartLater = useCallback(() => {
    setShowRestartDialog(false);
  }, []);

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose();
  };

  const svgDataUrl = extension.manifest.iconSvgData
    ? svgToDataUrl(extension.manifest.iconSvgData)
    : null;

  const tools = Object.values(extension.tools);

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="em-overlay"
        onClick={handleOverlayClick}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={`${extension.manifest.name} details`}
      >
        <div className="em-dialog">
        <div className="em-header">
          <div className="em-header-left">
            <div className="em-header-icon">
              {svgDataUrl ? (
                <img src={svgDataUrl} alt="" className="em-header-svg-icon" />
              ) : (
                (() => {
                  const IconComp = extension.manifest.icon
                    ? resolveIcon(extension.manifest.icon)
                    : Puzzle;
                  return <IconComp size={20} />;
                })()
              )}
            </div>
            <div>
              <h2 className="em-title">{extension.manifest.name}</h2>
              <span className="em-version">v{extension.manifest.version}</span>
            </div>
          </div>
          <button
            type="button"
            className="em-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="em-tabs">
          <button
            type="button"
            className={`em-tab${tab === 'tools' ? ' em-tab--active' : ''}`}
            onClick={() => setTab('tools')}
          >
            <Puzzle size={14} />
            Tools ({tools.length})
          </button>
          {extension.manifest.hasSettings && (
            <button
              type="button"
              className={`em-tab${tab === 'settings' ? ' em-tab--active' : ''}`}
              onClick={() => setTab('settings')}
            >
              <Settings size={14} />
              Settings
            </button>
          )}
        </div>

        <div className="em-body">
          {tab === 'tools' &&
            (selectedTool ? (
              <ToolDetail
                tool={selectedTool}
                onBack={() => setSelectedTool(null)}
              />
            ) : (
              <div className="em-tools">
                {tools.length === 0 ? (
                  <div className="em-empty">No tools in this extension.</div>
                ) : (
                  tools.map((tool) => (
                    <button
                      type="button"
                      key={tool.meta.name}
                      className="em-tool-row"
                      onClick={() => setSelectedTool(tool)}
                    >
                      <div className="em-tool-info">
                        <div className="em-tool-name">{tool.meta.label}</div>
                        <div className="em-tool-desc">
                          {tool.meta.descriptionForHuman ??
                            tool.meta.description}
                        </div>
                        {(tool.meta.displayType === 'projector' ||
                          tool.meta.displayType === 'image' ||
                          tool.meta.tags?.includes('input') ||
                          tool.meta.tags?.includes('sources')) && (
                          <div className="em-tool-tags">
                            {tool.meta.tags?.includes('input') && (
                              <span className="em-tool-badge em-tool-badge--input">
                                Requires User Input
                              </span>
                            )}
                            {(tool.meta.displayType === 'projector' ||
                              tool.meta.displayType === 'image') && (
                              <span className="em-tool-badge em-tool-badge--image">
                                Displays Image
                              </span>
                            )}
                            {tool.meta.tags?.includes('sources') && (
                              <span className="em-tool-badge em-tool-badge--sources">
                                {tool.meta.tags?.includes('top_source')
                                  ? 'Adds Top Sources'
                                  : 'Adds Sources'}
                              </span>
                            )}
                            {tool.meta.displayType === 'projector' && (
                              <div className="em-tool-tags-row">
                                <span className="em-tool-badge em-tool-badge--vision">
                                  Requires vision model
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight size={16} className="em-tool-chevron" />
                    </button>
                  ))
                )}
              </div>
            ))}
          {tab === 'settings' && extension.manifest.id === 'filesystem' && (
            <FileSystemSettings onSaved={handleSettingsSaved} />
          )}
          {tab === 'settings' && extension.manifest.id === 'sandbox' && (
            <SandboxSettings onSaved={handleSettingsSaved} />
          )}
          {tab === 'settings' && extension.manifest.id === 'github' && (
            <GitHubExtensionSettings onSaved={handleSettingsSaved} />
          )}
          {tab === 'settings' && extension.manifest.id === 'ddg_search' && (
            <DDGSearchSettings onSaved={handleSettingsSaved} />
          )}
          {tab === 'settings' &&
            extension.manifest.id !== 'filesystem' &&
            extension.manifest.id !== 'sandbox' &&
            extension.manifest.id !== 'github' &&
            extension.manifest.id !== 'ddg_search' && (
              <div className="em-empty">
                Settings configuration is not available for this extension in
                the UI.
              </div>
            )}
        </div>
        </div>
      </div>
      {showRestartDialog && (
        <ConfirmDialog
          title="Restart Server?"
          message={`Changing ${extension.manifest.name} settings requires a server restart to take effect. Your current conversation will be preserved.`}
          confirmText="Restart Now"
          cancelText="Restart Later"
          onConfirm={handleRestartNow}
          onCancel={handleRestartLater}
        />
      )}
    </>
  );
}

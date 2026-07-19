import { useState, MouseEvent, KeyboardEvent } from 'react';
import { X, Settings, Puzzle } from 'lucide-react';
import FileSystemSettings from './FileSystemSettings';
import GitHubExtensionSettings from './GitHubExtensionSettings';
import { resolveIcon } from './workflows/IconPicker';
import './styles/ExtensionModal.css';

interface ToolInfo {
  name: string;
  label: string;
  description: string;
  descriptionForHuman?: string;
  icon?: string;
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
  tools: Record<string, { meta: ToolInfo; params: Record<string, any> }>;
  enabled: boolean;
  extensionDir?: string;
}

interface ExtensionModalProps {
  extension: ExtensionInfo;
  onClose: () => void;
}

export default function ExtensionModal({
  extension,
  onClose,
}: ExtensionModalProps) {
  const [tab, setTab] = useState<'tools' | 'settings'>('tools');

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose();
  };

  const IconComp = extension.manifest.icon
    ? resolveIcon(extension.manifest.icon)
    : Puzzle;

  const tools = Object.values(extension.tools);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
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
              <IconComp size={20} />
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
          {tab === 'tools' && (
            <div className="em-tools">
              {tools.length === 0 ? (
                <div className="em-empty">No tools in this extension.</div>
              ) : (
                tools.map((tool) => (
                  <div key={tool.meta.name} className="em-tool-row">
                    <div className="em-tool-info">
                      <div className="em-tool-name">{tool.meta.label}</div>
                      <div className="em-tool-desc">
                        {tool.meta.descriptionForHuman ?? tool.meta.description}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {tab === 'settings' && extension.manifest.id === 'filesystem' && (
            <FileSystemSettings />
          )}
          {tab === 'settings' && extension.manifest.id === 'github' && (
            <GitHubExtensionSettings />
          )}
          {tab === 'settings' &&
            extension.manifest.id !== 'filesystem' &&
            extension.manifest.id !== 'github' && (
              <div className="em-empty">
                Settings configuration is not available for this extension in
                the UI.
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

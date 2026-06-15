import { useState, MouseEvent, KeyboardEvent } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Wrench,
  Settings,
  PackageCheck,
  PackageMinus,
  Loader2,
} from 'lucide-react';
import { Profile } from '../types/profile';
import type { LocalModel } from '../preload.d';
import { AVAILABLE_TOOLS, TOOL_METADATA } from '../../data/defaultTools';
import { formatBytes } from '../utils/formatters';
import ModelSelectModal from './ModelSelectModal';
import ProjectorSelectModal from './ProjectorSelectModal';
import './styles/EditProfileModal.css';

interface VariantData {
  filename: string;
  quantization: string;
  sizeBytes: number;
}

interface GroupData {
  name: string;
  totalSize: number;
  variants: VariantData[];
}

interface EditProfileModalProps {
  profile: Profile | null;
  profiles: Profile[];
  localModels: LocalModel[];
  modelSelectGroups: GroupData[];
  availableModelsForEdit: Array<{
    filename: string;
    quantization: string;
    name: string;
  }>;
  groupedLocalModels: Array<{
    name: string;
    fileGroups: Array<{
      isProjector: boolean;
      quantization: string;
      parts: Array<{ filename: string; sizeBytes: number }>;
    }>;
    totalSize: number;
  }>;
  categorizedTools: Array<{ category: string; toolKeys: string[] }>;
  onSave: (updatedProfiles: Profile[]) => void;
  onClose: () => void;
}

const PAGE_DEPTH: Record<string, number> = {
  main: 0,
  'system-prompt': 1,
  tools: 1,
  advanced: 1,
  'repeat-penalty': 2,
};

const BREADCRUMB_MAP: Record<string, { label: string; parent: string | null }> =
  {
    main: { label: 'Profile', parent: null },
    'system-prompt': { label: 'System Prompt', parent: 'main' },
    tools: { label: 'Tools', parent: 'main' },
    advanced: { label: 'Advanced Parameters', parent: 'main' },
    'repeat-penalty': { label: 'Repeat Penalty', parent: 'advanced' },
  };

function buildBreadcrumb(page: string): Array<{ key: string; label: string }> {
  const crumbs: Array<{ key: string; label: string }> = [];
  let current: string | null = page;
  const map: Record<string, { label: string; parent: string | null }> =
    BREADCRUMB_MAP;
  while (current) {
    const info: (typeof BREADCRUMB_MAP)[string] | undefined = map[current];
    if (!info) break;
    crumbs.unshift({ key: current, label: info.label });
    current = info.parent;
  }
  return crumbs;
}

// ── Tool sub-component ──

function ToolCategoryCard({
  category,
  toolKeys,
  editTools,
  onToolToggle,
  onCategoryToggle,
}: {
  category: string;
  toolKeys: string[];
  editTools: string[];
  onToolToggle: (key: string) => void;
  onCategoryToggle: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const enabledCount = toolKeys.filter((tk) => editTools.includes(tk)).length;
  const totalCount = toolKeys.length;
  const allEnabled = enabledCount === totalCount;

  return (
    <div className="epm-tool-category">
      <button
        type="button"
        className={`epm-tool-category__header${isOpen ? ' open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronDown
          size={14}
          className={`epm-tool-category__chevron${isOpen ? ' open' : ''}`}
        />
        <span className="epm-tool-category__name">{category}</span>
        <span
          className="epm-tool-category__badge"
          onClick={(e) => {
            e.stopPropagation();
            onCategoryToggle();
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onCategoryToggle();
            }
          }}
        >
          {enabledCount}/{totalCount}
        </span>
      </button>
      {isOpen && (
        <div className="epm-tool-category__content">
          {toolKeys.map((toolKey) => {
            const meta = TOOL_METADATA[toolKey as keyof typeof TOOL_METADATA];
            const isChecked = editTools.includes(toolKey);
            return (
              <label
                key={toolKey}
                className={`epm-tool-row${isChecked ? ' epm-tool-row--checked' : ''}`}
              >
                <input
                  type="checkbox"
                  className="epm-tool-checkbox"
                  checked={isChecked}
                  onChange={() => onToolToggle(toolKey)}
                />
                <div className="epm-tool-info">
                  <div className="epm-tool-label">{meta.label}</div>
                  <div className="epm-tool-description">{meta.description}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page content components ──

function MainPage({
  editName,
  setEditName,
  editModel,
  editProjector,
  selectedModelDisplay,
  selectedProjectorDisplay,
  availableModelsForEdit,
  onOpenModelModal,
  onOpenProjectorModal,
  onNavigate,
  systemPromptPreview,
  toolsPreview,
  advancedPreview,
  editAutoOptimizer,
  editLayers,
  editContextSize,
  optimizerRunning,
  onRunOptimizer,
}: {
  editName: string;
  setEditName: (v: string) => void;
  editModel: string;
  editProjector: string;
  selectedModelDisplay: {
    groupName: string;
    filename: string;
    quantization: string;
    sizeBytes: number;
  } | null;
  selectedProjectorDisplay: {
    filename: string;
    quantization: string;
    sizeBytes: number;
  } | null;
  availableModelsForEdit: Array<{
    filename: string;
    quantization: string;
    name: string;
  }>;
  onOpenModelModal: () => void;
  onOpenProjectorModal: () => void;
  onNavigate: (page: string) => void;
  systemPromptPreview: string;
  toolsPreview: string;
  advancedPreview: string;
  editAutoOptimizer: 'longest-context' | 'most-gpu' | null;
  editLayers: number | undefined;
  editContextSize: number | undefined;
  optimizerRunning: 'longest-context' | 'most-gpu' | null;
  onRunOptimizer: (mode: 'longest-context' | 'most-gpu') => void;
}) {
  return (
    <div className="epm-main-grid">
      <div className="epm-main-left">
        <div className="epm-section">
          <div className="epm-section__label">Profile Name</div>
          <input
            type="text"
            className="epm-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Profile name..."
          />
        </div>

        <div className="epm-section">
          <div className="epm-section__label">Model</div>
          {availableModelsForEdit.length === 0 ? (
            <div
              style={{
                padding: '12px 16px',
                fontSize: '14px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-tertiary, rgba(0,0,0,0.02))',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
              }}
            >
              No models available
            </div>
          ) : (
            <button
              type="button"
              className={`sp-card__edit-select-trigger${selectedModelDisplay ? ' sp-card__edit-select-trigger--card' : ''}`}
              style={{ background: 'var(--bg-primary)' }}
              onClick={onOpenModelModal}
            >
              {selectedModelDisplay ? (
                <div className="sp-card__edit-select-trigger__card">
                  <div className="sp-card__edit-select-trigger__card-top">
                    <span className="sp-card__edit-select-trigger__card-name">
                      {selectedModelDisplay.groupName}
                    </span>
                    <ChevronDown
                      size={18}
                      className="sp-card__edit-select-trigger__chevron"
                    />
                  </div>
                  <div className="sp-card__edit-select-trigger__card-bottom">
                    <span className="sp-card__edit-select-trigger__card-quant">
                      {selectedModelDisplay.quantization.toUpperCase()}
                    </span>
                    <span className="sp-card__edit-select-trigger__card-size">
                      {formatBytes(selectedModelDisplay.sizeBytes)}
                    </span>
                    <span className="sp-card__edit-select-trigger__card-filename">
                      {selectedModelDisplay.filename}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="sp-card__edit-select-trigger__placeholder">
                  <span>No Model Selected</span>
                  <ChevronDown
                    size={18}
                    className="sp-card__edit-select-trigger__chevron"
                  />
                </div>
              )}
            </button>
          )}
        </div>

        {editModel && selectedProjectorDisplay !== undefined && (
          <div className="epm-section">
            <div className="epm-section__label">Projector (Optional)</div>
            <button
              type="button"
              className={`sp-card__edit-select-trigger${selectedProjectorDisplay ? ' sp-card__edit-select-trigger--card' : ''}`}
              style={{ background: 'var(--bg-primary)' }}
              onClick={onOpenProjectorModal}
            >
              {selectedProjectorDisplay ? (
                <div className="sp-card__edit-select-trigger__card">
                  <div className="sp-card__edit-select-trigger__card-top">
                    <span className="sp-card__edit-select-trigger__card-name">
                      Projector
                    </span>
                    <ChevronDown
                      size={18}
                      className="sp-card__edit-select-trigger__chevron"
                    />
                  </div>
                  <div className="sp-card__edit-select-trigger__card-bottom">
                    <span className="sp-card__edit-select-trigger__card-quant">
                      {selectedProjectorDisplay.quantization.toUpperCase()}
                    </span>
                    <span className="sp-card__edit-select-trigger__card-size">
                      {formatBytes(selectedProjectorDisplay.sizeBytes)}
                    </span>
                    <span className="sp-card__edit-select-trigger__card-filename">
                      {selectedProjectorDisplay.filename}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="sp-card__edit-select-trigger__placeholder">
                  <span>None</span>
                  <ChevronDown
                    size={18}
                    className="sp-card__edit-select-trigger__chevron"
                  />
                </div>
              )}
            </button>
          </div>
        )}

        {/* Performance Options */}
        <div className="epm-section">
          <div className="epm-section__label">Performance</div>
          <div className="epm-perf-toggle-group">
            <button
              type="button"
              className={`epm-perf-toggle${editAutoOptimizer === 'longest-context' ? ' epm-perf-toggle--active' : ''}${optimizerRunning === 'longest-context' ? ' epm-perf-toggle--loading' : ''}`}
              onClick={() => {
                if (
                  optimizerRunning ||
                  (editAutoOptimizer === 'longest-context' &&
                    editLayers !== undefined)
                )
                  return;
                onRunOptimizer('longest-context');
              }}
              disabled={!!optimizerRunning}
            >
              {optimizerRunning === 'longest-context' ? (
                <Loader2 size={16} className="epm-perf-spinner" />
              ) : (
                <ChevronUp size={16} />
              )}
              <span>Longest Context</span>
            </button>
            <button
              type="button"
              className={`epm-perf-toggle${editAutoOptimizer === 'most-gpu' ? ' epm-perf-toggle--active' : ''}${optimizerRunning === 'most-gpu' ? ' epm-perf-toggle--loading' : ''}`}
              onClick={() => {
                if (
                  optimizerRunning ||
                  (editAutoOptimizer === 'most-gpu' && editLayers !== undefined)
                )
                  return;
                onRunOptimizer('most-gpu');
              }}
              disabled={!!optimizerRunning}
            >
              {optimizerRunning === 'most-gpu' ? (
                <Loader2 size={16} className="epm-perf-spinner" />
              ) : (
                <ChevronDown size={16} />
              )}
              <span>Most GPU</span>
            </button>
          </div>
          {editAutoOptimizer &&
            editLayers !== undefined &&
            editContextSize !== undefined && (
              <div className="epm-perf-result">
                {editLayers} GPU layers &middot; {editContextSize} context
              </div>
            )}
        </div>
      </div>

      <div className="epm-main-right">
        <div
          className="epm-sub-header"
          style={{
            marginBottom: '8px',
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Settings
        </div>
        <SectionCard
          icon={<MessageSquare size={20} />}
          title="System Prompt"
          preview={systemPromptPreview}
          onClick={() => onNavigate('system-prompt')}
        />
        <SectionCard
          icon={<Wrench size={20} />}
          title="Tools"
          preview={toolsPreview}
          onClick={() => onNavigate('tools')}
        />
        <SectionCard
          icon={<Settings size={20} />}
          title="Advanced Parameters"
          preview={advancedPreview}
          onClick={() => onNavigate('advanced')}
        />
      </div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  preview,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  preview: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="epm-section-card" onClick={onClick}>
      <div className="epm-section-card__icon">{icon}</div>
      <div className="epm-section-card__body">
        <div className="epm-section-card__title">{title}</div>
        <div className="epm-section-card__preview">{preview}</div>
      </div>
      <ChevronRight size={16} className="epm-section-card__chevron" />
    </button>
  );
}

function SystemPromptPage({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 16px',
          lineHeight: 1.5,
        }}
      >
        Defines AI behavior and personality. Sent with every message.
      </p>
      <textarea
        className="epm-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter your system prompt here..."
        rows={16}
      />
    </>
  );
}

function ToolsPage({
  categorizedTools,
  editTools,
  onToolToggle,
}: {
  categorizedTools: Array<{ category: string; toolKeys: string[] }>;
  editTools: string[];
  onToolToggle: (key: string) => void;
}) {
  return (
    <>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 16px',
          lineHeight: 1.5,
        }}
      >
        Choose which built-in tools the AI can use.
      </p>
      <div className="epm-tools-list">
        {categorizedTools.map(({ category, toolKeys }) => (
          <ToolCategoryCard
            key={category}
            category={category}
            toolKeys={toolKeys}
            editTools={editTools}
            onToolToggle={onToolToggle}
            onCategoryToggle={() => {
              const allSelected = toolKeys.every((tk) =>
                editTools.includes(tk),
              );
              if (allSelected) {
                toolKeys.forEach((tk) => onToolToggle(tk));
              } else {
                toolKeys
                  .filter((tk) => !editTools.includes(tk))
                  .forEach((tk) => onToolToggle(tk));
              }
            }}
          />
        ))}
      </div>
    </>
  );
}

function AdvancedPage({
  editTemperature,
  setEditTemperature,
  editTopK,
  setEditTopK,
  editTopP,
  setEditTopP,
  editMinP,
  setEditMinP,
  editSeed,
  setEditSeed,
  onNavigate,
}: {
  editTemperature: string;
  setEditTemperature: (v: string) => void;
  editTopK: string;
  setEditTopK: (v: string) => void;
  editTopP: string;
  setEditTopP: (v: string) => void;
  editMinP: string;
  setEditMinP: (v: string) => void;
  editSeed: string;
  setEditSeed: (v: string) => void;
  onNavigate: (page: string) => void;
}) {
  return (
    <>
      <div className="epm-number-grid">
        <NumberField
          label="Temperature"
          value={editTemperature}
          onChange={setEditTemperature}
          min="0"
          max="2"
          step="0.1"
          helper="Default: 0.8"
        />
        <NumberField
          label="Top K"
          value={editTopK}
          onChange={setEditTopK}
          min="0"
          step="1"
          helper="Default: 40"
        />
        <NumberField
          label="Top P"
          value={editTopP}
          onChange={setEditTopP}
          min="0"
          max="1"
          step="0.05"
          helper="Default: 0.95"
        />
        <NumberField
          label="Min P"
          value={editMinP}
          onChange={setEditMinP}
          min="0"
          max="1"
          step="0.01"
          helper="Default: 0.05"
        />
        <NumberField
          label="Seed"
          value={editSeed}
          onChange={setEditSeed}
          min="0"
          step="1"
          helper="Default: -1 (random)"
        />
      </div>

      <div style={{ marginTop: '20px' }}>
        <SectionCard
          icon={<Settings size={18} />}
          title="Repeat Penalty"
          preview="Discourages the model from repeating recent tokens"
          onClick={() => onNavigate('repeat-penalty')}
        />
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  helper,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  step?: string;
  helper?: string;
}) {
  const defaultVal = helper?.match(/Default:\s*([\d.]+)/)?.[1];
  return (
    <div className="epm-number-field">
      <label>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        placeholder={defaultVal}
      />
      {helper && <div className="epm-number-helper">{helper}</div>}
    </div>
  );
}

function RepeatPenaltyPage({
  editRpEnabled,
  setEditRpEnabled,
  editRpLastTokens,
  setEditRpLastTokens,
  editRpPenalty,
  setEditRpPenalty,
  editRpFrequencyPenalty,
  setEditRpFrequencyPenalty,
  editRpPresencePenalty,
  setEditRpPresencePenalty,
}: {
  editRpEnabled: boolean;
  setEditRpEnabled: (v: boolean) => void;
  editRpLastTokens: string;
  setEditRpLastTokens: (v: string) => void;
  editRpPenalty: string;
  setEditRpPenalty: (v: string) => void;
  editRpFrequencyPenalty: string;
  setEditRpFrequencyPenalty: (v: string) => void;
  editRpPresencePenalty: string;
  setEditRpPresencePenalty: (v: string) => void;
}) {
  return (
    <>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 16px',
          lineHeight: 1.5,
        }}
      >
        Discourages the model from repeating recent tokens.
      </p>

      <label className="epm-rp-enabled-row">
        <input
          type="checkbox"
          checked={editRpEnabled}
          onChange={(e) => setEditRpEnabled(e.target.checked)}
        />
        <span>Enabled</span>
      </label>

      <div
        className={
          !editRpEnabled ? 'epm-repeat-penalty-fields--disabled' : undefined
        }
      >
        <div className="epm-number-grid">
          <NumberField
            label="Last Tokens"
            value={editRpLastTokens}
            onChange={setEditRpLastTokens}
            min="1"
            step="1"
            helper="Default: 64"
          />
          <NumberField
            label="Repeat Penalty"
            value={editRpPenalty}
            onChange={setEditRpPenalty}
            min="0"
            step="0.01"
            helper="Default: 1.00"
          />
          <NumberField
            label="Frequency Penalty"
            value={editRpFrequencyPenalty}
            onChange={setEditRpFrequencyPenalty}
            min="0"
            max="1"
            step="0.01"
            helper="Default: 0.00"
          />
          <NumberField
            label="Presence Penalty"
            value={editRpPresencePenalty}
            onChange={setEditRpPresencePenalty}
            min="0"
            max="1"
            step="0.01"
            helper="Default: 0.00"
          />
        </div>
      </div>
    </>
  );
}

function extractQuantizationFromFilename(filename: string): string {
  const cleanFilename = filename.replace(/^mmproj-/i, '');
  const match = cleanFilename.match(
    /-?(Q\d+_K|F\d+|f\d+|Q\d+|q\d+|I\d+|A\d+B|BF\d+)(?:\.gguf)?$/i,
  );
  return match ? match[1].toUpperCase() : 'Unknown';
}

// ── Main modal component ──

export default function EditProfileModal({
  profile,
  profiles,
  localModels,
  modelSelectGroups,
  availableModelsForEdit,
  groupedLocalModels,
  categorizedTools,
  onSave,
  onClose,
}: EditProfileModalProps) {
  const [currentPage, setCurrentPage] = useState('main');
  const [navDirection, setNavDirection] = useState<'forward' | 'backward'>(
    'forward',
  );
  const [animating, setAnimating] = useState(false);

  // Edit state
  const isNewProfile = profile === null;
  const [editName, setEditName] = useState(profile?.name ?? 'New Profile');
  const [editSystemPrompt, setEditSystemPrompt] = useState(
    profile?.systemPrompt ?? 'You are a helpful assistant.',
  );
  const [editTemperature, setEditTemperature] = useState(
    String(profile?.temperature ?? 0.8),
  );
  const [editTopK, setEditTopK] = useState(String(profile?.topK ?? 40));
  const [editTopP, setEditTopP] = useState(String(profile?.topP ?? 0.95));
  const [editMinP, setEditMinP] = useState(String(profile?.minP ?? 0.05));
  const [editSeed, setEditSeed] = useState(String(profile?.seed ?? -1));
  const [editModel, setEditModel] = useState(
    profile?.model ? profile.model.split(/[/\\]/).pop()! : '',
  );
  const [editProjector, setEditProjector] = useState(
    profile?.projector ? profile.projector.split(/[/\\]/).pop()! : '',
  );
  const [editTools, setEditTools] = useState<string[]>(profile?.tools ?? []);
  const [editRpEnabled, setEditRpEnabled] = useState(
    profile?.repeatPenalty?.enabled !== false,
  );
  const [editRpLastTokens, setEditRpLastTokens] = useState(
    profile?.repeatPenalty?.lastTokens !== undefined
      ? String(profile.repeatPenalty.lastTokens)
      : '',
  );
  const [editRpPenalty, setEditRpPenalty] = useState(
    profile?.repeatPenalty?.penalty !== undefined
      ? String(profile.repeatPenalty.penalty)
      : '',
  );
  const [editRpFrequencyPenalty, setEditRpFrequencyPenalty] = useState(
    profile?.repeatPenalty?.frequencyPenalty !== undefined
      ? String(profile.repeatPenalty.frequencyPenalty)
      : '0.00',
  );
  const [editRpPresencePenalty, setEditRpPresencePenalty] = useState(
    profile?.repeatPenalty?.presencePenalty !== undefined
      ? String(profile.repeatPenalty.presencePenalty)
      : '0.00',
  );

  // Performance options
  const [editAutoOptimizer, setEditAutoOptimizer] = useState<
    'longest-context' | 'most-gpu' | null
  >(profile?.autoOptimizer ?? null);
  const [editLayers, setEditLayers] = useState<number | undefined>(
    profile?.layers,
  );
  const [editContextSize, setEditContextSize] = useState<number | undefined>(
    profile?.contextSize,
  );
  const [editAllocatedVRAM, setEditAllocatedVRAM] = useState<
    number | undefined
  >(profile?.allocatedVRAM);
  const [editAllocatedRAM, setEditAllocatedRAM] = useState<number | undefined>(
    profile?.allocatedRAM,
  );
  const [optimizerRunning, setOptimizerRunning] = useState<
    'longest-context' | 'most-gpu' | null
  >(null);

  // Model/Projector modals
  const [showModelModal, setShowModelModal] = useState(false);
  const [showProjectorModal, setShowProjectorModal] = useState(false);

  const navigateTo = (page: string) => {
    if (animating || page === currentPage) return;
    const fromDepth = PAGE_DEPTH[currentPage] ?? 0;
    const toDepth = PAGE_DEPTH[page] ?? 0;
    setNavDirection(toDepth > fromDepth ? 'forward' : 'backward');
    setAnimating(true);
    setTimeout(() => {
      setCurrentPage(page);
      setAnimating(false);
    }, 100);
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleSave();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      handleSave();
    }
  };

  const handleToolToggle = (toolKey: string) => {
    setEditTools((prev) =>
      prev.includes(toolKey)
        ? prev.filter((t) => t !== toolKey)
        : [...prev, toolKey],
    );
  };

  const handleSave = () => {
    if (!editName.trim() || !editModel) return;

    const selectedLocalModel = localModels.find(
      (m) => m.filename === editModel,
    );

    let modelRelativePath = editModel;
    if (selectedLocalModel?.filepath) {
      const pathParts = selectedLocalModel.filepath.split(/[/\\]/);
      const filename = pathParts.pop() || editModel;
      const subfolder = pathParts.pop() || '';
      const author = pathParts.pop() || '';
      if (author && subfolder) {
        modelRelativePath = `${author}/${subfolder}/${filename}`;
      } else if (subfolder) {
        modelRelativePath = `${subfolder}/${filename}`;
      } else {
        modelRelativePath = filename;
      }
    }

    let projectorRelativePath: string | undefined;
    if (editProjector) {
      const selectedProjector = localModels.find(
        (m) => m.filename === editProjector,
      );
      if (selectedProjector?.filepath) {
        const projParts = selectedProjector.filepath.split(/[/\\]/);
        const projFilename = projParts.pop() || editProjector;
        const projSubfolder = projParts.pop() || '';
        const projAuthor = projParts.pop() || '';

        if (projSubfolder.toLowerCase() === 'projectors') {
          const modelFolder = projAuthor;
          const author = projParts.pop() || '';
          projectorRelativePath = `${author}/${modelFolder}/projectors/${projFilename}`;
        } else if (projAuthor && projSubfolder) {
          projectorRelativePath = `${projAuthor}/${projSubfolder}/${projFilename}`;
        } else if (projSubfolder) {
          projectorRelativePath = `${projSubfolder}/${projFilename}`;
        } else {
          projectorRelativePath = projFilename;
        }
      } else {
        projectorRelativePath = editProjector;
      }
    }

    const buildRepeatPenalty = (): Profile['repeatPenalty'] => {
      if (!editRpEnabled) return { enabled: false };
      const rp: NonNullable<Profile['repeatPenalty']> = {};
      if (editRpLastTokens !== '')
        rp.lastTokens = parseInt(editRpLastTokens, 10);
      if (editRpPenalty !== '') rp.penalty = parseFloat(editRpPenalty);
      if (editRpFrequencyPenalty !== '')
        rp.frequencyPenalty = parseFloat(editRpFrequencyPenalty);
      if (editRpPresencePenalty !== '')
        rp.presencePenalty = parseFloat(editRpPresencePenalty);
      return Object.keys(rp).length > 0 ? rp : undefined;
    };

    const now = Date.now();
    const updatedProfile: Profile = {
      id: profile?.id ?? now.toString(),
      name: editName.trim(),
      model: modelRelativePath,
      projector: projectorRelativePath || undefined,
      systemPrompt: editSystemPrompt,
      temperature: parseFloat(editTemperature),
      topK: parseInt(editTopK, 10),
      topP: parseFloat(editTopP),
      minP: parseFloat(editMinP),
      seed: parseInt(editSeed, 10),
      tools: editTools.filter((t) =>
        (AVAILABLE_TOOLS as readonly string[]).includes(t),
      ),
      repeatPenalty: buildRepeatPenalty(),
      ...(editAutoOptimizer &&
      editLayers !== undefined &&
      editContextSize !== undefined
        ? {
            autoOptimizer: editAutoOptimizer,
            layers: editLayers,
            contextSize: editContextSize,
            allocatedVRAM: editAllocatedVRAM,
            allocatedRAM: editAllocatedRAM,
          }
        : {}),
      order: profile?.order ?? now,
      createdAt: profile?.createdAt ?? now,
    };

    if (profile) {
      const updated = profiles.map((p) =>
        p.id === profile.id ? updatedProfile : p,
      );
      onSave(updated);
    } else {
      const updated = [updatedProfile, ...profiles];
      onSave(updated);
    }
  };

  // Computed display values
  const availableProjectorsForEdit = (() => {
    if (!editModel) return [];
    const baseName = editModel.split(/[/\\]/).pop()!;
    let selectedGroup: (typeof groupedLocalModels)[number] | undefined;
    for (const group of groupedLocalModels) {
      if (selectedGroup) break;
      for (const fg of group.fileGroups) {
        if (selectedGroup) break;
        if (
          fg.parts.some(
            (p) => p.filename === baseName || p.filename === editModel,
          )
        ) {
          selectedGroup = group;
        }
      }
    }
    if (!selectedGroup) return [];

    const result: Array<{
      filename: string;
      quantization: string;
      name: string;
      sizeBytes: number;
    }> = [];
    for (const fg of selectedGroup.fileGroups) {
      if (fg.isProjector) {
        for (const part of fg.parts) {
          const quant = extractQuantizationFromFilename(part.filename);
          result.push({
            filename: part.filename,
            quantization: quant,
            name: `MMPROJ (${quant.toUpperCase()})`,
            sizeBytes: part.sizeBytes,
          });
        }
      }
    }
    return result;
  })();

  const selectedModelDisplay = (() => {
    if (!editModel) return null;
    const baseName = editModel.split(/[/\\]/).pop()!;
    for (const group of modelSelectGroups) {
      const v = group.variants.find(
        (v) => v.filename === baseName || v.filename === editModel,
      );
      if (v) return { groupName: group.name, ...v };
    }
    return null;
  })();

  const selectedProjectorDisplay = (() => {
    if (!editProjector) return null;
    const baseName = editProjector.split(/[/\\]/).pop()!;
    return (
      availableProjectorsForEdit.find(
        (p) => p.filename === baseName || p.filename === editProjector,
      ) ?? null
    );
  })();

  const breadcrumb = buildBreadcrumb(currentPage);

  const systemPromptPreview =
    editSystemPrompt.length > 80
      ? `${editSystemPrompt.slice(0, 80)}…`
      : editSystemPrompt || 'Not set';

  const toolCategories = categorizedTools.filter(({ toolKeys }) =>
    toolKeys.some((tk) => editTools.includes(tk)),
  );
  const toolsPreview =
    toolCategories.length > 0
      ? `${toolCategories.length} of ${categorizedTools.length} categories enabled`
      : 'None enabled';

  const advancedPreview = `Temperature: ${editTemperature}, Top K: ${editTopK}, Top P: ${editTopP}`;

  const renderPage = () => {
    switch (currentPage) {
      case 'main':
        return (
          <MainPage
            editName={editName}
            setEditName={setEditName}
            editModel={editModel}
            editProjector={editProjector}
            selectedModelDisplay={selectedModelDisplay}
            selectedProjectorDisplay={selectedProjectorDisplay}
            availableModelsForEdit={availableModelsForEdit}
            onOpenModelModal={() => setShowModelModal(true)}
            onOpenProjectorModal={() => setShowProjectorModal(true)}
            onNavigate={navigateTo}
            systemPromptPreview={systemPromptPreview}
            toolsPreview={toolsPreview}
            advancedPreview={advancedPreview}
            editAutoOptimizer={editAutoOptimizer}
            editLayers={editLayers}
            editContextSize={editContextSize}
            optimizerRunning={optimizerRunning}
            onRunOptimizer={(mode) => {
              setOptimizerRunning(mode);
              const model = localModels.find((m) => m.filename === editModel);
              if (!model) {
                setOptimizerRunning(null);
                return;
              }
              const projector = editProjector
                ? localModels.find((m) => m.filename === editProjector)
                : undefined;
              window.electronAPI
                .runProfileOptimizer({
                  modelPath: model.filepath,
                  projectorPath: projector?.filepath,
                  mode,
                })
                .then((res) => {
                  setEditAutoOptimizer(mode);
                  setEditLayers(res.ngl);
                  setEditContextSize(res.ctx);
                  setEditAllocatedVRAM(res.vramMB);
                  setEditAllocatedRAM(res.ramMB);
                  setOptimizerRunning(null);
                })
                .catch(() => {
                  setOptimizerRunning(null);
                });
            }}
          />
        );
      case 'system-prompt':
        return (
          <SystemPromptPage
            value={editSystemPrompt}
            onChange={setEditSystemPrompt}
          />
        );
      case 'tools':
        return (
          <ToolsPage
            categorizedTools={categorizedTools}
            editTools={editTools}
            onToolToggle={handleToolToggle}
          />
        );
      case 'advanced':
        return (
          <AdvancedPage
            editTemperature={editTemperature}
            setEditTemperature={setEditTemperature}
            editTopK={editTopK}
            setEditTopK={setEditTopK}
            editTopP={editTopP}
            setEditTopP={setEditTopP}
            editMinP={editMinP}
            setEditMinP={setEditMinP}
            editSeed={editSeed}
            setEditSeed={setEditSeed}
            onNavigate={navigateTo}
          />
        );
      case 'repeat-penalty':
        return (
          <RepeatPenaltyPage
            editRpEnabled={editRpEnabled}
            setEditRpEnabled={setEditRpEnabled}
            editRpLastTokens={editRpLastTokens}
            setEditRpLastTokens={setEditRpLastTokens}
            editRpPenalty={editRpPenalty}
            setEditRpPenalty={setEditRpPenalty}
            editRpFrequencyPenalty={editRpFrequencyPenalty}
            setEditRpFrequencyPenalty={setEditRpFrequencyPenalty}
            editRpPresencePenalty={editRpPresencePenalty}
            setEditRpPresencePenalty={setEditRpPresencePenalty}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="epm-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
    >
      <div className="epm-dialog">
        {/* Header */}
        <div className="epm-header">
          <div className="epm-header-left">
            {currentPage !== 'main' && (
              <button
                type="button"
                className="epm-back-btn"
                onClick={() => {
                  const info = BREADCRUMB_MAP[currentPage];
                  if (info?.parent) navigateTo(info.parent);
                }}
                aria-label="Go back"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
            <h2>{isNewProfile ? 'New Profile' : 'Edit Profile'}</h2>
          </div>
          <div className="epm-header-actions">
            <button
              type="button"
              className="epm-close"
              onClick={handleSave}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="epm-breadcrumb">
          {breadcrumb.map((crumb, idx) => (
            <span
              key={crumb.key}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {idx > 0 && <span className="epm-breadcrumb__sep">›</span>}
              <button
                type="button"
                className={`epm-breadcrumb__item${
                  idx === breadcrumb.length - 1
                    ? ' epm-breadcrumb__item--current'
                    : ' epm-breadcrumb__item--clickable'
                }`}
                onClick={() => {
                  if (idx < breadcrumb.length - 1) {
                    navigateTo(crumb.key);
                  }
                }}
                disabled={idx === breadcrumb.length - 1}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        {/* Page content */}
        <div className="epm-page-container">
          <div
            className={`epm-page-slider${animating ? (navDirection === 'forward' ? ' epm-page-slider--forward' : ' epm-page-slider--backward') : ''}`}
          >
            <div className="epm-page">{renderPage()}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="epm-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-accent"
            onClick={handleSave}
            disabled={!editName.trim() || !editModel}
          >
            Save
          </button>
        </div>
      </div>
      {/* Model/Projector selection modals */}
      {showModelModal && (
        <ModelSelectModal
          groups={modelSelectGroups}
          selectedFilename={editModel}
          onSelect={(f) => {
            setEditModel(f);
            setShowModelModal(false);
          }}
          onClose={() => setShowModelModal(false)}
        />
      )}
      {showProjectorModal && (
        <ProjectorSelectModal
          projectors={availableProjectorsForEdit}
          selectedFilename={editProjector}
          onSelect={(f) => {
            setEditProjector(f);
            setShowProjectorModal(false);
          }}
          onClose={() => setShowProjectorModal(false)}
        />
      )}
    </div>
  );
}

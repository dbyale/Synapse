import { useState, useEffect, useRef, useCallback, MouseEvent, KeyboardEvent } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  Wrench,
  Settings,
  PackageCheck,
  PackageMinus,
  Loader2,
  Zap,
  FileText,
  Flame,
  SlidersHorizontal,
  AlertTriangle,
} from 'lucide-react';
import { Profile, CacheType } from '../types/profile';
import type { LocalModel } from '../preload.d';
import { AVAILABLE_TOOLS, TOOL_METADATA } from '../../data/defaultTools';
import { formatBytes } from '../utils/formatters';
import InfoTooltip from './InfoTooltip';
import {
  PROFILE_NAME_TOOLTIP,
  MODEL_TOOLTIP,
  PROJECTOR_TOOLTIP,
  TEMPERATURE_TOOLTIP,
  TOP_K_TOOLTIP,
  TOP_P_TOOLTIP,
  MIN_P_TOOLTIP,
  SEED_TOOLTIP,
  REPEAT_PENALTY_TOOLTIP,
  LAST_TOKENS_TOOLTIP,
  REPEAT_PENALTY_VALUE_TOOLTIP,
  FREQUENCY_PENALTY_TOOLTIP,
  PRESENCE_PENALTY_TOOLTIP,
  OPTIMIZATION_MODE_TOOLTIP,
  LONGEST_CONTEXT_TOOLTIP,
  MOST_GPU_TOOLTIP,
  CUSTOM_TOOLTIP,
  GPU_LAYERS_TOOLTIP,
  CONTEXT_SIZE_TOOLTIP,
  KV_CACHE_OFFLOAD_TOOLTIP,
  K_CACHE_TYPE_TOOLTIP,
  V_CACHE_TYPE_TOOLTIP,
  MMAP_TOOLTIP,
  MLOCK_TOOLTIP,
  MODEL_WEIGHTS_TOOLTIP,
  KV_CACHE_MEM_TOOLTIP,
  COMPUTE_OVERHEAD_TOOLTIP,
  FILE_BUFFER_TOOLTIP,
  VRAM_LABEL_TOOLTIP,
  RAM_LABEL_TOOLTIP,
} from '../utils/tooltipContent';
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
  performance: 1,
};

const BREADCRUMB_MAP: Record<string, { label: string; parent: string | null }> =
  {
    main: { label: 'Profile', parent: null },
    'system-prompt': { label: 'System Prompt', parent: 'main' },
    tools: { label: 'Tools', parent: 'main' },
    advanced: { label: 'Advanced Parameters', parent: 'main' },
    'repeat-penalty': { label: 'Repeat Penalty', parent: 'advanced' },
    performance: { label: 'Performance', parent: 'main' },
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

const autoOptimizerLabel = (v: 'longest-context' | 'most-gpu' | 'custom') =>
  v === 'longest-context' ? 'Longest Context' : v === 'most-gpu' ? 'Most GPU' : 'Custom';

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
  modelMaxLayers,
  modelMaxContext,
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
  editAutoOptimizer: 'longest-context' | 'most-gpu' | 'custom' | null;
  editLayers: number | undefined;
  editContextSize: number | undefined;
  modelMaxLayers: number;
  modelMaxContext: number;
}) {
  return (
    <div className="epm-main-grid">
      <div className="epm-main-left">
        <div className="epm-section">
          <InfoTooltip content={PROFILE_NAME_TOOLTIP} side="right" hideIcon title="Profile Name">
            <div className="epm-section__label">Profile Name</div>
          </InfoTooltip>
          <input
            type="text"
            className="epm-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Profile name..."
          />
        </div>

        <div className="epm-section">
          <InfoTooltip content={MODEL_TOOLTIP} side="right" hideIcon title="Model">
            <div className="epm-section__label">Model</div>
          </InfoTooltip>
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
            <InfoTooltip content={PROJECTOR_TOOLTIP} side="right" hideIcon title="Projector (Optional)">
              <div className="epm-section__label">Projector (Optional)</div>
            </InfoTooltip>
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

        {editModel && (
          <SectionCard
            icon={<Zap size={20} />}
            title="Performance"
            tooltip="Configure GPU offloading, context size, cache, and memory options."
            preview={
              editAutoOptimizer && editLayers !== undefined && editContextSize !== undefined
                ? `${autoOptimizerLabel(editAutoOptimizer)}: ${Math.round((editLayers / modelMaxLayers) * 100)}% Offload, ${Math.round((editContextSize / modelMaxContext) * 100)}% Context`
                : editAutoOptimizer
                  ? 'Optimizing\u2026'
                  : 'Not configured'
            }
            onClick={() => onNavigate('performance')}
          />
        )}
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
          tooltip="Define the AI's base instructions and personality. Sent with every message."
          preview={systemPromptPreview}
          onClick={() => onNavigate('system-prompt')}
        />
        <SectionCard
          icon={<Wrench size={20} />}
          title="Tools"
          tooltip="Enable built-in capabilities like file I/O and web search that the AI can use."
          preview={toolsPreview}
          onClick={() => onNavigate('tools')}
        />
        <SectionCard
          icon={<Settings size={20} />}
          title="Advanced Parameters"
          tooltip="Fine-tune generation behavior: temperature, sampling, penalties, and seed."
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
  tooltip,
}: {
  icon: React.ReactNode;
  title: string;
  preview: string;
  onClick: () => void;
  tooltip?: string | string[];
}) {
  return (
    <button type="button" className="epm-section-card" onClick={onClick}>
      <div className="epm-section-card__icon">{icon}</div>
      <div className="epm-section-card__body">
        {tooltip ? (
          <InfoTooltip content={tooltip} title={title} side="right" hideIcon>
            <div className="epm-section-card__title">{title}</div>
          </InfoTooltip>
        ) : (
          <div className="epm-section-card__title">{title}</div>
        )}
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
          tooltip={TEMPERATURE_TOOLTIP}
        />
        <NumberField
          label="Top K"
          value={editTopK}
          onChange={setEditTopK}
          min="0"
          step="1"
          helper="Default: 40"
          tooltip={TOP_K_TOOLTIP}
        />
        <NumberField
          label="Top P"
          value={editTopP}
          onChange={setEditTopP}
          min="0"
          max="1"
          step="0.05"
          helper="Default: 0.95"
          tooltip={TOP_P_TOOLTIP}
        />
        <NumberField
          label="Min P"
          value={editMinP}
          onChange={setEditMinP}
          min="0"
          max="1"
          step="0.01"
          helper="Default: 0.05"
          tooltip={MIN_P_TOOLTIP}
        />
        <NumberField
          label="Seed"
          value={editSeed}
          onChange={setEditSeed}
          min="0"
          step="1"
          helper="Default: -1 (random)"
          tooltip={SEED_TOOLTIP}
        />
      </div>

      <div style={{ marginTop: '20px' }}>
        <InfoTooltip content={REPEAT_PENALTY_TOOLTIP} side="right" hideIcon title="Repeat Penalty">
          <SectionCard
            icon={<Settings size={18} />}
            title="Repeat Penalty"
            preview="Discourages the model from repeating recent tokens"
            onClick={() => onNavigate('repeat-penalty')}
          />
        </InfoTooltip>
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
  tooltip,
  tooltipTitle,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  step?: string;
  helper?: string;
  tooltip?: string | string[];
  tooltipTitle?: string;
}) {
  const defaultVal = helper?.match(/Default:\s*([\d.]+)/)?.[1];
  return (
    <div className="epm-number-field">
      {tooltip ? (
        <InfoTooltip content={tooltip} title={tooltipTitle || label} side="right" stretch className="info-tooltip-stretch--col">
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
        </InfoTooltip>
      ) : (
        <>
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
        </>
      )}
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
        <InfoTooltip content={REPEAT_PENALTY_TOOLTIP} side="right" hideIcon title="Enabled">
          <span>Enabled</span>
        </InfoTooltip>
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
            tooltip={LAST_TOKENS_TOOLTIP}
          />
          <NumberField
            label="Repeat Penalty"
            value={editRpPenalty}
            onChange={setEditRpPenalty}
            min="0"
            step="0.01"
            helper="Default: 1.00"
            tooltip={REPEAT_PENALTY_VALUE_TOOLTIP}
          />
          <NumberField
            label="Frequency Penalty"
            value={editRpFrequencyPenalty}
            onChange={setEditRpFrequencyPenalty}
            min="0"
            max="1"
            step="0.01"
            helper="Default: 0.00"
            tooltip={FREQUENCY_PENALTY_TOOLTIP}
          />
          <NumberField
            label="Presence Penalty"
            value={editRpPresencePenalty}
            onChange={setEditRpPresencePenalty}
            min="0"
            max="1"
            step="0.01"
            helper="Default: 0.00"
            tooltip={PRESENCE_PENALTY_TOOLTIP}
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

const CACHE_TYPE_OPTIONS: CacheType[] = ['f32', 'bf16', 'f16', 'q8_0', 'q5_1', 'q5_0', 'iq4_nl', 'q4_1', 'q4_0'];

function CacheTypeSelector({ label, value, onChange }: { label: string; value: CacheType; onChange: (v: CacheType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: Event) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="epm-cache-selector" ref={ref}>
      <span className="epm-cache-selector-label">{label}</span>
      <div className="epm-cache-selector-wrap">
        <button
          className="epm-cache-selector-trigger"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {value}
          <ChevronDown size={13} />
        </button>
        {open && (
          <div className="epm-cache-selector-dropdown">
            {CACHE_TYPE_OPTIONS.map((t) => (
              <button
                key={t}
                className={`epm-cache-selector-option${t === value ? ' epm-cache-selector-option--active' : ''}`}
                onClick={() => { onChange(t); setOpen(false); }}
                type="button"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Performance Page (sub-page) ──

function PerformancePage({
  editAutoOptimizer,
  editLayers,
  editContextSize,
  editKvOffload,
  editCacheTypeK,
  editCacheTypeV,
  editMmap,
  editMlock,
  optimizerRunning,
  modelMaxLayers,
  modelMaxContext,
  totalVRAM,
  totalRAM,
  onSetAutoOptimizer,
  onSetLayers,
  onSetContextSize,
  onSetKvOffload,
  onSetCacheTypeK,
  onSetCacheTypeV,
  onSetMmap,
  onSetMlock,
  onRunOptimizer,
  onEstimateMemory,
  initialEstimate,
}: {
  editAutoOptimizer: 'longest-context' | 'most-gpu' | 'custom' | null;
  editLayers: number | undefined;
  editContextSize: number | undefined;
  editKvOffload: boolean;
  editCacheTypeK: CacheType;
  editCacheTypeV: CacheType;
  editMmap: boolean;
  editMlock: boolean;
  optimizerRunning: 'longest-context' | 'most-gpu' | null;
  modelMaxLayers: number;
  modelMaxContext: number;
  totalVRAM: number;
  totalRAM: number;
  onSetAutoOptimizer: (
    v: 'longest-context' | 'most-gpu' | 'custom' | null,
  ) => void;
  onSetLayers: (v: number | undefined) => void;
  onSetContextSize: (v: number | undefined) => void;
  onSetKvOffload: (v: boolean) => void;
  onSetCacheTypeK: (v: CacheType) => void;
  onSetCacheTypeV: (v: CacheType) => void;
  onSetMmap: (v: boolean) => void;
  onSetMlock: (v: boolean) => void;
  onRunOptimizer: (mode: 'longest-context' | 'most-gpu') => void;
  onEstimateMemory: (
    ngl: number,
    ctx: number,
    kvOffload?: boolean,
    mmap?: boolean,
    cacheTypeK?: CacheType,
    cacheTypeV?: CacheType,
  ) => Promise<{
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  } | null>;
  initialEstimate: {
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  } | null;
}) {
  const isAuto =
    editAutoOptimizer !== null &&
    editAutoOptimizer !== undefined &&
    editAutoOptimizer !== 'custom';
  const sliderNgl = isAuto ? editLayers ?? 0 : (editLayers ?? 0);
  const sliderCtx = isAuto ? editContextSize ?? 512 : (editContextSize ?? 512);

  const [memory, setMemory] = useState<{
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  } | null>(initialEstimate);
  const activeLayers = isAuto ? (editLayers ?? 0) : sliderNgl;
  const activeCtx = isAuto ? (editContextSize ?? 512) : sliderCtx;

  const triggerEstimate = useCallback(
    async (ngl: number, ctx: number, kvOffload?: boolean, mmap?: boolean, cacheTypeK?: CacheType, cacheTypeV?: CacheType) => {
      if (ngl < 0 || ctx < 512) return;
      const result = await onEstimateMemory(ngl, ctx, kvOffload, mmap, cacheTypeK, cacheTypeV);
      setMemory(result);
    },
    [onEstimateMemory],
  );

  const prevOptimizerRunning = useRef(optimizerRunning);
  useEffect(() => {
    if (prevOptimizerRunning.current && !optimizerRunning) {
      triggerEstimate(activeLayers, activeCtx);
    }
    prevOptimizerRunning.current = optimizerRunning;
  }, [optimizerRunning, activeLayers, activeCtx, triggerEstimate]);

  const toGB = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);

  const vramOverheadPct = totalVRAM > 0 ? (memory?.computeOverheadVram ?? 0) / totalVRAM : 0;
  const vramModelPct = totalVRAM > 0 ? (memory?.modelVramUsage ?? 0) / totalVRAM : 0;
  const vramCtxPct = totalVRAM > 0 ? (memory?.contextVramUsage ?? 0) / totalVRAM : 0;
  const ramOverheadPct = totalRAM > 0 ? (memory?.computeOverheadRam ?? 0) / totalRAM : 0;
  const ramModelPct = totalRAM > 0 ? (memory?.modelRamUsage ?? 0) / totalRAM : 0;
  const ramBufferPct = totalRAM > 0 ? (memory?.fileBufferRam ?? 0) / totalRAM : 0;
  const ramCtxPct = totalRAM > 0 ? (memory?.contextRamUsage ?? 0) / totalRAM : 0;
  const vramFreePct = Math.max(0, 1 - vramOverheadPct - vramModelPct - vramCtxPct);
  const ramFreePct = Math.max(0, 1 - ramOverheadPct - ramModelPct - ramBufferPct - ramCtxPct);

  const showVram = totalVRAM > 0 && memory !== null;
  const showRam = totalRAM > 0 && memory !== null;

  return (
    <>
      <h2 className="epm-page-title">Performance</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Configure GPU layers and context size. Use the auto-optimizer or set
        custom values.
      </p>

      {/* Three toggle buttons */}
      <div className="epm-section">
        <InfoTooltip content={OPTIMIZATION_MODE_TOOLTIP} side="right" hideIcon title="Optimization Mode">
          <div className="epm-section__label">Optimization Mode</div>
        </InfoTooltip>
        <div className="epm-perf-three-toggle">
          <button
            type="button"
            className={`epm-perf-btn${editAutoOptimizer === 'longest-context' ? ' epm-perf-btn--active' : ''}${optimizerRunning === 'longest-context' ? ' epm-perf-btn--loading' : ''}`}
            onClick={() => {
              if (optimizerRunning) return;
              onRunOptimizer('longest-context');
            }}
            disabled={!!optimizerRunning}
          >
            {optimizerRunning === 'longest-context' ? (
              <Loader2 size={16} className="epm-perf-spinner" />
            ) : (
              <FileText size={16} />
            )}
            <InfoTooltip content={LONGEST_CONTEXT_TOOLTIP} hideIcon title="Longest Context">
              <span>Longest Context</span>
            </InfoTooltip>
          </button>
          <button
            type="button"
            className={`epm-perf-btn${editAutoOptimizer === 'most-gpu' ? ' epm-perf-btn--active' : ''}${optimizerRunning === 'most-gpu' ? ' epm-perf-btn--loading' : ''}`}
            onClick={() => {
              if (optimizerRunning) return;
              onRunOptimizer('most-gpu');
            }}
            disabled={!!optimizerRunning}
          >
            {optimizerRunning === 'most-gpu' ? (
              <Loader2 size={16} className="epm-perf-spinner" />
            ) : (
              <Flame size={16} />
            )}
            <InfoTooltip content={MOST_GPU_TOOLTIP} hideIcon title="Most GPU">
              <span>Most GPU</span>
            </InfoTooltip>
          </button>
          <button
            type="button"
            className={`epm-perf-btn${editAutoOptimizer === 'custom' ? ' epm-perf-btn--active' : ''}`}
            onClick={() => {
              if (optimizerRunning) return;
              onSetAutoOptimizer('custom');
              triggerEstimate(activeLayers, activeCtx);
            }}
            disabled={!!optimizerRunning}
          >
            <SlidersHorizontal size={16} />
            <InfoTooltip content={CUSTOM_TOOLTIP} hideIcon title="Custom">
              <span>Custom</span>
            </InfoTooltip>
          </button>
        </div>
      </div>

      {showVram && (
        <div className="epm-section" style={{ marginTop: '20px' }}>
          <InfoTooltip content="Breakdown of how model weights, KV cache, and compute overhead use video memory." side="right" hideIcon title="Estimated Memory Usage">
            <div className="epm-section__label">Estimated Memory Usage</div>
          </InfoTooltip>

          <div className="epm-estimate-notice">
            <AlertTriangle size={14} />
            <InfoTooltip content="The GGUF Parser Go library does not account for all Synapse-specific memory optimizations, so actual usage may differ." side="right" hideIcon title="Memory Estimates">
              <span>Memory estimates provided by <a href="https://github.com/gpustack/gguf-parser-go" target="_blank" rel="noopener noreferrer">GGUF Parser Go</a>, which does not support all of Synapse's features, leading to inaccurate estimations.</span>
            </InfoTooltip>
          </div>

          <div className="epm-mem-legend">
            <span className="epm-mem-legend-total"><strong>Total: {toGB(memory.modelVramUsage + memory.contextVramUsage + memory.computeOverheadVram)}GB</strong></span>
            {memory.modelVramUsage > 0 && (
              <span className="epm-mem-legend-item">
                <span className="epm-mem-dot epm-mem-dot--model" />
                <InfoTooltip content={MODEL_WEIGHTS_TOOLTIP} side="right" hideIcon title="Model Weights">
                  <span>Model Weights ({toGB(memory.modelVramUsage)}GB)</span>
                </InfoTooltip>
              </span>
            )}
            {memory.contextVramUsage > 0 && (
              <span className="epm-mem-legend-item">
                <span className="epm-mem-dot epm-mem-dot--ctx" />
                <InfoTooltip content={KV_CACHE_MEM_TOOLTIP} side="right" hideIcon title="KV Cache">
                  <span>KV Cache ({toGB(memory.contextVramUsage)}GB)</span>
                </InfoTooltip>
              </span>
            )}
            {memory.computeOverheadVram > 0 && (
              <span className="epm-mem-legend-item">
                <span className="epm-mem-dot epm-mem-dot--overhead" />
                <InfoTooltip content={COMPUTE_OVERHEAD_TOOLTIP} side="right" hideIcon title="Compute Overhead">
                  <span>Compute Overhead ({toGB(memory.computeOverheadVram)}GB)</span>
                </InfoTooltip>
              </span>
            )}
            <span className="epm-mem-legend-item">
              <span className="epm-mem-dot epm-mem-dot--free" /> Free ({toGB(Math.max(0, totalVRAM - memory.modelVramUsage - memory.contextVramUsage - memory.computeOverheadVram))}GB)
            </span>
          </div>

          <div className="epm-mem-bar-wrap">
            <InfoTooltip content={VRAM_LABEL_TOOLTIP} side="right" hideIcon title="VRAM">
              <div className="epm-mem-bar-label-inline">VRAM</div>
            </InfoTooltip>
            <div className="epm-mem-bar-track">
              <InfoTooltip content={`Model Weights: ${toGB(memory.modelVramUsage)}GB`} className="epm-mem-segment epm-mem-segment--model" hideIcon side="top" title="Model Weights" style={{ width: `${vramModelPct * 100}%` }} />
              <InfoTooltip content={`KV Cache: ${toGB(memory.contextVramUsage)}GB`} className="epm-mem-segment epm-mem-segment--ctx" hideIcon side="top" title="KV Cache" style={{ width: `${vramCtxPct * 100}%` }} />
              <InfoTooltip content={`Compute Overhead: ${toGB(memory.computeOverheadVram)}GB`} className="epm-mem-segment epm-mem-segment--overhead" hideIcon side="top" title="Compute Overhead" style={{ width: `${vramOverheadPct * 100}%` }} />
              <InfoTooltip content={`Free: ${toGB(Math.max(0, totalVRAM - memory.modelVramUsage - memory.contextVramUsage - memory.computeOverheadVram))}GB`} className="epm-mem-segment epm-mem-segment--free" hideIcon side="top" title="Free" style={{ width: `${vramFreePct * 100}%` }} />
            </div>
            <div className="epm-mem-bar-total">
              {toGB(totalVRAM)} GB
            </div>
          </div>

          {showRam && (
            <>
              <div className="epm-mem-legend" style={{ marginTop: '14px' }}>
                <span className="epm-mem-legend-total"><strong>Total: {toGB(memory.modelRamUsage + memory.contextRamUsage + memory.fileBufferRam + memory.computeOverheadRam)}GB</strong></span>
                {memory.modelRamUsage > 0 && (
                  <span className="epm-mem-legend-item">
                    <span className="epm-mem-dot epm-mem-dot--model" />
                    <InfoTooltip content={MODEL_WEIGHTS_TOOLTIP} side="right" hideIcon title="Model Weights">
                      <span>Model Weights ({toGB(memory.modelRamUsage)}GB)</span>
                    </InfoTooltip>
                  </span>
                )}
                {memory.contextRamUsage > 0 && (
                  <span className="epm-mem-legend-item">
                    <span className="epm-mem-dot epm-mem-dot--ctx" />
                    <InfoTooltip content={KV_CACHE_MEM_TOOLTIP} side="right" hideIcon title="KV Cache">
                      <span>KV Cache ({toGB(memory.contextRamUsage)}GB)</span>
                    </InfoTooltip>
                  </span>
                )}
                {memory.fileBufferRam > 0 && (
                  <span className="epm-mem-legend-item">
                    <span className="epm-mem-dot epm-mem-dot--buffer" />
                    <InfoTooltip content={FILE_BUFFER_TOOLTIP} side="right" hideIcon title="File Buffer">
                      <span>File Buffer ({toGB(memory.fileBufferRam)}GB)</span>
                    </InfoTooltip>
                  </span>
                )}
                {memory.computeOverheadRam > 0 && (
                  <span className="epm-mem-legend-item">
                    <span className="epm-mem-dot epm-mem-dot--overhead" />
                    <InfoTooltip content={COMPUTE_OVERHEAD_TOOLTIP} side="right" hideIcon title="Compute Overhead">
                      <span>Compute Overhead ({toGB(memory.computeOverheadRam)}GB)</span>
                    </InfoTooltip>
                  </span>
                )}
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--free" /> Free ({toGB(Math.max(0, totalRAM - memory.modelRamUsage - memory.contextRamUsage - memory.fileBufferRam - memory.computeOverheadRam))}GB)
                </span>
              </div>
              <div className="epm-mem-bar-wrap">
                <InfoTooltip content={RAM_LABEL_TOOLTIP} side="right" hideIcon title="RAM">
                  <div className="epm-mem-bar-label-inline">RAM</div>
                </InfoTooltip>
                <div className="epm-mem-bar-track">
                  <InfoTooltip content={`Model Weights: ${toGB(memory.modelRamUsage)}GB`} className="epm-mem-segment epm-mem-segment--model" hideIcon side="top" title="Model Weights" style={{ width: `${ramModelPct * 100}%` }} />
                  <InfoTooltip content={`KV Cache: ${toGB(memory.contextRamUsage)}GB`} className="epm-mem-segment epm-mem-segment--ctx" hideIcon side="top" title="KV Cache" style={{ width: `${ramCtxPct * 100}%` }} />
                  <InfoTooltip content={`File Buffer: ${toGB(memory.fileBufferRam)}GB`} className="epm-mem-segment epm-mem-segment--buffer" hideIcon side="top" title="File Buffer" style={{ width: `${ramBufferPct * 100}%` }} />
                  <InfoTooltip content={`Compute Overhead: ${toGB(memory.computeOverheadRam)}GB`} className="epm-mem-segment epm-mem-segment--overhead" hideIcon side="top" title="Compute Overhead" style={{ width: `${ramOverheadPct * 100}%` }} />
                  <InfoTooltip content={`Free: ${toGB(Math.max(0, totalRAM - memory.modelRamUsage - memory.contextRamUsage - memory.fileBufferRam - memory.computeOverheadRam))}GB`} className="epm-mem-segment epm-mem-segment--free" hideIcon side="top" title="Free" style={{ width: `${ramFreePct * 100}%` }} />
                </div>
                <div className="epm-mem-bar-total">
                  {toGB(totalRAM)} GB
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sliders */}
      <div className="epm-section" style={{ marginTop: '16px' }}>
        <InfoTooltip content="Adjust GPU offloading and context size to balance speed against memory usage." side="right" hideIcon title="Settings">
          <div className="epm-section__label">Settings</div>
        </InfoTooltip>
        <div className="epm-perf-sliders">
          <div className="epm-perf-slider-group">
            <InfoTooltip content={GPU_LAYERS_TOOLTIP} side="bottom" stretch className="info-tooltip-stretch--col" title="GPU Layers (NGL)">
              <label className="epm-perf-slider-label">
                GPU Layers (NGL): <strong>{sliderNgl}</strong>
              </label>
              <input
                type="range"
                min={0}
                max={modelMaxLayers}
                step={1}
                value={sliderNgl}
                disabled={isAuto}
                className={`epm-perf-range${isAuto ? ' epm-perf-range--disabled' : ''}`}
                onChange={(e) => {
                  if (!isAuto) {
                    const v = parseInt(e.target.value, 10);
                    onSetLayers(v);
                    triggerEstimate(v, activeCtx);
                  }
                }}
              />
              <div className="epm-perf-range-labels">
                <span>0</span>
                <span>{modelMaxLayers}</span>
              </div>
            </InfoTooltip>
          </div>

          <div className="epm-perf-slider-group" style={{ marginTop: '16px' }}>
            <InfoTooltip content={CONTEXT_SIZE_TOOLTIP} side="bottom" stretch className="info-tooltip-stretch--col" title="Context Size">
              <label className="epm-perf-slider-label">
                Context Size: <strong>{sliderCtx.toLocaleString()}</strong>
              </label>
              <input
                type="range"
                min={512}
                max={modelMaxContext}
                step={512}
                value={sliderCtx}
                disabled={isAuto}
                className={`epm-perf-range${isAuto ? ' epm-perf-range--disabled' : ''}`}
                onChange={(e) => {
                  if (!isAuto) {
                    const v = parseInt(e.target.value, 10);
                    onSetContextSize(v);
                    triggerEstimate(activeLayers, v);
                  }
                }}
              />
              <div className="epm-perf-range-labels">
                <span>512</span>
                <span>{modelMaxContext.toLocaleString()}</span>
              </div>
            </InfoTooltip>
          </div>
        </div>
      </div>

      {/* Cache Options */}
      <div className="epm-section" style={{ marginTop: '16px' }}>
        <InfoTooltip content="Fine-tune KV cache behaviour and data types for memory and quality tradeoffs." side="right" hideIcon title="Cache Options">
          <div className="epm-section__label">Cache Options</div>
        </InfoTooltip>
        <div className="epm-perf-toggles">
          <label className="epm-perf-toggle-row">
            <InfoTooltip content={KV_CACHE_OFFLOAD_TOOLTIP} side="right" stretch className="info-tooltip-stretch--row" title="KV Cache Offload">
              <span className="epm-perf-toggle-label">KV Cache Offload</span>
              <div
                className={`epm-toggle-switch${editKvOffload ? ' epm-toggle-switch--on' : ''}`}
                onClick={() => { const next = !editKvOffload; onSetKvOffload(next); triggerEstimate(activeLayers, activeCtx, next, editMmap, editCacheTypeK, editCacheTypeV); }}
                role="switch"
                aria-checked={editKvOffload}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); const next = !editKvOffload; onSetKvOffload(next); triggerEstimate(activeLayers, activeCtx, next, editMmap, editCacheTypeK, editCacheTypeV); } }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </InfoTooltip>
          </label>
        </div>
        <div className="epm-cache-selectors-row">
          <InfoTooltip content={K_CACHE_TYPE_TOOLTIP} stretch title="K Cache Type">
            <CacheTypeSelector label="K Cache Type" value={editCacheTypeK} onChange={(v) => { onSetCacheTypeK(v); triggerEstimate(activeLayers, activeCtx, editKvOffload, editMmap, v, editCacheTypeV); }} />
          </InfoTooltip>
          <InfoTooltip content={V_CACHE_TYPE_TOOLTIP} stretch title="V Cache Type">
            <CacheTypeSelector label="V Cache Type" value={editCacheTypeV} onChange={(v) => { onSetCacheTypeV(v); triggerEstimate(activeLayers, activeCtx, editKvOffload, editMmap, editCacheTypeK, v); }} />
          </InfoTooltip>
        </div>
      </div>

      {/* Memory Options */}
      <div className="epm-section" style={{ marginTop: '16px' }}>
        <InfoTooltip content="Control how model weights are loaded into memory." side="right" hideIcon title="Memory Options">
          <div className="epm-section__label">Memory Options</div>
        </InfoTooltip>
        <div className="epm-perf-toggles">
          <label className="epm-perf-toggle-row">
            <InfoTooltip content={MMAP_TOOLTIP} side="right" stretch className="info-tooltip-stretch--row" title="Memory-Mapped (MMAP)">
              <span className="epm-perf-toggle-label">Memory-Mapped (MMAP)</span>
              <div
                className={`epm-toggle-switch${editMmap ? ' epm-toggle-switch--on' : ''}`}
                onClick={() => { const next = !editMmap; onSetMmap(next); triggerEstimate(activeLayers, activeCtx, editKvOffload, next, editCacheTypeK, editCacheTypeV); }}
                role="switch"
                aria-checked={editMmap}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); const next = !editMmap; onSetMmap(next); triggerEstimate(activeLayers, activeCtx, editKvOffload, next, editCacheTypeK, editCacheTypeV); } }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </InfoTooltip>
          </label>
          <label className="epm-perf-toggle-row">
            <InfoTooltip content={MLOCK_TOOLTIP} side="right" stretch className="info-tooltip-stretch--row" title="MLock (Pin RAM)">
              <span className="epm-perf-toggle-label">MLock (Pin RAM)</span>
              <div
                className={`epm-toggle-switch${editMlock ? ' epm-toggle-switch--on' : ''}`}
                onClick={() => { const next = !editMlock; onSetMlock(next); }}
                role="switch"
                aria-checked={editMlock}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); const next = !editMlock; onSetMlock(next); } }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </InfoTooltip>
          </label>
        </div>
      </div>
    </>
  );
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
    'longest-context' | 'most-gpu' | 'custom' | null
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
  const [editKvOffload, setEditKvOffload] = useState<boolean>(
    profile?.kvOffload ?? true,
  );
  const [editMmap, setEditMmap] = useState<boolean>(
    profile?.mmap ?? true,
  );
  const [editMlock, setEditMlock] = useState<boolean>(
    profile?.mlock ?? false,
  );
  const [editCacheTypeK, setEditCacheTypeK] = useState<CacheType>(
    profile?.cacheTypeK ?? 'f16',
  );
  const [editCacheTypeV, setEditCacheTypeV] = useState<CacheType>(
    profile?.cacheTypeV ?? 'f16',
  );
  const [optimizerRunning, setOptimizerRunning] = useState<
    'longest-context' | 'most-gpu' | null
  >(null);

  // Model metadata (max layers/context) — fetched when model changes
  const [modelMeta, setModelMeta] = useState<{
    maxLayers: number;
    maxContext: number;
  } | null>(null);

  // Total system VRAM/RAM for memory bars
  const [totalVRAM, setTotalVRAM] = useState(0);
  const [totalRAM, setTotalRAM] = useState(0);

  // Cached memory estimate (persisted in profile)
  const [lastEstimate, setLastEstimate] = useState<{
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  } | null>(profile?.estimation ?? null);

// Fetch model metadata when model selection changes
useEffect(() => {
  if (profile?.maxForModel === profile?.model && profile?.maxLayers && profile?.maxContext) {
    setModelMeta({ maxLayers: profile.maxLayers, maxContext: profile.maxContext });
    return;
  }
  const model = localModels.find((m) => m.filename === editModel);
  if (!model) {
    setModelMeta(null);
    return;
  }
  const projector = editProjector
    ? localModels.find((m) => m.filename === editProjector)
    : undefined;
  window.electronAPI
    .getModelMetadata({
      modelPath: model.filepath,
      projectorPath: projector?.filepath,
    })
    .then((meta) => setModelMeta(meta))
    .catch(() => setModelMeta(null));
}, [editModel, editProjector]);

  // Fetch total VRAM/RAM once on mount
  useEffect(() => {
    window.electronAPI
      .getVramStats()
      .then((stats) => {
        setTotalRAM(stats.ram.total * 1024 * 1024);
        setTotalVRAM(stats.vram ? stats.vram.total * 1024 * 1024 : 0);
      })
      .catch(() => {});
  }, []);

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

  const handleRunOptimizer = (mode: 'longest-context' | 'most-gpu') => {
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
        kvOffload: editKvOffload,
        mmap: editMmap,
        cacheTypeK: editCacheTypeK,
        cacheTypeV: editCacheTypeV,
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
  };

  const handleEstimateMemory = async (
    ngl: number,
    ctx: number,
    kvOffload?: boolean,
    mmap?: boolean,
    cacheTypeK?: CacheType,
    cacheTypeV?: CacheType,
  ): Promise<{
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  } | null> => {
    const model = localModels.find((m) => m.filename === editModel);
    if (!model) return null;
    const projector = editProjector
      ? localModels.find((m) => m.filename === editProjector)
      : undefined;
    const result = await window.electronAPI.estimateMemory({
      modelPath: model.filepath,
      projectorPath: projector?.filepath,
      ngl,
      ctx,
      kvOffload: kvOffload ?? editKvOffload,
      mmap: mmap ?? editMmap,
      cacheTypeK: cacheTypeK ?? editCacheTypeK,
      cacheTypeV: cacheTypeV ?? editCacheTypeV,
    });
    setLastEstimate(result);
    return result;
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
      kvOffload: editKvOffload,
      cacheTypeK: editCacheTypeK,
      cacheTypeV: editCacheTypeV,
      mmap: editMmap,
      mlock: editMlock,
      ...(editAutoOptimizer &&
      editLayers !== undefined &&
      editContextSize !== undefined
        ? {
            autoOptimizer: editAutoOptimizer,
            layers: editLayers,
            contextSize: editContextSize,
            allocatedVRAM: editAllocatedVRAM,
            allocatedRAM: editAllocatedRAM,
            maxLayers: modelMeta?.maxLayers,
            maxContext: modelMeta?.maxContext,
            maxForModel: modelRelativePath,
            estimation: lastEstimate ?? undefined,
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
            modelMaxLayers={modelMeta?.maxLayers ?? 200}
            modelMaxContext={modelMeta?.maxContext ?? 131072}
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
      case 'performance':
        return (
          <PerformancePage
            editAutoOptimizer={editAutoOptimizer}
            editLayers={editLayers}
            editContextSize={editContextSize}
            editKvOffload={editKvOffload}
            editCacheTypeK={editCacheTypeK}
            editCacheTypeV={editCacheTypeV}
            editMmap={editMmap}
            editMlock={editMlock}
            optimizerRunning={optimizerRunning}
            modelMaxLayers={modelMeta?.maxLayers ?? 200}
            modelMaxContext={modelMeta?.maxContext ?? 131072}
            totalVRAM={totalVRAM}
            totalRAM={totalRAM}
            onSetAutoOptimizer={setEditAutoOptimizer}
            onSetLayers={setEditLayers}
            onSetContextSize={setEditContextSize}
            onSetKvOffload={setEditKvOffload}
            onSetCacheTypeK={setEditCacheTypeK}
            onSetCacheTypeV={setEditCacheTypeV}
            onSetMmap={setEditMmap}
            onSetMlock={setEditMlock}
            onRunOptimizer={handleRunOptimizer}
            onEstimateMemory={handleEstimateMemory}
            initialEstimate={profile?.estimation ?? lastEstimate}
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

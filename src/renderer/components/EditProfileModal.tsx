import {
  useState,
  useEffect,
  useRef,
  useCallback,
  MouseEvent,
  KeyboardEvent,
  ClipboardEvent,
} from 'react';
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
  Puzzle,
} from 'lucide-react';
import { Profile, CacheType } from '../types/profile';
import type { LocalModel } from '../preload.d';
import { getToolMeta, getAvailableToolNames } from '../utils/extensionData';
import { svgToDataUrl } from '../utils/svgToDataUrl';
import { resolveIcon } from './workflows/IconPicker';
import ToolListModal from './ToolListModal';
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
  GPU_LAYERS_AUTO_TOOLTIP,
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
  DRAFT_MODEL_TOOLTIP,
  SPEC_TYPE_TOOLTIP,
  DRAFT_N_MAX_TOOLTIP,
  DRAFT_N_MIN_TOOLTIP,
  DRAFT_P_SPLIT_TOOLTIP,
  DRAFT_P_MIN_TOOLTIP,
  CPU_MOE_TOOLTIP,
  N_CPU_MOE_TOOLTIP,
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

interface ExtensionGroup {
  extension: {
    manifest: {
      id: string;
      name: string;
      description: string;
      author: string;
      version: string;
      icon: string;
      builtIn: boolean;
      iconSvgData?: string;
    };
    tools: Record<
      string,
      {
        meta: {
          name: string;
          label: string;
          description: string;
          icon: string;
        };
        params: Record<string, any>;
      }
    >;
    enabled: boolean;
  };
  toolKeys: string[];
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
  extensionGroups: ExtensionGroup[];
  onSave: (updatedProfiles: Profile[]) => void;
  onClose: () => void;
}

const PAGE_DEPTH: Record<string, number> = {
  main: 0,
  'system-prompt': 1,
  tools: 1,
  advanced: 1,
  'repeat-penalty': 2,
  projector: 1,
  'video-settings': 2,
  performance: 1,
  'cache-options': 2,
  'memory-options': 2,
  'draft-model': 2,
  'moe-options': 2,
};

const BREADCRUMB_MAP: Record<string, { label: string; parent: string | null }> =
  {
    main: { label: 'Profile', parent: null },
    'system-prompt': { label: 'System Prompt', parent: 'main' },
    tools: { label: 'Tools', parent: 'main' },
    advanced: { label: 'Advanced Parameters', parent: 'main' },
    'repeat-penalty': { label: 'Repeat Penalty', parent: 'advanced' },
    projector: { label: 'Projector', parent: 'main' },
    'video-settings': { label: 'Video Settings', parent: 'projector' },
    performance: { label: 'Performance', parent: 'main' },
    'cache-options': { label: 'Cache Options', parent: 'performance' },
    'memory-options': { label: 'Memory Options', parent: 'performance' },
    'draft-model': { label: 'Draft Model', parent: 'performance' },
    'moe-options': { label: 'Mixture of Experts', parent: 'performance' },
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
  iconName,
  iconSvgData,
  onOpenToolModal,
}: {
  category: string;
  toolKeys: string[];
  editTools: string[];
  onToolToggle: (key: string) => void;
  onCategoryToggle: () => void;
  iconName?: string;
  iconSvgData?: string;
  onOpenToolModal: () => void;
}) {
  const enabledCount = toolKeys.filter((tk) => editTools.includes(tk)).length;
  const totalCount = toolKeys.length;

  return (
    <div className="epm-tool-category">
      <button
        type="button"
        className="epm-tool-category__header"
        onClick={onOpenToolModal}
        title="View tools"
      >
        <div className="epm-tool-category__icon-wrap">
          {iconSvgData ? (
            <img
              src={svgToDataUrl(iconSvgData)}
              alt=""
              className="epm-tool-category__svg-icon"
            />
          ) : iconName ? (
            (() => {
              const IconComp = resolveIcon(iconName);
              return <IconComp className="epm-tool-category__lucide-icon" />;
            })()
          ) : (
            (() => {
              const IconComp = Puzzle;
              return <IconComp className="epm-tool-category__lucide-icon" />;
            })()
          )}
        </div>
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
    </div>
  );
}

// ── Page content components ──

const autoOptimizerLabel = (v: 'longest-context' | 'most-gpu' | 'custom') =>
  v === 'longest-context'
    ? 'Longest Context'
    : v === 'most-gpu'
      ? 'Most GPU'
      : 'Custom';

function MainPage({
  editName,
  setEditName,
  editModel,
  selectedModelDisplay,
  selectedProjectorDisplay,
  availableModelsForEdit,
  onOpenModelModal,
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
          <InfoTooltip
            content={PROFILE_NAME_TOOLTIP}
            side="right"
            hideIcon
            title="Profile Name"
          >
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
          <InfoTooltip
            content={MODEL_TOOLTIP}
            side="right"
            hideIcon
            title="Model"
          >
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
          <SectionCard
            icon={<FileText size={20} />}
            title="Projector"
            tooltip={PROJECTOR_TOOLTIP}
            preview={
              selectedProjectorDisplay
                ? selectedProjectorDisplay.filename
                : 'None'
            }
            onClick={() => onNavigate('projector')}
          />
        )}

        {editModel && (
          <SectionCard
            icon={<Zap size={20} />}
            title="Performance"
            tooltip="Configure GPU offloading, context size, cache, and memory options."
            preview={
              editAutoOptimizer &&
              editLayers !== undefined &&
              editContextSize !== undefined
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

const SYSTEM_PROMPT_VARIABLES = [
  {
    label: '{date}',
    insert: '{date}',
    description: 'Current date (YYYY-MM-DD)',
  },
  {
    label: '{time}',
    insert: '{time}',
    description: 'Current time (HH:MM AM/PM)',
  },
  {
    label: '{datetime}',
    insert: '{datetime}',
    description: 'Current date and time',
  },
  {
    label: '{dayOfWeek}',
    insert: '{dayOfWeek}',
    description: 'Current day of the week',
  },
  { label: '{timezone}', insert: '{timezone}', description: 'User timezone' },
  {
    label: '{profilename}',
    insert: '{profilename}',
    description: 'Current profile name',
  },
  {
    label: '{modelname}',
    insert: '{modelname}',
    description: 'Current model filename',
  },
  {
    label: '{contextlength}',
    insert: '{contextlength}',
    description: 'Context size in tokens',
  },
];

function textToHighlightedHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withVariables = escaped.replace(
    /\{(\w+)\}/g,
    '<span class="epm-var-highlight">{$1}</span>',
  );
  return withVariables.replace(/\n/g, '<br>');
}

function getPlainText(el: HTMLElement): string {
  let text = '';
  Array.from(el.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeName === 'BR') {
      text += '\n';
    } else if (node.nodeName === 'DIV') {
      text += `\n${getPlainText(node as HTMLElement)}`;
    } else if (node instanceof HTMLElement) {
      text += getPlainText(node);
    }
  });
  return text;
}

function highlightTextNodes(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const toProcess: Text[] = [];
  while (true) {
    const node = walker.nextNode() as Text | null;
    if (!node) break;
    if (/\{\w+\}/.test(node.textContent || '')) {
      const parent = node.parentNode;
      if (
        parent &&
        !(
          parent instanceof HTMLElement &&
          parent.classList.contains('epm-var-highlight')
        )
      ) {
        toProcess.push(node);
      }
    }
  }
  toProcess.forEach((textNode) => {
    const parts = (textNode.textContent || '').split(/(\{(\w+)\})/g);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      if (/^\{\w+\}$/.test(parts[i])) {
        const span = document.createElement('span');
        span.className = 'epm-var-highlight';
        span.textContent = parts[i];
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(parts[i]));
      }
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
  });
  mergeAdjacentText(el);
}

function mergeAdjacentText(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let prev: Text | null = null;
  const toRemove: Text[] = [];
  while (true) {
    const node = walker.nextNode() as Text | null;
    if (!node) break;
    if (prev && node.parentNode === prev.parentNode) {
      prev.textContent += node.textContent;
      toRemove.push(node);
    } else {
      prev = node;
    }
  }
  toRemove.forEach((n) => n.remove());
}

function SystemPromptPage({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const scanningRef = useRef(false);

  useEffect(() => {
    if (editorRef.current && !mountedRef.current) {
      editorRef.current.innerHTML = textToHighlightedHtml(value);
      mountedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = () => {
    if (!editorRef.current || scanningRef.current) return;
    onChange(getPlainText(editorRef.current));
    scanningRef.current = true;
    requestAnimationFrame(() => {
      if (editorRef.current) {
        highlightTextNodes(editorRef.current);
      }
      scanningRef.current = false;
    });
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const insertVariable = (variable: string) => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    if (sel && editorRef.current.contains(sel.anchorNode)) {
      document.execCommand('insertText', false, variable);
    } else {
      onChange(getPlainText(editorRef.current) + variable);
    }
    editorRef.current.focus();
    handleInput();
  };

  return (
    <>
      <p className="epm-page-desc">Define how the AI behaves.</p>
      <div className="epm-variables-section">
        <span className="epm-variables-section__label">Variables</span>
        <div className="epm-var-bar">
          {SYSTEM_PROMPT_VARIABLES.map((v) => (
            <button
              key={v.insert}
              className="epm-var-chip"
              onClick={() => insertVariable(v.insert)}
              title={v.description}
              type="button"
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={editorRef}
        className="epm-textarea epm-textarea--editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        tabIndex={0}
        onInput={handleInput}
        onPaste={handlePaste}
        data-placeholder="Enter your system prompt here..."
      />
    </>
  );
}

function ToolsPage({
  extensionGroups,
  editTools,
  onToolToggle,
}: {
  extensionGroups: Array<{
    extension: {
      manifest: {
        id: string;
        name: string;
        icon: string;
        iconSvgData?: string;
      };
      tools: Record<string, any>;
    };
    toolKeys: string[];
  }>;
  editTools: string[];
  onToolToggle: (key: string) => void;
}) {
  const [modalExt, setModalExt] = useState<{
    id: string;
    name: string;
    description: string;
    toolKeys: string[];
  } | null>(null);

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
        Choose which tools the AI can use, grouped by extension.
      </p>
      <div className="epm-tools-list">
        {extensionGroups.map(({ extension, toolKeys }) => (
          <ToolCategoryCard
            key={extension.manifest.id}
            category={extension.manifest.name}
            toolKeys={toolKeys}
            editTools={editTools}
            onToolToggle={onToolToggle}
            iconName={extension.manifest.icon}
            iconSvgData={extension.manifest.iconSvgData}
            onOpenToolModal={() =>
              setModalExt({
                id: extension.manifest.id,
                name: extension.manifest.name,
                description: extension.manifest.description,
                toolKeys,
              })
            }
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

      {modalExt && (
        <ToolListModal
          title={`${modalExt.name} Tools`}
          description={modalExt.description}
          tools={modalExt.toolKeys
            .map((tk) => {
              const meta = getToolMeta(tk);
              return meta
                ? {
                    name: tk,
                    label: meta.label,
                    description: meta.description,
                    descriptionForHuman: meta.descriptionForHuman,
                  }
                : null;
            })
            .filter((t): t is NonNullable<typeof t> => t !== null)}
          editTools={editTools}
          onToolToggle={onToolToggle}
          onClose={() => setModalExt(null)}
        />
      )}
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

      <InfoTooltip
        content={REPEAT_PENALTY_TOOLTIP}
        side="bottom"
        hideIcon
        title="Repeat Penalty"
      >
        <div style={{ marginTop: '20px' }}>
          <SectionCard
            icon={<Settings size={18} />}
            title="Repeat Penalty"
            preview="Discourages the model from repeating recent tokens"
            onClick={() => onNavigate('repeat-penalty')}
          />
        </div>
      </InfoTooltip>
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
  disabled,
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
  disabled?: boolean;
}) {
  const defaultVal = helper?.match(/Default:\s*([\d.]+)/)?.[1];
  const field = (
    <div className="epm-number-field" style={{ width: '100%' }}>
      <label>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        placeholder={defaultVal}
        disabled={disabled}
      />
      {helper && <div className="epm-number-helper">{helper}</div>}
    </div>
  );
  return tooltip ? (
    <InfoTooltip
      content={tooltip}
      title={tooltipTitle || label}
      side="bottom"
      stretch
      className="info-tooltip-stretch--col"
    >
      {field}
    </InfoTooltip>
  ) : (
    field
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
        <InfoTooltip
          content={REPEAT_PENALTY_TOOLTIP}
          side="right"
          hideIcon
          title="Enabled"
        >
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

const CACHE_TYPE_OPTIONS: CacheType[] = [
  'f32',
  'bf16',
  'f16',
  'q8_0',
  'q5_1',
  'q5_0',
  'iq4_nl',
  'q4_1',
  'q4_0',
];

function CacheTypeSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CacheType;
  onChange: (v: CacheType) => void;
}) {
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
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
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

// ── Projector Page (sub-page) ──

function ProjectorPage({
  selectedProjectorDisplay,
  onOpenProjectorModal,
  editProjector,
  onNavigate,
  videoSettingsPreview,
}: {
  selectedProjectorDisplay: {
    filename: string;
    quantization: string;
    sizeBytes: number;
  } | null;
  onOpenProjectorModal: () => void;
  editProjector: string;
  onNavigate: (page: string) => void;
  videoSettingsPreview: string;
}) {
  return (
    <>
      <div className="epm-section">
        <InfoTooltip
          content={PROJECTOR_TOOLTIP}
          side="right"
          hideIcon
          title="Projector"
        >
          <div className="epm-section__label">Projector</div>
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
      {editProjector && (
        <div style={{ marginTop: '20px' }}>
          <SectionCard
            icon={<SlidersHorizontal size={18} />}
            title="Video Settings"
            tooltip="Configure how video frames are extracted before being sent to the vision model."
            preview={videoSettingsPreview}
            onClick={() => onNavigate('video-settings')}
          />
        </div>
      )}
    </>
  );
}

// ── Video Settings Page (sub-page) ──

function VideoSettingsPage({
  editVideoFps,
  setEditVideoFps,
  editVideoMaxFrames,
  setEditVideoMaxFrames,
  editVideoQuality,
  setEditVideoQuality,
  editVideoWidth,
  setEditVideoWidth,
  editVideoUnlimitedMaxFrames,
  setEditVideoUnlimitedMaxFrames,
}: {
  editVideoFps: string;
  setEditVideoFps: (v: string) => void;
  editVideoMaxFrames: string;
  setEditVideoMaxFrames: (v: string) => void;
  editVideoQuality: string;
  setEditVideoQuality: (v: string) => void;
  editVideoWidth: string;
  setEditVideoWidth: (v: string) => void;
  editVideoUnlimitedMaxFrames: boolean;
  setEditVideoUnlimitedMaxFrames: (v: boolean) => void;
}) {
  return (
    <>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={editVideoUnlimitedMaxFrames}
          onChange={(e) => setEditVideoUnlimitedMaxFrames(e.target.checked)}
        />
        <span>Disable Frame Limit</span>
      </label>
      <div className="epm-number-grid">
        <NumberField
          label="Frames Per Second (FPS)"
          value={editVideoFps}
          onChange={setEditVideoFps}
          step="0.5"
          helper="Default: 1"
          tooltip="How many video frames to sample per second. Higher values capture more temporal detail but increase token usage and processing time. (default: 1)"
        />
        <NumberField
          label="Max Frames"
          value={editVideoMaxFrames}
          onChange={setEditVideoMaxFrames}
          step="1"
          helper="Default: 15"
          tooltip="Maximum total frames to extract from a video. Longer videos are truncated at this limit. (default: 15)"
          disabled={editVideoUnlimitedMaxFrames}
        />
        <NumberField
          label="JPEG Quality"
          value={editVideoQuality}
          onChange={setEditVideoQuality}
          step="0.1"
          helper="Default: 0.8"
          tooltip="Quality of extracted frame images. Higher values preserve more visual detail but produce larger payloads. Range: 0.0–1.0. (default: 0.8)"
        />
        <NumberField
          label="Max Width (px)"
          value={editVideoWidth}
          onChange={setEditVideoWidth}
          step="1"
          helper="Default: 640"
          tooltip="Maximum width in pixels for extracted frames. Frames are scaled down to fit while maintaining aspect ratio. (default: 640)"
        />
      </div>
    </>
  );
}

// ── Performance Page (sub-page) ──

function PerformancePage({
  editAutoOptimizer,
  editLayers,
  editContextSize,
  editGpuLayersAuto,
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
  onSetGpuLayersAuto,
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
  onNavigate,
  editSpecType,
  editDraftModelFilename,
  editCpuMoe,
  editNCpuMoe,
}: {
  editAutoOptimizer: 'longest-context' | 'most-gpu' | 'custom' | null;
  editLayers: number | undefined;
  editContextSize: number | undefined;
  editGpuLayersAuto: boolean;
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
  onSetGpuLayersAuto: (v: boolean) => void;
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
  onNavigate: (page: string) => void;
  editSpecType: string[];
  editDraftModelFilename: string;
  editCpuMoe: boolean;
  editNCpuMoe: string;
}) {
  const isAuto =
    editAutoOptimizer !== null &&
    editAutoOptimizer !== undefined &&
    editAutoOptimizer !== 'custom';
  const sliderNgl = editGpuLayersAuto
    ? (editLayers ?? 0)
    : isAuto
      ? (editLayers ?? 0)
      : (editLayers ?? 0);
  const sliderCtx = isAuto
    ? (editContextSize ?? 512)
    : (editContextSize ?? 512);

  const [memory, setMemory] = useState<{
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  } | null>(initialEstimate);
  const layersDisabled = isAuto || editGpuLayersAuto;
  const activeLayers = editGpuLayersAuto
    ? (editLayers ?? modelMaxLayers)
    : isAuto
      ? (editLayers ?? 0)
      : sliderNgl;
  const activeCtx = isAuto ? (editContextSize ?? 512) : sliderCtx;

  const triggerEstimate = useCallback(
    async (
      ngl: number,
      ctx: number,
      kvOffload?: boolean,
      mmap?: boolean,
      cacheTypeK?: CacheType,
      cacheTypeV?: CacheType,
    ) => {
      if (ngl < 0 || ctx < 512) return;
      const result = await onEstimateMemory(
        ngl,
        ctx,
        kvOffload,
        mmap,
        cacheTypeK,
        cacheTypeV,
      );
      setMemory(result);
    },
    [onEstimateMemory],
  );

  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (
      !initialLoadDone.current &&
      memory === null &&
      activeLayers >= 0 &&
      activeCtx >= 512
    ) {
      initialLoadDone.current = true;
      triggerEstimate(activeLayers, activeCtx);
    }
  }, [memory, activeLayers, activeCtx, triggerEstimate]);

  const prevOptimizerRunning = useRef(optimizerRunning);
  useEffect(() => {
    if (prevOptimizerRunning.current && !optimizerRunning) {
      triggerEstimate(activeLayers, activeCtx);
    }
    prevOptimizerRunning.current = optimizerRunning;
  }, [optimizerRunning, activeLayers, activeCtx, triggerEstimate]);

  const toGB = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);

  const vramOverheadPct =
    totalVRAM > 0 ? (memory?.computeOverheadVram ?? 0) / totalVRAM : 0;
  const vramModelPct =
    totalVRAM > 0 ? (memory?.modelVramUsage ?? 0) / totalVRAM : 0;
  const vramCtxPct =
    totalVRAM > 0 ? (memory?.contextVramUsage ?? 0) / totalVRAM : 0;
  const ramOverheadPct =
    totalRAM > 0 ? (memory?.computeOverheadRam ?? 0) / totalRAM : 0;
  const ramModelPct =
    totalRAM > 0 ? (memory?.modelRamUsage ?? 0) / totalRAM : 0;
  const ramBufferPct =
    totalRAM > 0 ? (memory?.fileBufferRam ?? 0) / totalRAM : 0;
  const ramCtxPct =
    totalRAM > 0 ? (memory?.contextRamUsage ?? 0) / totalRAM : 0;
  const vramFreePct = Math.max(
    0,
    1 - vramOverheadPct - vramModelPct - vramCtxPct,
  );
  const ramFreePct = Math.max(
    0,
    1 - ramOverheadPct - ramModelPct - ramBufferPct - ramCtxPct,
  );

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
        <InfoTooltip
          content={OPTIMIZATION_MODE_TOOLTIP}
          side="right"
          hideIcon
          title="Optimization Mode"
        >
          <div className="epm-section__label">Optimization Mode</div>
        </InfoTooltip>
        <div className="epm-perf-three-toggle">
          <InfoTooltip
            content={LONGEST_CONTEXT_TOOLTIP}
            hideIcon
            title="Longest Context"
            className="epm-perf-btn-wrapper"
          >
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
              <span>Longest Context</span>
            </button>
          </InfoTooltip>
          <InfoTooltip
            content={MOST_GPU_TOOLTIP}
            hideIcon
            title="Most GPU"
            className="epm-perf-btn-wrapper"
          >
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
              <span>Most GPU</span>
            </button>
          </InfoTooltip>
          <InfoTooltip
            content={CUSTOM_TOOLTIP}
            hideIcon
            title="Custom"
            className="epm-perf-btn-wrapper"
          >
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
              <span>Custom</span>
            </button>
          </InfoTooltip>
        </div>
      </div>

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <InfoTooltip
          content="Breakdown of how model weights, KV cache, and compute overhead use video memory."
          side="right"
          hideIcon
          title="Estimated Memory Usage"
        >
          <div className="epm-section__label">Estimated Memory Usage</div>
        </InfoTooltip>

        <div className="epm-estimate-notice">
          <AlertTriangle size={14} />
          <InfoTooltip
            content="The GGUF Parser Go library does not account for all Synapse-specific memory optimizations, so actual usage may differ."
            side="right"
            hideIcon
            title="Memory Estimates"
          >
            <span>
              Memory estimates provided by{' '}
              <a
                href="https://github.com/gpustack/gguf-parser-go"
                target="_blank"
                rel="noopener noreferrer"
              >
                GGUF Parser Go
              </a>
              , which does not support all of Synapse's features, leading to
              inaccurate estimations.
            </span>
          </InfoTooltip>
        </div>

        {memory && totalVRAM > 0 ? (
          <>
            <div className="epm-mem-legend">
              <span className="epm-mem-legend-total">
                <strong>
                  Total:{' '}
                  {toGB(
                    memory.modelVramUsage +
                      memory.contextVramUsage +
                      memory.computeOverheadVram,
                  )}
                  GB
                </strong>
              </span>
              {memory.modelVramUsage > 0 && (
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--model" />
                  <InfoTooltip
                    content={MODEL_WEIGHTS_TOOLTIP}
                    side="right"
                    hideIcon
                    title="Model Weights"
                  >
                    <span>Model Weights ({toGB(memory.modelVramUsage)}GB)</span>
                  </InfoTooltip>
                </span>
              )}
              {memory.contextVramUsage > 0 && (
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--ctx" />
                  <InfoTooltip
                    content={KV_CACHE_MEM_TOOLTIP}
                    side="right"
                    hideIcon
                    title="KV Cache"
                  >
                    <span>KV Cache ({toGB(memory.contextVramUsage)}GB)</span>
                  </InfoTooltip>
                </span>
              )}
              {memory.computeOverheadVram > 0 && (
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--overhead" />
                  <InfoTooltip
                    content={COMPUTE_OVERHEAD_TOOLTIP}
                    side="right"
                    hideIcon
                    title="Compute Overhead"
                  >
                    <span>
                      Compute Overhead ({toGB(memory.computeOverheadVram)}GB)
                    </span>
                  </InfoTooltip>
                </span>
              )}
              <span className="epm-mem-legend-item">
                <span className="epm-mem-dot epm-mem-dot--free" /> Free (
                {toGB(
                  Math.max(
                    0,
                    totalVRAM -
                      memory.modelVramUsage -
                      memory.contextVramUsage -
                      memory.computeOverheadVram,
                  ),
                )}
                GB)
              </span>
            </div>

            <div className="epm-mem-bar-wrap">
              <InfoTooltip
                content={VRAM_LABEL_TOOLTIP}
                side="right"
                hideIcon
                title="VRAM"
              >
                <div className="epm-mem-bar-label-inline">VRAM</div>
              </InfoTooltip>
              <div className="epm-mem-bar-track">
                <InfoTooltip
                  content={`Model Weights: ${toGB(memory.modelVramUsage)}GB`}
                  className="epm-mem-segment epm-mem-segment--model"
                  hideIcon
                  side="bottom"
                  title="Model Weights"
                  style={{ width: `${vramModelPct * 100}%` }}
                />
                <InfoTooltip
                  content={`KV Cache: ${toGB(memory.contextVramUsage)}GB`}
                  className="epm-mem-segment epm-mem-segment--ctx"
                  hideIcon
                  side="bottom"
                  title="KV Cache"
                  style={{ width: `${vramCtxPct * 100}%` }}
                />
                <InfoTooltip
                  content={`Compute Overhead: ${toGB(memory.computeOverheadVram)}GB`}
                  className="epm-mem-segment epm-mem-segment--overhead"
                  hideIcon
                  side="bottom"
                  title="Compute Overhead"
                  style={{ width: `${vramOverheadPct * 100}%` }}
                />
                <InfoTooltip
                  content={`Free: ${toGB(Math.max(0, totalVRAM - memory.modelVramUsage - memory.contextVramUsage - memory.computeOverheadVram))}GB`}
                  className="epm-mem-segment epm-mem-segment--free"
                  hideIcon
                  side="bottom"
                  title="Free"
                  style={{ width: `${vramFreePct * 100}%` }}
                />
              </div>
              <div className="epm-mem-bar-total">{toGB(totalVRAM)} GB</div>
            </div>
          </>
        ) : (
          <>
            <div className="epm-mem-legend">
              <span className="epm-mem-legend-total">
                <strong>Total: — GB</strong>
              </span>
            </div>
            <div className="epm-mem-bar-wrap">
              <div className="epm-mem-bar-label-inline">VRAM</div>
              <div className="epm-mem-bar-track">
                <div
                  className="epm-mem-segment epm-mem-segment--loading"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="epm-mem-bar-total">— GB</div>
            </div>
          </>
        )}

        {memory && totalRAM > 0 ? (
          <>
            <div className="epm-mem-legend" style={{ marginTop: '14px' }}>
              <span className="epm-mem-legend-total">
                <strong>
                  Total:{' '}
                  {toGB(
                    memory.modelRamUsage +
                      memory.contextRamUsage +
                      memory.fileBufferRam +
                      memory.computeOverheadRam,
                  )}
                  GB
                </strong>
              </span>
              {memory.modelRamUsage > 0 && (
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--model" />
                  <InfoTooltip
                    content={MODEL_WEIGHTS_TOOLTIP}
                    side="right"
                    hideIcon
                    title="Model Weights"
                  >
                    <span>Model Weights ({toGB(memory.modelRamUsage)}GB)</span>
                  </InfoTooltip>
                </span>
              )}
              {memory.contextRamUsage > 0 && (
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--ctx" />
                  <InfoTooltip
                    content={KV_CACHE_MEM_TOOLTIP}
                    side="right"
                    hideIcon
                    title="KV Cache"
                  >
                    <span>KV Cache ({toGB(memory.contextRamUsage)}GB)</span>
                  </InfoTooltip>
                </span>
              )}
              {memory.fileBufferRam > 0 && (
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--buffer" />
                  <InfoTooltip
                    content={FILE_BUFFER_TOOLTIP}
                    side="right"
                    hideIcon
                    title="File Buffer"
                  >
                    <span>File Buffer ({toGB(memory.fileBufferRam)}GB)</span>
                  </InfoTooltip>
                </span>
              )}
              {memory.computeOverheadRam > 0 && (
                <span className="epm-mem-legend-item">
                  <span className="epm-mem-dot epm-mem-dot--overhead" />
                  <InfoTooltip
                    content={COMPUTE_OVERHEAD_TOOLTIP}
                    side="right"
                    hideIcon
                    title="Compute Overhead"
                  >
                    <span>
                      Compute Overhead ({toGB(memory.computeOverheadRam)}GB)
                    </span>
                  </InfoTooltip>
                </span>
              )}
              <span className="epm-mem-legend-item">
                <span className="epm-mem-dot epm-mem-dot--free" /> Free (
                {toGB(
                  Math.max(
                    0,
                    totalRAM -
                      memory.modelRamUsage -
                      memory.contextRamUsage -
                      memory.fileBufferRam -
                      memory.computeOverheadRam,
                  ),
                )}
                GB)
              </span>
            </div>
            <div className="epm-mem-bar-wrap">
              <InfoTooltip
                content={RAM_LABEL_TOOLTIP}
                side="right"
                hideIcon
                title="RAM"
              >
                <div className="epm-mem-bar-label-inline">RAM</div>
              </InfoTooltip>
              <div className="epm-mem-bar-track">
                <InfoTooltip
                  content={`Model Weights: ${toGB(memory.modelRamUsage)}GB`}
                  className="epm-mem-segment epm-mem-segment--model"
                  hideIcon
                  side="bottom"
                  title="Model Weights"
                  style={{ width: `${ramModelPct * 100}%` }}
                />
                <InfoTooltip
                  content={`KV Cache: ${toGB(memory.contextRamUsage)}GB`}
                  className="epm-mem-segment epm-mem-segment--ctx"
                  hideIcon
                  side="bottom"
                  title="KV Cache"
                  style={{ width: `${ramCtxPct * 100}%` }}
                />
                <InfoTooltip
                  content={`File Buffer: ${toGB(memory.fileBufferRam)}GB`}
                  className="epm-mem-segment epm-mem-segment--buffer"
                  hideIcon
                  side="bottom"
                  title="File Buffer"
                  style={{ width: `${ramBufferPct * 100}%` }}
                />
                <InfoTooltip
                  content={`Compute Overhead: ${toGB(memory.computeOverheadRam)}GB`}
                  className="epm-mem-segment epm-mem-segment--overhead"
                  hideIcon
                  side="bottom"
                  title="Compute Overhead"
                  style={{ width: `${ramOverheadPct * 100}%` }}
                />
                <InfoTooltip
                  content={`Free: ${toGB(Math.max(0, totalRAM - memory.modelRamUsage - memory.contextRamUsage - memory.fileBufferRam - memory.computeOverheadRam))}GB`}
                  className="epm-mem-segment epm-mem-segment--free"
                  hideIcon
                  side="bottom"
                  title="Free"
                  style={{ width: `${ramFreePct * 100}%` }}
                />
              </div>
              <div className="epm-mem-bar-total">{toGB(totalRAM)} GB</div>
            </div>
          </>
        ) : (
          <>
            <div className="epm-mem-legend" style={{ marginTop: '14px' }}>
              <span className="epm-mem-legend-total">
                <strong>Total: — GB</strong>
              </span>
            </div>
            <div className="epm-mem-bar-wrap">
              <div className="epm-mem-bar-label-inline">RAM</div>
              <div className="epm-mem-bar-track">
                <div
                  className="epm-mem-segment epm-mem-segment--loading"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="epm-mem-bar-total">— GB</div>
            </div>
          </>
        )}
      </div>

      {/* Sliders */}
      <div className="epm-section" style={{ marginTop: '16px' }}>
        <InfoTooltip
          content="Adjust GPU offloading and context size to balance speed against memory usage."
          side="right"
          hideIcon
          title="Settings"
        >
          <div className="epm-section__label">Settings</div>
        </InfoTooltip>
        <div className="epm-perf-sliders">
          <div className="epm-perf-slider-group">
            <label className="epm-perf-toggle-row" style={{ paddingTop: 0 }}>
              <InfoTooltip
                content={GPU_LAYERS_AUTO_TOOLTIP}
                side="right"
                stretch
                className="info-tooltip-stretch--row"
                title="GPU Layers Auto"
              >
                <span className="epm-perf-toggle-label">GPU Layers Auto</span>
                <div
                  className={`epm-toggle-switch${editGpuLayersAuto ? ' epm-toggle-switch--on' : ''}`}
                  onClick={() => onSetGpuLayersAuto(!editGpuLayersAuto)}
                  role="switch"
                  aria-checked={editGpuLayersAuto}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      onSetGpuLayersAuto(!editGpuLayersAuto);
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </InfoTooltip>
            </label>
            <InfoTooltip
              content={GPU_LAYERS_TOOLTIP}
              side="bottom"
              stretch
              className="info-tooltip-stretch--col"
              title="GPU Layers (NGL)"
            >
              <label className="epm-perf-slider-label">
                GPU Layers (NGL):{' '}
                <strong>{editGpuLayersAuto ? 'Auto' : sliderNgl}</strong>
              </label>
              <input
                type="range"
                min={0}
                max={modelMaxLayers}
                step={1}
                value={sliderNgl}
                disabled={layersDisabled}
                className={`epm-perf-range${layersDisabled ? ' epm-perf-range--disabled' : ''}`}
                onChange={(e) => {
                  if (!layersDisabled) {
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
            <InfoTooltip
              content={CONTEXT_SIZE_TOOLTIP}
              side="bottom"
              stretch
              className="info-tooltip-stretch--col"
              title="Context Size"
            >
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

      {/* Submenu SectionCards */}
      <div className="epm-section" style={{ marginTop: '20px' }}>
        <div className="epm-section__label">Advanced Options</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: '10px',
          }}
        >
          <button
            type="button"
            className="epm-section-card"
            onClick={() => onNavigate('cache-options')}
          >
            <div className="epm-section-card__icon">
              <SlidersHorizontal size={18} />
            </div>
            <div className="epm-section-card__body">
              <InfoTooltip
                content="Fine-tune KV cache behaviour and data types for memory and quality tradeoffs."
                title="Cache Options"
                side="right"
                hideIcon
              >
                <div className="epm-section-card__title">Cache Options</div>
              </InfoTooltip>
              <div className="epm-section-card__preview">
                KV Cache: {editKvOffload ? 'Offloaded' : 'CPU'}, K:{' '}
                {editCacheTypeK.toUpperCase()}, V:{' '}
                {editCacheTypeV.toUpperCase()}
              </div>
            </div>
            <ChevronRight size={16} className="epm-section-card__chevron" />
          </button>
          <button
            type="button"
            className="epm-section-card"
            onClick={() => onNavigate('draft-model')}
          >
            <div className="epm-section-card__icon">
              <Zap size={18} />
            </div>
            <div className="epm-section-card__body">
              <InfoTooltip
                content={DRAFT_MODEL_TOOLTIP}
                title="Draft Model"
                side="right"
                hideIcon
              >
                <div className="epm-section-card__title">Draft Model</div>
              </InfoTooltip>
              <div className="epm-section-card__preview">
                {editSpecType.length > 0
                  ? `${editSpecType.join(', ')}`
                  : 'Disabled'}
                {editDraftModelFilename ? ` — ${editDraftModelFilename}` : ''}
              </div>
            </div>
            <ChevronRight size={16} className="epm-section-card__chevron" />
          </button>
          <button
            type="button"
            className="epm-section-card"
            onClick={() => onNavigate('memory-options')}
          >
            <div className="epm-section-card__icon">
              <SlidersHorizontal size={18} />
            </div>
            <div className="epm-section-card__body">
              <InfoTooltip
                content="Control how model weights are loaded into memory."
                title="Memory Options"
                side="right"
                hideIcon
              >
                <div className="epm-section-card__title">Memory Options</div>
              </InfoTooltip>
              <div className="epm-section-card__preview">
                MMAP: {editMmap ? 'On' : 'Off'}, MLock:{' '}
                {editMlock ? 'On' : 'Off'}
              </div>
            </div>
            <ChevronRight size={16} className="epm-section-card__chevron" />
          </button>
          <button
            type="button"
            className="epm-section-card"
            onClick={() => onNavigate('moe-options')}
          >
            <div className="epm-section-card__icon">
              <Zap size={18} />
            </div>
            <div className="epm-section-card__body">
              <InfoTooltip
                content="Configure how Mixture of Experts (MoE) weights are distributed between CPU and GPU."
                title="Mixture of Experts"
                side="right"
                hideIcon
              >
                <div className="epm-section-card__title">
                  Mixture of Experts
                </div>
              </InfoTooltip>
              <div className="epm-section-card__preview">
                CPU MoE: {editCpuMoe ? 'On' : 'Off'}
                {parseInt(editNCpuMoe || '0', 10) > 0
                  ? `, N: ${editNCpuMoe}`
                  : ''}
              </div>
            </div>
            <ChevronRight size={16} className="epm-section-card__chevron" />
          </button>
        </div>
      </div>
    </>
  );
}

// ── Cache Options subpage ──

function CacheOptionsPage({
  editKvOffload,
  editCacheTypeK,
  editCacheTypeV,
  onSetKvOffload,
  onSetCacheTypeK,
  onSetCacheTypeV,
  onEstimateMemory,
}: {
  editKvOffload: boolean;
  editCacheTypeK: CacheType;
  editCacheTypeV: CacheType;
  onSetKvOffload: (v: boolean) => void;
  onSetCacheTypeK: (v: CacheType) => void;
  onSetCacheTypeV: (v: CacheType) => void;
  onEstimateMemory: (
    ngl: number,
    ctx: number,
    kvOffload?: boolean,
    mmap?: boolean,
    cacheTypeK?: CacheType,
    cacheTypeV?: CacheType,
  ) => Promise<any>;
}) {
  return (
    <>
      <h2 className="epm-page-title">Cache Options</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Fine-tune KV cache behaviour and data types for memory and quality
        tradeoffs.
      </p>

      <div className="epm-section">
        <InfoTooltip
          content="Cache Options"
          side="right"
          hideIcon
          title="Cache Options"
        >
          <div className="epm-section__label">KV Cache</div>
        </InfoTooltip>
        <div className="epm-perf-toggles">
          <label className="epm-perf-toggle-row">
            <InfoTooltip
              content={KV_CACHE_OFFLOAD_TOOLTIP}
              side="right"
              stretch
              className="info-tooltip-stretch--row"
              title="KV Cache Offload"
            >
              <span className="epm-perf-toggle-label">KV Cache Offload</span>
              <div
                className={`epm-toggle-switch${editKvOffload ? ' epm-toggle-switch--on' : ''}`}
                onClick={() => {
                  const next = !editKvOffload;
                  onSetKvOffload(next);
                  onEstimateMemory(
                    0,
                    512,
                    next,
                    true,
                    editCacheTypeK,
                    editCacheTypeV,
                  );
                }}
                role="switch"
                aria-checked={editKvOffload}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    const next = !editKvOffload;
                    onSetKvOffload(next);
                    onEstimateMemory(
                      0,
                      512,
                      next,
                      true,
                      editCacheTypeK,
                      editCacheTypeV,
                    );
                  }
                }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </InfoTooltip>
          </label>
        </div>
        <div className="epm-cache-selectors-row">
          <InfoTooltip
            content={K_CACHE_TYPE_TOOLTIP}
            stretch
            side="right"
            title="K Cache Type"
          >
            <CacheTypeSelector
              label="K Cache Type"
              value={editCacheTypeK}
              onChange={(v) => {
                onSetCacheTypeK(v);
                onEstimateMemory(
                  0,
                  512,
                  editKvOffload,
                  true,
                  v,
                  editCacheTypeV,
                );
              }}
            />
          </InfoTooltip>
          <InfoTooltip
            content={V_CACHE_TYPE_TOOLTIP}
            stretch
            side="left"
            title="V Cache Type"
          >
            <CacheTypeSelector
              label="V Cache Type"
              value={editCacheTypeV}
              onChange={(v) => {
                onSetCacheTypeV(v);
                onEstimateMemory(
                  0,
                  512,
                  editKvOffload,
                  true,
                  editCacheTypeK,
                  v,
                );
              }}
            />
          </InfoTooltip>
        </div>
      </div>
    </>
  );
}

// ── Memory Options subpage ──

function MemoryOptionsPage({
  editMmap,
  editMlock,
  onSetMmap,
  onSetMlock,
}: {
  editMmap: boolean;
  editMlock: boolean;
  onSetMmap: (v: boolean) => void;
  onSetMlock: (v: boolean) => void;
}) {
  return (
    <>
      <h2 className="epm-page-title">Memory Options</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Control how model weights are loaded into memory.
      </p>

      <div className="epm-perf-toggles">
        <label className="epm-perf-toggle-row">
          <InfoTooltip
            content={MMAP_TOOLTIP}
            side="right"
            stretch
            className="info-tooltip-stretch--row"
            title="Memory-Mapped (MMAP)"
          >
            <span className="epm-perf-toggle-label">Memory-Mapped (MMAP)</span>
            <div
              className={`epm-toggle-switch${editMmap ? ' epm-toggle-switch--on' : ''}`}
              onClick={() => onSetMmap(!editMmap)}
              role="switch"
              aria-checked={editMmap}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onSetMmap(!editMmap);
                }
              }}
            >
              <div className="epm-toggle-switch__knob" />
            </div>
          </InfoTooltip>
        </label>
        <label className="epm-perf-toggle-row">
          <InfoTooltip
            content={MLOCK_TOOLTIP}
            side="right"
            stretch
            className="info-tooltip-stretch--row"
            title="MLock (Pin RAM)"
          >
            <span className="epm-perf-toggle-label">MLock (Pin RAM)</span>
            <div
              className={`epm-toggle-switch${editMlock ? ' epm-toggle-switch--on' : ''}`}
              onClick={() => onSetMlock(!editMlock)}
              role="switch"
              aria-checked={editMlock}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onSetMlock(!editMlock);
                }
              }}
            >
              <div className="epm-toggle-switch__knob" />
            </div>
          </InfoTooltip>
        </label>
      </div>
    </>
  );
}

// ── Draft Model (Speculative Decoding) subpage ──

const SPEC_TYPE_OPTIONS = [
  {
    value: 'draft-mtp',
    label: 'MTP',
    group: 'internal',
    tooltip:
      "Uses the model's internal MTP (Multi-Token Prediction) heads — no external model needed.",
  },
  {
    value: 'draft-eagle3',
    label: 'EAGLE3',
    group: 'internal',
    tooltip:
      "Uses the model's EAGLE3-style draft heads — no external model needed.",
  },
  {
    value: 'draft-simple',
    label: 'Simple',
    group: 'model',
    tooltip: 'Uses an external GGUF model as the draft model.',
  },
  {
    value: 'ngram-simple',
    label: 'N-Gram Simple',
    group: 'ngram',
    tooltip:
      'Extracts draft candidates from the prompt context using simple n-gram matching.',
  },
  {
    value: 'ngram-map-k',
    label: 'N-Gram Map K',
    group: 'ngram',
    tooltip: 'N-gram based draft using a map indexed by K tokens.',
  },
  {
    value: 'ngram-map-k4v',
    label: 'N-Gram Map K4V',
    group: 'ngram',
    tooltip: 'N-gram based draft using a K-token map with 4-byte values.',
  },
  {
    value: 'ngram-mod',
    label: 'N-Gram Mod',
    group: 'ngram',
    tooltip:
      'N-gram based draft using modular matching for candidate selection.',
  },
  {
    value: 'ngram-cache',
    label: 'N-Gram Cache',
    group: 'ngram',
    tooltip:
      'N-gram based draft that caches candidates for reuse across steps.',
  },
];

const SPEC_TYPE_GROUP_LABELS: Record<string, string> = {
  internal: 'Internal (no model needed)',
  model: 'External Model',
  ngram: 'N-Gram Based',
};

function DraftModelPage({
  editSpecType,
  editDraftModelAuthor,
  editDraftModelFolder,
  editDraftModelFilename,
  editSpecDraftNMax,
  editSpecDraftNMin,
  editSpecDraftPSplit,
  editSpecDraftPMin,
  selectedDraftModelDisplay,
  onSetSpecType,
  onSetDraftModelAuthor,
  onSetDraftModelFolder,
  onSetDraftModelFilename,
  onSetSpecDraftNMax,
  onSetSpecDraftNMin,
  onSetSpecDraftPSplit,
  onSetSpecDraftPMin,
  onOpenDraftModelModal,
}: {
  editSpecType: string[];
  editDraftModelAuthor: string;
  editDraftModelFolder: string;
  editDraftModelFilename: string;
  editSpecDraftNMax: string;
  editSpecDraftNMin: string;
  editSpecDraftPSplit: string;
  editSpecDraftPMin: string;
  selectedDraftModelDisplay: {
    name: string;
    quantization: string;
    sizeBytes: number;
    filename?: string;
    group?: string;
  } | null;
  onSetSpecType: (v: string[]) => void;
  onSetDraftModelAuthor: (v: string) => void;
  onSetDraftModelFolder: (v: string) => void;
  onSetDraftModelFilename: (v: string) => void;
  onSetSpecDraftNMax: (v: string) => void;
  onSetSpecDraftNMin: (v: string) => void;
  onSetSpecDraftPSplit: (v: string) => void;
  onSetSpecDraftPMin: (v: string) => void;
  onOpenDraftModelModal: () => void;
}) {
  const hasSimple = editSpecType.includes('draft-simple');
  const noSpec = editSpecType.length === 0;

  const handleToggleType = (value: string) => {
    if (editSpecType.includes(value)) {
      onSetSpecType(editSpecType.filter((t) => t !== value));
    } else {
      onSetSpecType([...editSpecType, value]);
    }
  };

  return (
    <>
      <h2 className="epm-page-title">Draft Model</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Configure speculative decoding to speed up generation using a draft
        model or built-in strategies.
      </p>

      <div className="epm-section">
        <div className="epm-section__label">Draft Type</div>
        {(['internal', 'model', 'ngram'] as const).map((groupKey) => {
          const groupOptions = SPEC_TYPE_OPTIONS.filter(
            (o) => o.group === groupKey,
          );
          if (groupOptions.length === 0) return null;
          return (
            <div key={groupKey} className="epm-draft-type-group">
              <div className="epm-draft-type-group-label">
                {SPEC_TYPE_GROUP_LABELS[groupKey]}
              </div>
              <div className="epm-draft-type-tags">
                {groupOptions.map((opt) => (
                  <InfoTooltip
                    key={opt.value}
                    content={opt.tooltip}
                    side="right"
                    hideIcon
                  >
                    <button
                      type="button"
                      className={`epm-draft-type-tag${editSpecType.includes(opt.value) ? ' epm-draft-type-tag--active' : ''}`}
                      onClick={() => handleToggleType(opt.value)}
                    >
                      {opt.label}
                    </button>
                  </InfoTooltip>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Draft model file selector — only shown when draft-simple is active */}
      {hasSimple && (
        <div className="epm-section" style={{ marginTop: '20px' }}>
          <InfoTooltip
            content="A smaller GGUF model used as the draft model for speculative decoding."
            side="right"
            hideIcon
            title="External Draft Model"
          >
            <div className="epm-section__label">External Draft Model</div>
          </InfoTooltip>
          <div
            className="epm-section-card"
            style={{ marginTop: '10px' }}
            onClick={onOpenDraftModelModal}
          >
            <div className="epm-section-card__icon">
              <Zap size={18} />
            </div>
            <div className="epm-section-card__body">
              <div className="epm-section-card__title">
                {selectedDraftModelDisplay
                  ? selectedDraftModelDisplay.filename ||
                    selectedDraftModelDisplay.name
                  : 'Select Draft Model'}
              </div>
              <div className="epm-section-card__preview">
                {selectedDraftModelDisplay
                  ? `${selectedDraftModelDisplay.filename || selectedDraftModelDisplay.name} — ${formatBytes(selectedDraftModelDisplay.sizeBytes)}`
                  : 'No draft model selected'}
              </div>
            </div>
            <ChevronRight size={16} className="epm-section-card__chevron" />
          </div>
        </div>
      )}

      {/* Numeric sliders */}
      <div className="epm-section" style={{ marginTop: '20px' }}>
        <InfoTooltip
          content={DRAFT_MODEL_TOOLTIP}
          side="right"
          hideIcon
          title="Draft Parameters"
        >
          <div className="epm-section__label">Draft Parameters</div>
        </InfoTooltip>
        <div className="epm-number-grid">
          <NumberField
            label="Draft N Max"
            value={editSpecDraftNMax}
            onChange={onSetSpecDraftNMax}
            min="1"
            max="16"
            step="1"
            helper="Default: 3"
            tooltip={DRAFT_N_MAX_TOOLTIP}
            tooltipTitle="Draft N Max"
          />
          <NumberField
            label="Draft N Min"
            value={editSpecDraftNMin}
            onChange={onSetSpecDraftNMin}
            min="0"
            max="16"
            step="1"
            helper="Default: 0"
            tooltip={DRAFT_N_MIN_TOOLTIP}
            tooltipTitle="Draft N Min"
          />
          <NumberField
            label="Draft P Split"
            value={editSpecDraftPSplit}
            onChange={onSetSpecDraftPSplit}
            min="0"
            max="1"
            step="0.01"
            helper="Default: 0.10"
            tooltip={DRAFT_P_SPLIT_TOOLTIP}
            tooltipTitle="Draft P Split"
          />
          <NumberField
            label="Draft P Min"
            value={editSpecDraftPMin}
            onChange={onSetSpecDraftPMin}
            min="0"
            max="1"
            step="0.01"
            helper="Default: 0.00"
            tooltip={DRAFT_P_MIN_TOOLTIP}
            tooltipTitle="Draft P Min"
          />
        </div>
      </div>
    </>
  );
}

// ── Mixture of Experts (MoE) subpage ──

function MoeOptionsPage({
  editCpuMoe,
  editNCpuMoe,
  onSetCpuMoe,
  onSetNCpuMoe,
}: {
  editCpuMoe: boolean;
  editNCpuMoe: string;
  onSetCpuMoe: (v: boolean) => void;
  onSetNCpuMoe: (v: string) => void;
}) {
  return (
    <>
      <h2 className="epm-page-title">Mixture of Experts</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Control where Mixture of Experts (MoE) weights are loaded for large
        MoE-based models.
      </p>

      <div className="epm-perf-toggles">
        <label className="epm-perf-toggle-row">
          <InfoTooltip
            content={CPU_MOE_TOOLTIP}
            side="right"
            stretch
            className="info-tooltip-stretch--row"
            title="CPU MoE"
          >
            <span className="epm-perf-toggle-label">CPU MoE</span>
            <div
              className={`epm-toggle-switch${editCpuMoe ? ' epm-toggle-switch--on' : ''}`}
              onClick={() => onSetCpuMoe(!editCpuMoe)}
              role="switch"
              aria-checked={editCpuMoe}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onSetCpuMoe(!editCpuMoe);
                }
              }}
            >
              <div className="epm-toggle-switch__knob" />
            </div>
          </InfoTooltip>
        </label>
      </div>

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <div className="epm-number-grid">
          <NumberField
            label="N CPU MoE"
            value={editNCpuMoe}
            onChange={onSetNCpuMoe}
            min="0"
            max="999"
            step="1"
            helper="Default: 0"
            tooltip={N_CPU_MOE_TOOLTIP}
            tooltipTitle="N CPU MoE"
          />
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
  extensionGroups,
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
  const [editModelAuthor, setEditModelAuthor] = useState(
    profile?.modelAuthor ?? '',
  );
  const [editModelFolder, setEditModelFolder] = useState(
    profile?.modelFolder ?? '',
  );
  const [editModelFilename, setEditModelFilename] = useState(
    profile?.modelFilename ?? '',
  );
  const [editProjectorFilename, setEditProjectorFilename] = useState(
    profile?.projectorFilename ?? '',
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
  const [editGpuLayersAuto, setEditGpuLayersAuto] = useState<boolean>(
    profile?.gpuLayersAuto ?? false,
  );
  const [editKvOffload, setEditKvOffload] = useState<boolean>(
    profile?.kvOffload ?? true,
  );
  const [editMmap, setEditMmap] = useState<boolean>(profile?.mmap ?? true);
  const [editMlock, setEditMlock] = useState<boolean>(profile?.mlock ?? false);
  const [editCacheTypeK, setEditCacheTypeK] = useState<CacheType>(
    profile?.cacheTypeK ?? 'f16',
  );
  const [editCacheTypeV, setEditCacheTypeV] = useState<CacheType>(
    profile?.cacheTypeV ?? 'f16',
  );
  const [optimizerRunning, setOptimizerRunning] = useState<
    'longest-context' | 'most-gpu' | null
  >(null);

  // Draft model (speculative decoding) options
  const [editSpecType, setEditSpecType] = useState<string[]>(
    profile?.specType ?? [],
  );
  const [editDraftModelAuthor, setEditDraftModelAuthor] = useState(
    profile?.draftModelAuthor ?? '',
  );
  const [editDraftModelFolder, setEditDraftModelFolder] = useState(
    profile?.draftModelFolder ?? '',
  );
  const [editDraftModelFilename, setEditDraftModelFilename] = useState(
    profile?.draftModelFilename ?? '',
  );
  const [editSpecDraftNMax, setEditSpecDraftNMax] = useState<string>(
    String(profile?.specDraftNMax ?? 3),
  );
  const [editSpecDraftNMin, setEditSpecDraftNMin] = useState<string>(
    String(profile?.specDraftNMin ?? 0),
  );
  const [editSpecDraftPSplit, setEditSpecDraftPSplit] = useState<string>(
    String(profile?.specDraftPSplit ?? 0.1),
  );
  const [editSpecDraftPMin, setEditSpecDraftPMin] = useState<string>(
    String(profile?.specDraftPMin ?? 0.0),
  );

  // Mixture of Experts (MoE) options
  const [editCpuMoe, setEditCpuMoe] = useState<boolean>(
    profile?.cpuMoe ?? false,
  );
  const [editNCpuMoe, setEditNCpuMoe] = useState<string>(
    String(profile?.nCpuMoe ?? 0),
  );

  const [editVideoFps, setEditVideoFps] = useState<string>(
    profile?.videoSettings?.fps?.toString() ?? '',
  );
  const [editVideoMaxFrames, setEditVideoMaxFrames] = useState<string>(
    profile?.videoSettings?.maxFrames?.toString() ?? '',
  );
  const [editVideoQuality, setEditVideoQuality] = useState<string>(
    profile?.videoSettings?.quality?.toString() ?? '',
  );
  const [editVideoWidth, setEditVideoWidth] = useState<string>(
    profile?.videoSettings?.maxWidth?.toString() ?? '',
  );
  const [editVideoUnlimitedMaxFrames, setEditVideoUnlimitedMaxFrames] =
    useState<boolean>(profile?.videoSettings?.unlimitedMaxFrames ?? false);

  const profileSnapshotRef = useRef(profile ? JSON.stringify(profile) : null);

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
    if (!editModelFilename) return;
    const currentModelPath = `${editModelAuthor}/${editModelFolder}/${editModelFilename}`;
    if (
      profile?.maxForModel === currentModelPath &&
      profile?.maxLayers &&
      profile?.maxContext
    ) {
      setModelMeta({
        maxLayers: profile.maxLayers,
        maxContext: profile.maxContext,
      });
      return;
    }
    window.electronAPI
      .getModelMetadata({
        modelAuthor: editModelAuthor,
        modelFolder: editModelFolder,
        modelFilename: editModelFilename,
        projectorFilename: editProjectorFilename || undefined,
      })
      .then((meta) => setModelMeta(meta))
      .catch(() => setModelMeta(null));
  }, [
    editModelFilename,
    editProjectorFilename,
    editModelAuthor,
    editModelFolder,
  ]);

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
  const [showDraftModelModal, setShowDraftModelModal] = useState(false);

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
    if (!editModelFilename) {
      setOptimizerRunning(null);
      return;
    }
    window.electronAPI
      .runProfileOptimizer({
        modelAuthor: editModelAuthor,
        modelFolder: editModelFolder,
        modelFilename: editModelFilename,
        projectorFilename: editProjectorFilename || undefined,
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
    if (!editModelFilename) return null;
    const result = await window.electronAPI.estimateMemory({
      modelAuthor: editModelAuthor,
      modelFolder: editModelFolder,
      modelFilename: editModelFilename,
      projectorFilename: editProjectorFilename || undefined,
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
    if (!editName.trim() || !editModelFilename) return;

    const modelRelativePath = `${editModelAuthor}/${editModelFolder}/${editModelFilename}`;

    let projectorRelativePath: string | undefined;
    if (editProjectorFilename) {
      projectorRelativePath = `${editModelAuthor}/${editModelFolder}/projectors/${editProjectorFilename}`;
    }

    const buildVideoSettings = (): Profile['videoSettings'] => {
      const fps = parseFloat(editVideoFps);
      const maxFrames = parseFloat(editVideoMaxFrames);
      const quality = parseFloat(editVideoQuality);
      const maxWidth = parseFloat(editVideoWidth);
      const vs: NonNullable<Profile['videoSettings']> = {};
      if (!isNaN(fps) && fps > 0) vs.fps = fps;
      if (editVideoUnlimitedMaxFrames) {
        vs.unlimitedMaxFrames = true;
      } else if (!isNaN(maxFrames) && maxFrames > 0) {
        vs.maxFrames = maxFrames;
      }
      if (!isNaN(quality) && quality > 0 && quality <= 1) vs.quality = quality;
      if (!isNaN(maxWidth) && maxWidth > 0) vs.maxWidth = maxWidth;
      return Object.keys(vs).length > 0 ? vs : undefined;
    };

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
      modelAuthor: editModelAuthor,
      modelFolder: editModelFolder,
      modelFilename: editModelFilename,
      projectorFilename: editProjectorFilename || undefined,
      systemPrompt: editSystemPrompt,
      temperature: parseFloat(editTemperature),
      topK: parseInt(editTopK, 10),
      topP: parseFloat(editTopP),
      minP: parseFloat(editMinP),
      seed: parseInt(editSeed, 10),
      tools: editTools.filter((t) => getAvailableToolNames().includes(t)),
      repeatPenalty: buildRepeatPenalty(),
      kvOffload: editKvOffload,
      cacheTypeK: editCacheTypeK,
      cacheTypeV: editCacheTypeV,
      mmap: editMmap,
      mlock: editMlock,
      gpuLayersAuto: editGpuLayersAuto,
      ...(modelMeta
        ? {
            maxForModel: modelRelativePath,
            maxLayers: modelMeta.maxLayers,
            maxContext: modelMeta.maxContext,
          }
        : {}),
      estimation: lastEstimate ?? undefined,
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
      videoSettings: buildVideoSettings(),
      specType: editSpecType.length > 0 ? editSpecType : undefined,
      draftModelAuthor:
        (editSpecType.includes('draft-simple') && editDraftModelAuthor) ||
        undefined,
      draftModelFolder:
        (editSpecType.includes('draft-simple') && editDraftModelFolder) ||
        undefined,
      draftModelFilename:
        (editSpecType.includes('draft-simple') && editDraftModelFilename) ||
        undefined,
      specDraftNMax: parseFloat(editSpecDraftNMax),
      specDraftNMin: parseFloat(editSpecDraftNMin),
      specDraftPSplit: parseFloat(editSpecDraftPSplit),
      specDraftPMin: parseFloat(editSpecDraftPMin),
      cpuMoe: editCpuMoe,
      nCpuMoe: parseInt(editNCpuMoe, 10),
      order: profile?.order ?? now,
      createdAt: profile?.createdAt ?? now,
    };

    // Don't save if nothing actually changed
    if (profile) {
      const currentSnapshot = JSON.stringify(updatedProfile);
      if (currentSnapshot === profileSnapshotRef.current) {
        onClose();
        return;
      }
    }

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
    if (!editModelFolder) return [];
    const targetName = editModelAuthor
      ? `${editModelAuthor}/${editModelFolder}`
      : editModelFolder;
    const selectedGroup = groupedLocalModels.find((g) => g.name === targetName);
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
    if (!editModelFilename) return null;
    const groupName = editModelAuthor
      ? `${editModelAuthor}/${editModelFolder}`
      : editModelFolder;
    for (const group of modelSelectGroups) {
      if (group.name !== groupName) continue;
      const v = group.variants.find((v) => v.filename === editModelFilename);
      if (v) return { groupName, ...v };
      break;
    }
    return {
      groupName,
      filename: editModelFilename,
      quantization: extractQuantizationFromFilename(editModelFilename),
      sizeBytes: 0,
    };
  })();

  const selectedProjectorDisplay = (() => {
    if (!editProjectorFilename) return null;
    const found = availableProjectorsForEdit.find(
      (p) => p.filename === editProjectorFilename,
    );
    if (found) return found;
    return {
      filename: editProjectorFilename,
      quantization: extractQuantizationFromFilename(editProjectorFilename),
      sizeBytes: 0,
    };
  })();

  const selectedDraftModelDisplay = (() => {
    if (!editDraftModelFilename) return null;
    const groupName = editDraftModelAuthor
      ? `${editDraftModelAuthor}/${editDraftModelFolder}`
      : editDraftModelFolder;
    for (const group of modelSelectGroups) {
      if (group.name !== groupName) continue;
      const v = group.variants.find(
        (v) => v.filename === editDraftModelFilename,
      );
      if (v) return { ...v, name: groupName, group: groupName };
      break;
    }
    return {
      filename: editDraftModelFilename,
      quantization: extractQuantizationFromFilename(editDraftModelFilename),
      sizeBytes: 0,
      name: groupName,
      group: groupName,
    };
  })();

  const breadcrumb = buildBreadcrumb(currentPage);

  const systemPromptPreview = "Set the AI's behavior and personality";

  const activeExtGroups = extensionGroups.filter(({ toolKeys }) =>
    toolKeys.some((tk) => editTools.includes(tk)),
  );
  const toolsPreview =
    activeExtGroups.length > 0
      ? `${activeExtGroups.length} of ${extensionGroups.length} extensions enabled`
      : 'None enabled';

  const advancedPreview = `Temperature: ${editTemperature}, Top K: ${editTopK}, Top P: ${editTopP}`;

  const videoSettingsPreview =
    [
      editVideoFps ? `${editVideoFps} FPS` : '',
      editVideoUnlimitedMaxFrames
        ? 'Unlimited'
        : editVideoMaxFrames
          ? `Max ${editVideoMaxFrames} frames`
          : '',
      editVideoQuality ? `Quality ${editVideoQuality}` : '',
      editVideoWidth ? `${editVideoWidth}px` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'Default';

  const renderPage = () => {
    switch (currentPage) {
      case 'main':
        return (
          <MainPage
            editName={editName}
            setEditName={setEditName}
            editModel={editModelFilename}
            selectedModelDisplay={selectedModelDisplay}
            selectedProjectorDisplay={selectedProjectorDisplay}
            availableModelsForEdit={availableModelsForEdit}
            onOpenModelModal={() => setShowModelModal(true)}
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
            extensionGroups={extensionGroups}
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
            editGpuLayersAuto={editGpuLayersAuto}
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
            onSetGpuLayersAuto={setEditGpuLayersAuto}
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
            onNavigate={navigateTo}
            editSpecType={editSpecType}
            editDraftModelFilename={editDraftModelFilename}
            editCpuMoe={editCpuMoe}
            editNCpuMoe={editNCpuMoe}
          />
        );
      case 'moe-options':
        return (
          <MoeOptionsPage
            editCpuMoe={editCpuMoe}
            editNCpuMoe={editNCpuMoe}
            onSetCpuMoe={setEditCpuMoe}
            onSetNCpuMoe={setEditNCpuMoe}
          />
        );
      case 'cache-options':
        return (
          <CacheOptionsPage
            editKvOffload={editKvOffload}
            editCacheTypeK={editCacheTypeK}
            editCacheTypeV={editCacheTypeV}
            onSetKvOffload={setEditKvOffload}
            onSetCacheTypeK={setEditCacheTypeK}
            onSetCacheTypeV={setEditCacheTypeV}
            onEstimateMemory={handleEstimateMemory}
          />
        );
      case 'memory-options':
        return (
          <MemoryOptionsPage
            editMmap={editMmap}
            editMlock={editMlock}
            onSetMmap={setEditMmap}
            onSetMlock={setEditMlock}
          />
        );
      case 'draft-model':
        return (
          <DraftModelPage
            editSpecType={editSpecType}
            editDraftModelAuthor={editDraftModelAuthor}
            editDraftModelFolder={editDraftModelFolder}
            editDraftModelFilename={editDraftModelFilename}
            editSpecDraftNMax={editSpecDraftNMax}
            editSpecDraftNMin={editSpecDraftNMin}
            editSpecDraftPSplit={editSpecDraftPSplit}
            editSpecDraftPMin={editSpecDraftPMin}
            selectedDraftModelDisplay={selectedDraftModelDisplay}
            onSetSpecType={setEditSpecType}
            onSetDraftModelAuthor={setEditDraftModelAuthor}
            onSetDraftModelFolder={setEditDraftModelFolder}
            onSetDraftModelFilename={setEditDraftModelFilename}
            onSetSpecDraftNMax={setEditSpecDraftNMax}
            onSetSpecDraftNMin={setEditSpecDraftNMin}
            onSetSpecDraftPSplit={setEditSpecDraftPSplit}
            onSetSpecDraftPMin={setEditSpecDraftPMin}
            onOpenDraftModelModal={() => setShowDraftModelModal(true)}
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
      case 'projector':
        return (
          <ProjectorPage
            selectedProjectorDisplay={selectedProjectorDisplay}
            onOpenProjectorModal={() => setShowProjectorModal(true)}
            editProjector={editProjectorFilename}
            onNavigate={navigateTo}
            videoSettingsPreview={videoSettingsPreview}
          />
        );
      case 'video-settings':
        return (
          <VideoSettingsPage
            editVideoFps={editVideoFps}
            setEditVideoFps={setEditVideoFps}
            editVideoMaxFrames={editVideoMaxFrames}
            setEditVideoMaxFrames={setEditVideoMaxFrames}
            editVideoQuality={editVideoQuality}
            setEditVideoQuality={setEditVideoQuality}
            editVideoWidth={editVideoWidth}
            setEditVideoWidth={setEditVideoWidth}
            editVideoUnlimitedMaxFrames={editVideoUnlimitedMaxFrames}
            setEditVideoUnlimitedMaxFrames={setEditVideoUnlimitedMaxFrames}
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
            disabled={!editName.trim() || !editModelFilename}
          >
            Save
          </button>
        </div>
      </div>
      {/* Model/Projector selection modals */}
      {showModelModal && (
        <ModelSelectModal
          groups={modelSelectGroups}
          selectedFilename={editModelFilename}
          onSelect={(f, groupName) => {
            const parts = groupName.split('/');
            setEditModelAuthor(parts[0]);
            setEditModelFolder(parts.length >= 2 ? parts[1] : parts[0]);
            setEditModelFilename(f);
            setEditProjectorFilename('');
            setShowModelModal(false);
          }}
          onClose={() => setShowModelModal(false)}
        />
      )}
      {showProjectorModal && (
        <ProjectorSelectModal
          projectors={availableProjectorsForEdit}
          selectedFilename={editProjectorFilename}
          onSelect={(f) => {
            setEditProjectorFilename(f);
            setShowProjectorModal(false);
          }}
          onClose={() => setShowProjectorModal(false)}
        />
      )}
      {showDraftModelModal && (
        <ModelSelectModal
          groups={modelSelectGroups}
          selectedFilename={editDraftModelFilename}
          onSelect={(f, groupName) => {
            const parts = groupName.split('/');
            setEditDraftModelAuthor(parts[0]);
            setEditDraftModelFolder(parts.length >= 2 ? parts[1] : parts[0]);
            setEditDraftModelFilename(f);
            setShowDraftModelModal(false);
          }}
          onClose={() => setShowDraftModelModal(false)}
        />
      )}
    </div>
  );
}

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Trash2,
  GitBranch,
  GitBranchPlus,
  GitBranchMinus,
  Server,
  Bot,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  Maximize,
  Unlink,
  Play,
  Search,
  Link,
  Cpu,
  Database,
  Globe,
  Mail,
  FileText,
  Terminal,
  Code,
  Layers,
  Zap,
  Star,
  Heart,
  Shield,
  Lock,
  Key,
  Cloud,
  Camera,
  Mic,
  Music,
  Video,
  Image,
  Download,
  Upload,
  RefreshCw,
  Settings,
  Sliders,
  Filter,
  BarChart2,
  PieChart,
  TrendingUp,
  Activity,
  Wifi,
  Package,
  Box,
  Inbox,
  Send,
  MessageSquare,
  Bell,
  Flag,
  Bookmark,
  Tag,
  Hash,
  Scissors,
  Wrench,
  Hammer,
  Lightbulb,
  Target,
  Map,
  Compass,
  Clock,
  Calendar,
  Archive,
  Folder,
  Paperclip,
  Clipboard,
  Edit,
  Eye,
  EyeOff,
  User,
  Users,
  Home,
  Truck,
  Anchor,
  Hexagon,
  Circle,
  Square,
  type LucideIcon,
} from 'lucide-react';
import { Profile } from '../types/profile';
import '../styles/WorkflowsPage.css';

// ============================================================================
// ICON REGISTRY
// All values are validated at build-time — undefined entries are filtered out
// so the picker never receives an invalid component.
// ============================================================================

const ICON_REGISTRY_RAW: Record<string, LucideIcon | undefined> = {
  GitBranch,
  Server,
  Bot,
  Play,
  Cpu,
  Database,
  Globe,
  Mail,
  FileText,
  Terminal,
  Code,
  Layers,
  Zap,
  Star,
  Heart,
  Shield,
  Lock,
  Key,
  Cloud,
  Camera,
  Mic,
  Music,
  Video,
  Image,
  Download,
  Upload,
  RefreshCw,
  Settings,
  Sliders,
  Filter,
  BarChart2,
  PieChart,
  TrendingUp,
  Activity,
  Wifi,
  Package,
  Box,
  Inbox,
  Send,
  MessageSquare,
  Bell,
  Flag,
  Bookmark,
  Tag,
  Hash,
  Link,
  Scissors,
  Wrench,
  Hammer,
  Lightbulb,
  Target,
  Map,
  Compass,
  Clock,
  Calendar,
  Archive,
  Folder,
  Paperclip,
  Clipboard,
  Edit,
  Eye,
  EyeOff,
  User,
  Users,
  Home,
  Truck,
  Anchor,
  Hexagon,
  Circle,
  Square,
  Search,
  Plus,
  Trash2,
  Check,
  Pencil,
};

// Strip any entry that didn't resolve to a real component
const ICON_REGISTRY: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(ICON_REGISTRY_RAW).filter(
    (entry): entry is [string, LucideIcon] => typeof entry[1] === 'function',
  ),
);

const ICON_NAMES = Object.keys(ICON_REGISTRY).sort();

function resolveIcon(name: string | undefined): LucideIcon {
  if (name && ICON_REGISTRY[name]) return ICON_REGISTRY[name];
  return GitBranch;
}

// ============================================================================
// TYPES
// ============================================================================

export type NodeType = 'start' | 'server' | 'agent';

export interface StartData {
  input: string;
}
export interface ServerData {
  profileId: string | null;
  profile: Profile | null;
}
export interface AgentData {
  serverNodeId: string | null;
  prompt: string;
}
export type NodeData = StartData | ServerData | AgentData;

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  label: string;
  data: NodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  name: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const WORKFLOWS_KEY = 'workflows';
const NODE_WIDTH = 220;
const PORT_Y = 20; // from top of node — header centre
const BEZIER_OFFSET = 80;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.02;
const GRID_SIZE = 20;
const DRAG_THRESHOLD = 5; // px before a click becomes a drag
const DOT_SPACING = 24;
const MAX_HISTORY = 60;

const NODE_META: Record<
  NodeType,
  { label: string; icon: LucideIcon; colorVar: string }
> = {
  start: { label: 'Start', icon: Play, colorVar: 'var(--wf-start)' },
  server: { label: 'Server Start', icon: Server, colorVar: 'var(--wf-server)' },
  agent: { label: 'Agent', icon: Bot, colorVar: 'var(--wf-agent)' },
};

// ============================================================================
// STORAGE
// ============================================================================

function loadWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(WORKFLOWS_KEY);
    return raw ? (JSON.parse(raw) as Workflow[]) : [];
  } catch {
    return [];
  }
}

function persistWorkflows(wfs: Workflow[]): void {
  localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(wfs));
}

function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem('profiles');
    return raw
      ? (JSON.parse(raw) as Profile[]).sort((a, b) => a.order - b.order)
      : [];
  } catch {
    return [];
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function snap(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

function makeNode(type: NodeType, x: number, y: number): WorkflowNode {
  const base = {
    id: uid(),
    type,
    position: { x: snap(x), y: snap(y) },
    label: NODE_META[type].label,
  };
  if (type === 'start') return { ...base, data: { input: '' } as StartData };
  if (type === 'server')
    return { ...base, data: { profileId: null, profile: null } as ServerData };
  return { ...base, data: { serverNodeId: null, prompt: '' } as AgentData };
}

// ============================================================================
// ICON PICKER
// ============================================================================

interface IconPickerProps {
  current: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}

function IconPicker({ current, onSelect, onClose }: IconPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      query.trim()
        ? ICON_NAMES.filter((n) =>
            n.toLowerCase().includes(query.toLowerCase()),
          )
        : ICON_NAMES,
    [query],
  );

  return createPortal(
    <div className="wf-icon-picker-overlay" onClick={onClose}>
      <div className="wf-icon-picker" onClick={(e) => e.stopPropagation()}>
        <div className="wf-icon-picker__header">
          <span>Choose Icon</span>
          <button
            type="button"
            className="wf-icon-picker__close"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div className="wf-icon-picker__search-row">
          <Search size={13} className="wf-icon-picker__search-icon" />
          <input
            autoFocus
            className="wf-icon-picker__search"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="wf-icon-picker__grid">
          {filtered.map((name) => {
            const Ic = ICON_REGISTRY[name];
            // Guard: should never be undefined due to registry filtering, but be safe
            if (!Ic) return null;
            return (
              <button
                key={name}
                type="button"
                title={name}
                className={`wf-icon-picker__item ${current === name ? 'wf-icon-picker__item--active' : ''}`}
                onClick={() => {
                  onSelect(name);
                  onClose();
                }}
              >
                <Ic size={17} />
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================
// WORKFLOW GRID PAGE
// ============================================================================

interface WorkflowGridProps {
  workflows: Workflow[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onIconChange: (id: string, icon: string) => void;
}

function WorkflowGrid({
  workflows,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onIconChange,
}: WorkflowGridProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);

  const startRename = (wf: Workflow, e: ReactMouseEvent) => {
    e.stopPropagation();
    setRenamingId(wf.id);
    setRenameValue(wf.name);
  };

  const commitRename = (id: string) => {
    if (renameValue.trim()) onRename(id, renameValue.trim());
    setRenamingId(null);
  };

  const pickerWorkflow = workflows.find((w) => w.id === iconPickerId);

  return (
    <div className="wf-grid-page">
      <div className="wf-grid-header">
        <div className="wf-grid-header__text">
          <h1>Workflows</h1>
          <p>Build agent pipelines using a visual node editor.</p>
        </div>
        <button
          type="button"
          className="btn-accent wf-new-btn"
          onClick={onCreate}
        >
          <GitBranchPlus size={16} />
          New Workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="wf-empty">
          <GitBranch size={48} className="wf-empty__icon" />
          <h2>No workflows yet</h2>
          <p>Create your first workflow to start building agent pipelines.</p>
          <button type="button" className="btn-accent" onClick={onCreate}>
            <GitBranchPlus size={16} />
            New Workflow
          </button>
        </div>
      ) : (
        <div className="wf-grid">
          {workflows.map((wf) => {
            const WfIcon = resolveIcon(wf.icon);
            return (
              <div
                key={wf.id}
                className="wf-card"
                onClick={() => renamingId !== wf.id && onOpen(wf.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renamingId !== wf.id) onOpen(wf.id);
                }}
              >
                <div className="wf-card__top">
                  <button
                    type="button"
                    className="wf-card__icon-wrap"
                    title="Change icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIconPickerId(wf.id);
                    }}
                  >
                    <WfIcon size={20} />
                  </button>
                  <div
                    className="wf-card__actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="wf-card__icon-btn"
                      title="Rename"
                      onClick={(e) => startRename(wf, e)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="wf-card__icon-btn wf-card__icon-btn--danger"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(wf.id);
                      }}
                    >
                      <GitBranchMinus size={13} />
                    </button>
                  </div>
                </div>

                <div className="wf-card__body">
                  {renamingId === wf.id ? (
                    <div
                      className="wf-card__rename"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        className="wf-card__rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(wf.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                      />
                      <button
                        type="button"
                        className="wf-card__rename-confirm"
                        onClick={() => commitRename(wf.id)}
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className="wf-card__rename-cancel"
                        onClick={() => setRenamingId(null)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <h3 className="wf-card__name">{wf.name}</h3>
                  )}
                  <div className="wf-card__meta">
                    <span className="wf-card__meta-item">
                      <GitBranch size={12} />
                      {wf.nodes.length} node{wf.nodes.length !== 1 ? 's' : ''}
                    </span>
                    <span className="wf-card__meta-item">
                      <Link size={12} />
                      {wf.edges.length} edge{wf.edges.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="wf-card__date">
                    Updated{' '}
                    {new Date(wf.updatedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {iconPickerId && pickerWorkflow && (
        <IconPicker
          current={pickerWorkflow.icon}
          onSelect={(name) => onIconChange(iconPickerId, name)}
          onClose={() => setIconPickerId(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// NODE CONFIG PANEL
// ============================================================================

interface NodeConfigPanelProps {
  node: WorkflowNode;
  allNodes: WorkflowNode[];
  profiles: Profile[];
  onChange: (id: string, patch: Partial<WorkflowNode>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function NodeConfigPanel({
  node,
  allNodes,
  profiles,
  onChange,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const meta = NODE_META[node.type];
  const Icon = meta.icon;

  const patchData = (dataPatch: Partial<NodeData>) =>
    onChange(node.id, { data: { ...node.data, ...dataPatch } as NodeData });

  const serverNodes = allNodes.filter((n) => n.type === 'server');

  const profileName = (id: string | null) =>
    id ? (profiles.find((p) => p.id === id)?.name ?? null) : null;

  return (
    <div className="wf-config-panel">
      <div className="wf-config-panel__header">
        <div className="wf-config-panel__title">
          <div
            className="wf-config-panel__icon"
            style={{ background: meta.colorVar }}
          >
            <Icon size={14} />
          </div>
          <span>{meta.label}</span>
        </div>
        <button
          type="button"
          className="wf-config-panel__close"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      <div className="wf-config-panel__body">
        {/* Label */}
        <div className="wf-config-field">
          <label className="wf-config-field__label">Label</label>
          <input
            className="wf-config-field__input"
            value={node.label}
            onChange={(e) => onChange(node.id, { label: e.target.value })}
            placeholder="Node label…"
          />
        </div>

        {/* START */}
        {node.type === 'start' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Initial Input{' '}
              <span className="wf-config-field__optional">(optional)</span>
            </label>
            <textarea
              className="wf-config-field__textarea"
              rows={4}
              value={(node.data as StartData).input}
              onChange={(e) => patchData({ input: e.target.value })}
              placeholder="Optional string passed into the workflow…"
            />
            <small className="wf-config-field__hint">
              Leave empty to receive input at runtime.
            </small>
          </div>
        )}

        {/* SERVER */}
        {node.type === 'server' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">Profile</label>
            {profiles.length === 0 ? (
              <p className="wf-config-field__empty">
                No profiles found. Create one in the Profiles page.
              </p>
            ) : (
              <select
                className="wf-config-field__select"
                value={(node.data as ServerData).profileId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  patchData({
                    profileId: id,
                    profile: profiles.find((p) => p.id === id) ?? null,
                  } as Partial<ServerData>);
                }}
              >
                <option value="">Select a profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {(node.data as ServerData).profileId && (
              <div className="wf-config-field__badge">
                <Server size={11} />
                {profileName((node.data as ServerData).profileId)}
              </div>
            )}
          </div>
        )}

        {/* AGENT */}
        {node.type === 'agent' && (
          <>
            <div className="wf-config-field">
              <label className="wf-config-field__label">Server Node</label>
              {serverNodes.length === 0 ? (
                <p className="wf-config-field__empty">
                  Add a Server Start node first.
                </p>
              ) : (
                <select
                  className="wf-config-field__select"
                  value={(node.data as AgentData).serverNodeId ?? ''}
                  onChange={(e) =>
                    patchData({
                      serverNodeId: e.target.value || null,
                    } as Partial<AgentData>)
                  }
                >
                  <option value="">Select a server node…</option>
                  {serverNodes.map((sn) => {
                    const pn = profileName((sn.data as ServerData).profileId);
                    return (
                      <option key={sn.id} value={sn.id}>
                        {sn.label}
                        {pn ? ` — ${pn}` : ' (no profile)'}
                      </option>
                    );
                  })}
                </select>
              )}
              {(node.data as AgentData).serverNodeId &&
                (() => {
                  const sn = serverNodes.find(
                    (n) => n.id === (node.data as AgentData).serverNodeId,
                  );
                  const pn = sn
                    ? profileName((sn.data as ServerData).profileId)
                    : null;
                  return (
                    <div className="wf-config-field__badge">
                      <Server size={11} />
                      {sn?.label}
                      {pn ? ` — ${pn}` : ''}
                    </div>
                  );
                })()}
            </div>
            <div className="wf-config-field">
              <label className="wf-config-field__label">Prompt</label>
              <textarea
                className="wf-config-field__textarea"
                rows={5}
                value={(node.data as AgentData).prompt}
                onChange={(e) =>
                  patchData({ prompt: e.target.value } as Partial<AgentData>)
                }
                placeholder="The text prompt sent to this agent…"
              />
            </div>
          </>
        )}
      </div>

      <div className="wf-config-panel__footer">
        <button
          type="button"
          className="wf-config-panel__delete"
          onClick={() => onDelete(node.id)}
        >
          <Trash2 size={13} />
          Delete Node
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// NODE PALETTE
// ============================================================================

interface NodePaletteProps {
  onDragStart: (e: React.DragEvent, type: NodeType) => void;
}

function NodePalette({ onDragStart }: NodePaletteProps) {
  const NODE_HINTS: Record<NodeType, string> = {
    start: 'Entry point for the workflow',
    server: 'Binds a profile / model',
    agent: 'Runs a prompt on a server',
  };

  return (
    <div className="wf-palette">
      <div className="wf-palette__header">Nodes</div>
      {(
        Object.entries(NODE_META) as [NodeType, (typeof NODE_META)[NodeType]][]
      ).map(([type, meta]) => {
        const Icon = meta.icon;
        return (
          <div
            key={type}
            className="wf-palette__item"
            style={{ '--node-color': meta.colorVar } as React.CSSProperties}
            draggable
            onDragStart={(e) => onDragStart(e, type)}
          >
            <div className="wf-palette__item-icon">
              <Icon size={14} />
            </div>
            <div className="wf-palette__item-text">
              <span className="wf-palette__item-label">{meta.label}</span>
              <span className="wf-palette__item-hint">{NODE_HINTS[type]}</span>
            </div>
          </div>
        );
      })}
      <div className="wf-palette__tip">
        <Unlink size={11} />
        Drag onto the canvas
      </div>
    </div>
  );
}

// ============================================================================
// CANVAS NODE
// ============================================================================

interface CanvasNodeProps {
  node: WorkflowNode;
  isSelected: boolean;
  isConnectingTarget: boolean;
  profiles: Profile[];
  onMouseDown: (e: ReactMouseEvent, id: string) => void;
  onOutputPortMouseDown: (e: ReactMouseEvent, id: string) => void;
  onInputPortMouseUp: (e: ReactMouseEvent, id: string) => void;
  onInputPortClick: (e: ReactMouseEvent, id: string) => void;
}

function CanvasNode({
  node,
  isSelected,
  isConnectingTarget,
  profiles,
  onMouseDown,
  onOutputPortMouseDown,
  onInputPortMouseUp,
  onInputPortClick,
}: CanvasNodeProps) {
  const meta = NODE_META[node.type];
  const Icon = meta.icon;

  const profileName =
    node.type === 'server'
      ? profiles.find((p) => p.id === (node.data as ServerData).profileId)?.name
      : null;

  const hasWarning =
    (node.type === 'server' && !(node.data as ServerData).profileId) ||
    (node.type === 'agent' && !(node.data as AgentData).serverNodeId);

  const hasInput = node.type !== 'start';

  return (
    <div
      className={[
        'wf-node',
        `wf-node--${node.type}`,
        isSelected ? 'wf-node--selected' : '',
        isConnectingTarget ? 'wf-node--connecting-target' : '',
      ].join(' ')}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: NODE_WIDTH,
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('.wf-node__port')) return;
        onMouseDown(e, node.id);
      }}
    >
      {/* Input port */}
      {hasInput && (
        <div
          className="wf-node__port wf-node__port--input"
          style={{ top: PORT_Y }}
          onMouseUp={(e) => onInputPortMouseUp(e, node.id)}
          onClick={(e) => onInputPortClick(e, node.id)}
          title="Input"
        />
      )}

      {/* Header */}
      <div
        className="wf-node__header"
        style={{ '--node-color': meta.colorVar } as React.CSSProperties}
      >
        <div className="wf-node__header-icon">
          <Icon size={13} />
        </div>
        <span className="wf-node__header-label">{node.label}</span>
        {hasWarning && (
          <span className="wf-node__warning" title="Configuration incomplete" />
        )}
      </div>

      {/* Body */}
      <div className="wf-node__body">
        {node.type === 'start' && (
          <span className="wf-node__preview">
            {(node.data as StartData).input
              ? `"${(node.data as StartData).input.slice(0, 44)}${(node.data as StartData).input.length > 44 ? '…' : ''}"`
              : 'No initial input'}
          </span>
        )}
        {node.type === 'server' && (
          <span
            className={`wf-node__preview ${!profileName ? 'wf-node__preview--empty' : ''}`}
          >
            {profileName ?? 'No profile selected'}
          </span>
        )}
        {node.type === 'agent' && (
          <>
            <span
              className={`wf-node__preview ${!(node.data as AgentData).serverNodeId ? 'wf-node__preview--empty' : ''}`}
            >
              {(node.data as AgentData).serverNodeId
                ? 'Server assigned'
                : 'No server assigned'}
            </span>
            {(node.data as AgentData).prompt && (
              <span className="wf-node__preview wf-node__preview--prompt">
                {(node.data as AgentData).prompt.slice(0, 52)}
                {(node.data as AgentData).prompt.length > 52 ? '…' : ''}
              </span>
            )}
          </>
        )}
      </div>

      {/* Output port */}
      <div
        className="wf-node__port wf-node__port--output"
        style={{ top: PORT_Y }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onOutputPortMouseDown(e, node.id);
        }}
        title="Drag to connect"
      />
    </div>
  );
}

// ============================================================================
// HISTORY HELPERS
// ============================================================================

interface HistoryEntry {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ============================================================================
// WORKFLOW EDITOR  (rendered via portal)
// ============================================================================

interface WorkflowEditorProps {
  workflow: Workflow;
  profiles: Profile[];
  onChange: (updated: Workflow) => void;
  onBack: () => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}
interface DragState {
  nodeId: string;
  startMouse: { x: number; y: number };
  startPos: { x: number; y: number };
  didMove: boolean;
}
interface PanState {
  startMouse: { x: number; y: number };
  startTransform: { x: number; y: number };
}
interface ConnectState {
  sourceId: string;
  mouseCanvas: { x: number; y: number };
}

function WorkflowEditor({
  workflow,
  profiles,
  onChange,
  onBack,
}: WorkflowEditorProps) {
  const [nodes, setNodes] = useState<WorkflowNode[]>(workflow.nodes);
  const [edges, setEdges] = useState<WorkflowEdge[]>(workflow.edges);
  const [transform, setTransform] = useState<Transform>({
    x: 80,
    y: 80,
    scale: 1,
  });
  // panOffset drives the dot-grid background — only updated during panning, not zooming
  const [panOffset, setPanOffset] = useState({ x: 80, y: 80 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [panning, setPanning] = useState<PanState | null>(null);
  const [connecting, setConnecting] = useState<ConnectState | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo history — stored in a ref so push/pop never cause renders
  const history = useRef<HistoryEntry[]>([
    { nodes: workflow.nodes, edges: workflow.edges },
  ]);
  const historyIdx = useRef(0);

  // ── History push (call after every committed change) ──────────────────────
  const pushHistory = useCallback((n: WorkflowNode[], e: WorkflowEdge[]) => {
    // Truncate any future entries when a new action happens after undo
    history.current = history.current.slice(0, historyIdx.current + 1);
    history.current.push({ nodes: n, edges: e });
    if (history.current.length > MAX_HISTORY) history.current.shift();
    historyIdx.current = history.current.length - 1;
  }, []);

  // ── Auto-save (debounced 400 ms) ──────────────────────────────────────────
  const triggerSave = useCallback(
    (n: WorkflowNode[], e: WorkflowEdge[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () =>
          onChange({ ...workflow, nodes: n, edges: e, updatedAt: Date.now() }),
        400,
      );
    },
    [onChange, workflow],
  );

  // Every committed mutation goes through these two helpers
  const commitNodes = useCallback(
    (n: WorkflowNode[], pushHist = true) => {
      setNodes(n);
      triggerSave(n, edges);
      if (pushHist) pushHistory(n, edges);
    },
    [edges, triggerSave, pushHistory],
  );

  const commitEdges = useCallback(
    (e: WorkflowEdge[], pushHist = true) => {
      setEdges(e);
      triggerSave(nodes, e);
      if (pushHist) pushHistory(nodes, e);
    },
    [nodes, triggerSave, pushHistory],
  );

  // ── Coordinate helper ─────────────────────────────────────────────────────
  const screenToCanvas = useCallback(
    (sx: number, sy: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return {
        x: (sx - rect.left - transform.x) / transform.scale,
        y: (sy - rect.top - transform.y) / transform.scale,
      };
    },
    [transform],
  );

  // ── Keyboard: Delete / Backspace / Ctrl+Z / Escape ────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Ctrl+Z / Cmd+Z  — works even inside fields
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (historyIdx.current > 0) {
          historyIdx.current -= 1;
          const entry = history.current[historyIdx.current];
          setNodes(entry.nodes);
          setEdges(entry.edges);
          triggerSave(entry.nodes, entry.edges);
        }
        return;
      }

      if (inField) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedNodeId) {
          setNodes((prev) => {
            const next = prev
              .filter((n) => n.id !== selectedNodeId)
              .map((n) =>
                n.type === 'agent' &&
                (n.data as AgentData).serverNodeId === selectedNodeId
                  ? {
                      ...n,
                      data: { ...(n.data as AgentData), serverNodeId: null },
                    }
                  : n,
              );
            const nextEdges = edges.filter(
              (ed) =>
                ed.source !== selectedNodeId && ed.target !== selectedNodeId,
            );
            setEdges(nextEdges);
            pushHistory(next, nextEdges);
            triggerSave(next, nextEdges);
            return next;
          });
          setSelectedNodeId(null);
        } else if (selectedEdgeId) {
          setEdges((prev) => {
            const next = prev.filter((ed) => ed.id !== selectedEdgeId);
            pushHistory(nodes, next);
            triggerSave(nodes, next);
            return next;
          });
          setSelectedEdgeId(null);
        }
      }

      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectedEdgeId, edges, nodes, pushHistory, triggerSave]);

  // ── Pan ───────────────────────────────────────────────────────────────────
  const onCanvasMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.wf-node, .wf-node__port')) return;
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPanning({
      startMouse: { x: e.clientX, y: e.clientY },
      startTransform: { x: transform.x, y: transform.y },
    });
  };

  useEffect(() => {
    if (!panning) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - panning.startMouse.x;
      const dy = e.clientY - panning.startMouse.y;
      const nx = panning.startTransform.x + dx;
      const ny = panning.startTransform.y + dy;
      setTransform((p) => ({ ...p, x: nx, y: ny }));
      // dot grid moves with pan only
      setPanOffset({ x: nx, y: ny });
    };
    const onUp = () => setPanning(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panning]);

  // ── Zoom (panOffset unchanged — dots stay still) ──────────────────────────
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setTransform((prev) => {
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale + delta));
      const r = ns / prev.scale;
      // Zoom toward cursor, but do NOT update panOffset — dots stay fixed
      return {
        scale: ns,
        x: mx - r * (mx - prev.x),
        y: my - r * (my - prev.y),
      };
    });
  };

  const zoomIn = () =>
    setTransform((p) => ({
      ...p,
      scale: Math.min(MAX_ZOOM, p.scale + ZOOM_STEP),
    }));
  const zoomOut = () =>
    setTransform((p) => ({
      ...p,
      scale: Math.max(MIN_ZOOM, p.scale - ZOOM_STEP),
    }));
  const fitView = () => {
    if (nodes.length === 0) {
      setTransform({ x: 80, y: 80, scale: 1 });
      setPanOffset({ x: 80, y: 80 });
      return;
    }
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + NODE_WIDTH;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + 100;
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min(
          rect.width / (maxX - minX + 160),
          rect.height / (maxY - minY + 160),
        ),
      ),
    );
    const nx = (rect.width - (maxX + minX) * s) / 2;
    const ny = (rect.height - (maxY + minY) * s) / 2;
    setTransform({ scale: s, x: nx, y: ny });
    setPanOffset({ x: nx, y: ny });
  };

  // ── Node drag ─────────────────────────────────────────────────────────────
  const onNodeMouseDown = (e: ReactMouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const node = nodes.find((n) => n.id === nodeId)!;
    setDragging({
      nodeId,
      startMouse: { x: e.clientX, y: e.clientY },
      startPos: { ...node.position },
      didMove: false,
    });
    setSelectedEdgeId(null);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startMouse.x;
      const dy = e.clientY - dragging.startMouse.y;
      const didMove = Math.hypot(dx, dy) > DRAG_THRESHOLD;
      if (didMove) {
        setDragging((prev) => (prev ? { ...prev, didMove: true } : null));
        setNodes((prev) =>
          prev.map((n) =>
            n.id === dragging.nodeId
              ? {
                  ...n,
                  position: {
                    x: snap(dragging.startPos.x + dx / transform.scale),
                    y: snap(dragging.startPos.y + dy / transform.scale),
                  },
                }
              : n,
          ),
        );
      }
    };
    const onUp = () => {
      setDragging((prev) => {
        if (!prev) return null;
        if (!prev.didMove) {
          // Pure click — open config panel
          setSelectedNodeId(prev.nodeId);
        } else {
          // Drag ended — commit position to history
          setNodes((current) => {
            pushHistory(current, edges);
            triggerSave(current, edges);
            return current;
          });
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, transform.scale]);

  // ── Connecting ────────────────────────────────────────────────────────────
  const onOutputPortMouseDown = (e: ReactMouseEvent, sourceId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setConnecting({
      sourceId,
      mouseCanvas: screenToCanvas(e.clientX, e.clientY),
    });
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
  };

  const onInputPortMouseUp = (e: ReactMouseEvent, targetId: string) => {
    if (!connecting) return;
    e.stopPropagation();
    const src = connecting.sourceId;
    setConnecting(null);
    if (src === targetId) return;
    if (edges.some((ed) => ed.source === src && ed.target === targetId)) return;
    commitEdges([...edges, { id: uid(), source: src, target: targetId }]);
  };

  // Clicking an input port selects the inbound edge (for easy deletion)
  const onInputPortClick = (e: ReactMouseEvent, targetId: string) => {
    e.stopPropagation();
    if (connecting) return;
    const inbound = edges.filter((ed) => ed.target === targetId);
    if (inbound.length === 0) return;
    const currentIdx = inbound.findIndex((ed) => ed.id === selectedEdgeId);
    const next = inbound[(currentIdx + 1) % inbound.length];
    setSelectedEdgeId(next.id);
    setSelectedNodeId(null);
  };

  useEffect(() => {
    if (!connecting) return;
    const onMove = (e: MouseEvent) =>
      setConnecting((prev) =>
        prev
          ? { ...prev, mouseCanvas: screenToCanvas(e.clientX, e.clientY) }
          : null,
      );
    const onUp = () => setConnecting(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [connecting, screenToCanvas]);

  // ── Palette drag-drop onto canvas ─────────────────────────────────────────
  const onPaletteDragStart = (e: React.DragEvent, type: NodeType) => {
    e.dataTransfer.setData('nodeType', type);
  };

  const onCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('nodeType') as NodeType;
    if (!type || !NODE_META[type]) return;
    const pos = screenToCanvas(e.clientX, e.clientY);
    const node = makeNode(type, pos.x - NODE_WIDTH / 2, pos.y - 30);
    commitNodes([...nodes, node]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  };

  // ── Delete helpers ────────────────────────────────────────────────────────
  const deleteNode = useCallback(
    (id: string) => {
      const nextNodes = nodes
        .filter((n) => n.id !== id)
        .map((n) =>
          n.type === 'agent' && (n.data as AgentData).serverNodeId === id
            ? { ...n, data: { ...(n.data as AgentData), serverNodeId: null } }
            : n,
        );
      const nextEdges = edges.filter(
        (ed) => ed.source !== id && ed.target !== id,
      );
      setNodes(nextNodes);
      setEdges(nextEdges);
      pushHistory(nextNodes, nextEdges);
      triggerSave(nextNodes, nextEdges);
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [nodes, edges, selectedNodeId, pushHistory, triggerSave],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      commitEdges(edges.filter((e) => e.id !== id));
      if (selectedEdgeId === id) setSelectedEdgeId(null);
    },
    [edges, selectedEdgeId, commitEdges],
  );

  const patchNode = useCallback(
    (id: string, patch: Partial<WorkflowNode>) => {
      commitNodes(nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    },
    [nodes, commitNodes],
  );

  // ── Port positions in canvas space ────────────────────────────────────────
  const portPos = (nodeId: string, side: 'input' | 'output') => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    return {
      x: node.position.x + (side === 'output' ? NODE_WIDTH : 0),
      y: node.position.y + PORT_Y,
    };
  };

  const edgePath = (sx: number, sy: number, tx: number, ty: number) =>
    `M ${sx} ${sy} C ${sx + BEZIER_OFFSET} ${sy}, ${tx - BEZIER_OFFSET} ${ty}, ${tx} ${ty}`;

  // ── Background dot offset — only pan, not zoom ────────────────────────────
  const dotBgX = ((panOffset.x % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
  const dotBgY = ((panOffset.y % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const editor = (
    <div className="wf-portal">
      {/* ── Toolbar ── */}
      <div className="wf-toolbar">
        <button type="button" className="wf-toolbar__back" onClick={onBack}>
          <ChevronLeft size={15} />
          Workflows
        </button>
        <span className="wf-toolbar__name">{workflow.name}</span>

        <div className="wf-toolbar__zoom-group">
          <button
            type="button"
            className="wf-toolbar__zoom-btn"
            onClick={zoomOut}
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <span className="wf-toolbar__zoom-label">
            {Math.round(transform.scale * 100)}%
          </span>
          <button
            type="button"
            className="wf-toolbar__zoom-btn"
            onClick={zoomIn}
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="wf-toolbar__zoom-btn"
            onClick={fitView}
            title="Fit view"
          >
            <Maximize size={13} />
          </button>
        </div>

        {/* Inline action bar when edge or node is selected */}
        {(selectedEdgeId || selectedNode) && (
          <div className="wf-toolbar__sel-bar">
            <span className="wf-toolbar__sel-label">
              {selectedEdgeId ? 'Edge selected' : selectedNode?.label}
            </span>
            <button
              type="button"
              className="wf-toolbar__sel-delete"
              onClick={() => {
                if (selectedEdgeId) {
                  deleteEdge(selectedEdgeId);
                } else if (selectedNode) {
                  deleteNode(selectedNode.id);
                }
              }}
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="wf-editor__body">
        {/* Left palette */}
        <NodePalette onDragStart={onPaletteDragStart} />

        {/* Canvas */}
        <div
          ref={canvasRef}
          className={[
            'wf-canvas',
            panning ? 'wf-canvas--panning' : '',
            connecting ? 'wf-canvas--connecting' : '',
          ].join(' ')}
          style={{ backgroundPosition: `${dotBgX}px ${dotBgY}px` }}
          onMouseDown={onCanvasMouseDown}
          onWheel={onWheel}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          <div
            className="wf-canvas__inner"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            }}
          >
            {/* SVG edge layer */}
            <svg className="wf-canvas__svg" overflow="visible">
              <defs>
                <marker
                  id="wf-arrow"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" className="wf-edge__arrow" />
                </marker>
                <marker
                  id="wf-arrow-hover"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 8 3, 0 6"
                    className="wf-edge__arrow wf-edge__arrow--hover"
                  />
                </marker>
                <marker
                  id="wf-arrow-selected"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 8 3, 0 6"
                    className="wf-edge__arrow wf-edge__arrow--selected"
                  />
                </marker>
              </defs>

              {edges.map((edge) => {
                const s = portPos(edge.source, 'output');
                const t = portPos(edge.target, 'input');
                const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
                const isH = hoveredEdgeId === edge.id;
                const isS = selectedEdgeId === edge.id;
                const marker = isS
                  ? 'url(#wf-arrow-selected)'
                  : isH
                    ? 'url(#wf-arrow-hover)'
                    : 'url(#wf-arrow)';

                const selectEdge = (ev: ReactMouseEvent) => {
                  ev.stopPropagation();
                  setSelectedEdgeId(isS ? null : edge.id);
                  setSelectedNodeId(null);
                };

                return (
                  <g key={edge.id}>
                    {/* Wide invisible hit area along the curve */}
                    <path
                      d={edgePath(s.x, s.y, t.x, t.y)}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredEdgeId(edge.id)}
                      onMouseLeave={() => setHoveredEdgeId(null)}
                      onClick={selectEdge}
                    />
                    {/* Visible edge */}
                    <path
                      d={edgePath(s.x, s.y, t.x, t.y)}
                      fill="none"
                      className={`wf-edge ${isS ? 'wf-edge--selected' : isH ? 'wf-edge--hovered' : ''}`}
                      markerEnd={marker}
                      style={{ pointerEvents: 'none' }}
                    />

                    {/* ── Endpoint hit circles ─────────────────────────── */}
                    {/* Source end */}
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={7}
                      className={`wf-edge__endpoint ${isS || isH ? 'wf-edge__endpoint--visible' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredEdgeId(edge.id)}
                      onMouseLeave={() => setHoveredEdgeId(null)}
                      onClick={selectEdge}
                    />
                    {/* Target end */}
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r={7}
                      className={`wf-edge__endpoint ${isS || isH ? 'wf-edge__endpoint--visible' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredEdgeId(edge.id)}
                      onMouseLeave={() => setHoveredEdgeId(null)}
                      onClick={selectEdge}
                    />
                    {/* Midpoint delete button (shown on hover/select) */}
                    {(isH || isS) && (
                      <g
                        style={{ cursor: 'pointer' }}
                        onClick={selectEdge}
                        onMouseEnter={() => setHoveredEdgeId(edge.id)}
                        onMouseLeave={() => setHoveredEdgeId(null)}
                      >
                        <circle
                          cx={mid.x}
                          cy={mid.y}
                          r={9}
                          className="wf-edge__mid-circle"
                        />
                        <line
                          x1={mid.x - 3.5}
                          y1={mid.y - 3.5}
                          x2={mid.x + 3.5}
                          y2={mid.y + 3.5}
                          className="wf-edge__mid-cross"
                        />
                        <line
                          x1={mid.x + 3.5}
                          y1={mid.y - 3.5}
                          x2={mid.x - 3.5}
                          y2={mid.y + 3.5}
                          className="wf-edge__mid-cross"
                        />
                      </g>
                    )}
                  </g>
                );
              })}

              {/* In-progress wire */}
              {connecting &&
                (() => {
                  const s = portPos(connecting.sourceId, 'output');
                  const t = connecting.mouseCanvas;
                  return (
                    <path
                      d={edgePath(s.x, s.y, t.x, t.y)}
                      fill="none"
                      className="wf-edge wf-edge--connecting"
                      strokeDasharray="6 4"
                    />
                  );
                })()}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                isConnectingTarget={
                  !!connecting &&
                  connecting.sourceId !== node.id &&
                  node.type !== 'start'
                }
                profiles={profiles}
                onMouseDown={onNodeMouseDown}
                onOutputPortMouseDown={onOutputPortMouseDown}
                onInputPortMouseUp={onInputPortMouseUp}
                onInputPortClick={onInputPortClick}
              />
            ))}
          </div>

          {nodes.length === 0 && (
            <div className="wf-canvas__empty">
              <GitBranch size={34} className="wf-canvas__empty-icon" />
              <p>Drag a node from the left panel to get started.</p>
            </div>
          )}
        </div>

        {/* Right: config panel when a node is selected */}
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            allNodes={nodes}
            profiles={profiles}
            onChange={patchNode}
            onDelete={deleteNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      {/* Hint bar */}
      <div className="wf-hint">
        <kbd>Del</kbd> delete selected
        <span className="wf-hint__sep" />
        <kbd>Ctrl Z</kbd> undo
        <span className="wf-hint__sep" />
        Click edge or its endpoints to select
      </div>
    </div>
  );

  return createPortal(editor, document.body);
}

// ============================================================================
// ROOT PAGE
// ============================================================================

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>(loadWorkflows);
  const [openId, setOpenId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles);

  useEffect(() => {
    const sync = () => setProfiles(loadProfiles());
    window.addEventListener('profiles-changed', sync);
    window.addEventListener('profiles-updated', sync);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) sync();
    });
    return () => {
      window.removeEventListener('profiles-changed', sync);
      window.removeEventListener('profiles-updated', sync);
    };
  }, []);

  const saveAll = (updated: Workflow[]) => {
    setWorkflows(updated);
    persistWorkflows(updated);
  };

  const handleCreate = () => {
    const wf: Workflow = {
      id: uid(),
      name: 'Untitled Workflow',
      icon: 'GitBranch',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [],
      edges: [],
    };
    const updated = [wf, ...workflows];
    saveAll(updated);
    setOpenId(wf.id);
  };

  const handleDelete = (id: string) =>
    saveAll(workflows.filter((w) => w.id !== id));
  const handleRename = (id: string, name: string) =>
    saveAll(
      workflows.map((w) =>
        w.id === id ? { ...w, name, updatedAt: Date.now() } : w,
      ),
    );
  const handleIconChange = (id: string, icon: string) =>
    saveAll(
      workflows.map((w) =>
        w.id === id ? { ...w, icon, updatedAt: Date.now() } : w,
      ),
    );
  const handleChange = (updated: Workflow) =>
    saveAll(workflows.map((w) => (w.id === updated.id ? updated : w)));

  const openWorkflow = workflows.find((w) => w.id === openId);

  return (
    <>
      <WorkflowGrid
        workflows={workflows}
        onOpen={setOpenId}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={handleRename}
        onIconChange={handleIconChange}
      />
      {openId && openWorkflow && (
        <WorkflowEditor
          workflow={openWorkflow}
          profiles={profiles}
          onChange={handleChange}
          onBack={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/**
 * src/renderer/pages/WorkflowsPage.tsx
 *
 * Full-featured workflow editor with:
 * - Typed ports (continue | profile | server | text)
 * - Strict connection enforcement (incompatible drop → delete)
 * - Compatible-node highlight while dragging
 * - Edge tail drag/reconnect (delete original, re-attach or drop)
 * - Selected edge rendered on top (second SVG pass)
 * - Snap highlight (green) when hovering valid drop target during reconnect
 * - Palette categories: Start / Models
 * - Profile block (pure data provider, no sequencing)
 * - Text block (pure data provider, optional config value)
 * - Input Text block (continue+text in, continue+text out)
 * - Server block (continue+profile in, continue+server out)
 * - Agent block (continue+server+text in, text out)
 * - Start block (continue out, no config)
 * - Inline workflow name editing
 * - Ctrl+A select all nodes
 * - Delete confirmation dialog
 * - Ctrl+Z undo
 * - panOffset separate from zoom (dots fixed on zoom)
 * - Portal (position:fixed) for editor
 * - IconPicker as separate component
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
  Link,
  Type,
  SlidersHorizontal,
  AlertTriangle,
  TextCursor,
} from 'lucide-react';
import IconPicker, { resolveIcon } from '../components/workflows/IconPicker';
import { Profile } from '../types/profile';
import '../styles/WorkflowsPage.css';

// ============================================================================
// PORT TYPES
// ============================================================================

export type PortType = 'continue' | 'profile' | 'server' | 'text';

function portsCompatible(output: PortType, input: PortType): boolean {
  return output === input;
}

// ============================================================================
// NODE TYPES
// ============================================================================

export type NodeType =
  | 'start'
  | 'profile'
  | 'text-data'
  | 'server'
  | 'input-text'
  | 'agent';

// Each port definition on a node
export interface PortDef {
  id: string; // unique within the node, e.g. "out-continue"
  label: string;
  type: PortType;
  side: 'input' | 'output';
}

// Port definitions per node type
const NODE_PORTS: Record<NodeType, PortDef[]> = {
  start: [
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
  ],
  profile: [
    { id: 'out-profile', label: 'profile', type: 'profile', side: 'output' },
  ],
  'text-data': [
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
  ],
  server: [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-profile', label: 'profile', type: 'profile', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-server', label: 'server', type: 'server', side: 'output' },
  ],
  'input-text': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-text', label: 'question', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
  ],
  agent: [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-server', label: 'server', type: 'server', side: 'input' },
    { id: 'in-text', label: 'prompt', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
  ],
};

// Colour per port type
const PORT_TYPE_COLOR: Record<PortType, string> = {
  continue: 'var(--wf-continue)',
  profile: 'var(--wf-profile)',
  server: 'var(--wf-server)',
  text: 'var(--wf-text)',
};

// ============================================================================
// NODE DATA TYPES
// ============================================================================

export interface StartData {
  _type: 'start';
}
export interface ProfileData {
  _type: 'profile';
  profileId: string | null;
}
export interface TextDataData {
  _type: 'text-data';
  value: string;
}
export interface ServerData {
  _type: 'server';
  profileId: string | null;
}
export interface InputTextData {
  _type: 'input-text';
  question: string;
}
export interface AgentData {
  _type: 'agent';
  prompt: string;
}

export type NodeData =
  | StartData
  | ProfileData
  | TextDataData
  | ServerData
  | InputTextData
  | AgentData;

// ============================================================================
// GRAPH TYPES
// ============================================================================

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  label: string;
  data: NodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string; // node id
  sourcePort: string; // port id
  target: string; // node id
  targetPort: string; // port id
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
// NODE META (display info)
// ============================================================================

interface NodeMeta {
  label: string;
  icon: React.ElementType;
  colorVar: string;
  category: 'Input' | 'Models' | 'Data';
  hasConfig: boolean;
}

const NODE_META: Record<NodeType, NodeMeta> = {
  start: {
    label: 'Start',
    icon: Play,
    colorVar: 'var(--wf-start)',
    category: 'Input',
    hasConfig: false,
  },
  profile: {
    label: 'Profile',
    icon: SlidersHorizontal,
    colorVar: 'var(--wf-profile)',
    category: 'Data',
    hasConfig: true,
  },
  'text-data': {
    label: 'Text',
    icon: Type,
    colorVar: 'var(--wf-text)',
    category: 'Data',
    hasConfig: true,
  },
  server: {
    label: 'Server',
    icon: Server,
    colorVar: 'var(--wf-server)',
    category: 'Models',
    hasConfig: true,
  },
  'input-text': {
    label: 'Input Text',
    icon: TextCursor,
    colorVar: 'var(--wf-text)',
    category: 'Input',
    hasConfig: true,
  },
  agent: {
    label: 'Agent',
    icon: Bot,
    colorVar: 'var(--wf-agent)',
    category: 'Models',
    hasConfig: true,
  },
};

// ============================================================================
// LAYOUT CONSTANTS
// ============================================================================

const NODE_WIDTH = 220;
const PORT_GAP = 28; // px between ports vertically
const PORT_TOP = 44; // y of first port from node top
const PORT_RADIUS = 6; // visual circle radius
const PORT_HIT = 12; // clickable radius
const BEZIER_OFFSET = 90;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.02;
const GRID_SIZE = 20;
const DRAG_THRESHOLD = 5;
const DOT_SPACING = 24;
const MAX_HISTORY = 60;
const TAIL_HIT_PCT = 0.18; // last 18% of edge = tail drag zone
const WORKFLOWS_KEY = 'workflows';

// ============================================================================
// STORAGE
// ============================================================================

function loadWorkflows(): Workflow[] {
  try {
    return JSON.parse(
      localStorage.getItem(WORKFLOWS_KEY) ?? '[]',
    ) as Workflow[];
  } catch {
    return [];
  }
}

function persistWorkflows(wfs: Workflow[]): void {
  localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(wfs));
}

function loadProfiles(): Profile[] {
  try {
    return (
      JSON.parse(localStorage.getItem('profiles') ?? '[]') as Profile[]
    ).sort((a, b) => a.order - b.order);
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

function snapG(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

function makeNode(type: NodeType, x: number, y: number): WorkflowNode {
  const base = {
    id: uid(),
    type,
    position: { x: snapG(x), y: snapG(y) },
    label: NODE_META[type].label,
  };
  switch (type) {
    case 'start':
      return { ...base, data: { _type: 'start' } };
    case 'profile':
      return { ...base, data: { _type: 'profile', profileId: null } };
    case 'text-data':
      return { ...base, data: { _type: 'text-data', value: '' } };
    case 'server':
      return { ...base, data: { _type: 'server', profileId: null } };
    case 'input-text':
      return { ...base, data: { _type: 'input-text', question: '' } };
    case 'agent':
      return { ...base, data: { _type: 'agent', prompt: '' } };
  }
}

// ============================================================================
// PORT POSITION CALCULATION
// port positions are relative to the node's top-left corner
// ============================================================================

function portOffset(
  node: WorkflowNode,
  portId: string,
): { x: number; y: number } | null {
  const ports = NODE_PORTS[node.type];
  const inputs = ports.filter((p) => p.side === 'input');
  const outputs = ports.filter((p) => p.side === 'output');

  const inputIdx = inputs.findIndex((p) => p.id === portId);
  const outputIdx = outputs.findIndex((p) => p.id === portId);

  if (inputIdx !== -1) return { x: 0, y: PORT_TOP + inputIdx * PORT_GAP };
  if (outputIdx !== -1)
    return { x: NODE_WIDTH, y: PORT_TOP + outputIdx * PORT_GAP };
  return null;
}

function portCanvasPos(
  node: WorkflowNode,
  portId: string,
): { x: number; y: number } | null {
  const off = portOffset(node, portId);
  if (!off) return null;
  return { x: node.position.x + off.x, y: node.position.y + off.y };
}

// ============================================================================
// BEZIER PATH
// ============================================================================

function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  return `M ${sx} ${sy} C ${sx + BEZIER_OFFSET} ${sy}, ${tx - BEZIER_OFFSET} ${ty}, ${tx} ${ty}`;
}

// Point on cubic bezier at parameter t
function bezierPoint(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  t: number,
): { x: number; y: number } {
  const c1x = sx + BEZIER_OFFSET;
  const c1y = sy;
  const c2x = tx - BEZIER_OFFSET;
  const c2y = ty;
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * sx +
      3 * mt ** 2 * t * c1x +
      3 * mt * t ** 2 * c2x +
      t ** 3 * tx,
    y:
      mt ** 3 * sy +
      3 * mt ** 2 * t * c1y +
      3 * mt * t ** 2 * c2y +
      t ** 3 * ty,
  };
}

// Approximate arc-length parameterization: given a fraction of the curve,
// return a canvas point. Used to decide if a click is near the tail.
function pointNearTail(
  px: number,
  py: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  threshold: number,
): boolean {
  // sample last TAIL_HIT_PCT of the curve
  for (let t = 1 - TAIL_HIT_PCT; t <= 1; t += 0.02) {
    const pt = bezierPoint(sx, sy, tx, ty, t);
    if (Math.hypot(px - pt.x, py - pt.y) < threshold) return true;
  }
  return false;
}

// ============================================================================
// NODE HEIGHT (dynamic based on port count)
// ============================================================================

function nodeHeight(type: NodeType): number {
  const ports = NODE_PORTS[type];
  const inputs = ports.filter((p) => p.side === 'input').length;
  const outputs = ports.filter((p) => p.side === 'output').length;
  const maxPorts = Math.max(inputs, outputs, 1);
  return PORT_TOP + (maxPorts - 1) * PORT_GAP + 28;
}

// ============================================================================
// CONFIRM DIALOG
// ============================================================================

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return createPortal(
    <div className="wf-confirm-overlay" onClick={onCancel}>
      <div className="wf-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="wf-confirm__icon">
          <AlertTriangle size={22} />
        </div>
        <h3 className="wf-confirm__title">{title}</h3>
        <p className="wf-confirm__message">{message}</p>
        <div className="wf-confirm__actions">
          <button
            type="button"
            className="wf-confirm__cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="wf-confirm__confirm"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================
// WORKFLOW GRID
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
                        setConfirmDelete(wf.id);
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
          onSelect={(name) => {
            onIconChange(iconPickerId, name);
            setIconPickerId(null);
          }}
          onClose={() => setIconPickerId(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Workflow"
          message={`Delete "${workflows.find((w) => w.id === confirmDelete)?.name ?? 'this workflow'}"? This cannot be undone.`}
          confirmText="Delete"
          onConfirm={() => {
            onDelete(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
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
  profiles: Profile[];
  onChange: (id: string, patch: Partial<WorkflowNode>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  // whether the profile input port already has an edge (disables dropdown)
  profilePortWired: boolean;
  // whether the text input port already has an edge (disables question field)
  textPortWired: boolean;
}

function NodeConfigPanel({
  node,
  profiles,
  onChange,
  onDelete,
  onClose,
  profilePortWired,
  textPortWired,
}: NodeConfigPanelProps) {
  const meta = NODE_META[node.type];
  const Icon = meta.icon;

  const patchData = (patch: Partial<NodeData>) =>
    onChange(node.id, { data: { ...node.data, ...patch } as NodeData });

  if (!meta.hasConfig) return null;

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

        {/* PROFILE node */}
        {node.type === 'profile' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">Profile</label>
            {profiles.length === 0 ? (
              <p className="wf-config-field__empty">No profiles found.</p>
            ) : (
              <select
                className="wf-config-field__select"
                value={(node.data as ProfileData).profileId ?? ''}
                onChange={(e) =>
                  patchData({
                    profileId: e.target.value || null,
                  } as Partial<ProfileData>)
                }
              >
                <option value="">Select a profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* TEXT DATA node */}
        {node.type === 'text-data' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">Text value</label>
            <textarea
              className="wf-config-field__textarea"
              rows={4}
              value={(node.data as TextDataData).value}
              onChange={(e) =>
                patchData({ value: e.target.value } as Partial<TextDataData>)
              }
              placeholder="Static text value…"
            />
          </div>
        )}

        {/* SERVER node — profile dropdown (disabled if port wired) */}
        {node.type === 'server' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Profile
              {profilePortWired && (
                <span className="wf-config-field__wired-badge">wired</span>
              )}
            </label>
            {profilePortWired ? (
              <div className="wf-config-field__disabled-row">
                <span className="wf-config-field__disabled-text">
                  Set by connected Profile node
                </span>
                <X size={13} className="wf-config-field__disabled-icon" />
              </div>
            ) : profiles.length === 0 ? (
              <p className="wf-config-field__empty">No profiles found.</p>
            ) : (
              <select
                className="wf-config-field__select"
                value={(node.data as ServerData).profileId ?? ''}
                onChange={(e) =>
                  patchData({
                    profileId: e.target.value || null,
                  } as Partial<ServerData>)
                }
              >
                <option value="">Select a profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* INPUT TEXT node — question field (disabled if port wired) */}
        {node.type === 'input-text' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Text Question
              {textPortWired && (
                <span className="wf-config-field__wired-badge">wired</span>
              )}
            </label>
            {textPortWired ? (
              <div className="wf-config-field__disabled-row">
                <span className="wf-config-field__disabled-text">
                  Set by connected Text node
                </span>
                <X size={13} className="wf-config-field__disabled-icon" />
              </div>
            ) : (
              <input
                className="wf-config-field__input"
                value={(node.data as InputTextData).question}
                onChange={(e) =>
                  patchData({
                    question: e.target.value,
                  } as Partial<InputTextData>)
                }
                placeholder="Enter a question for the user…"
              />
            )}
          </div>
        )}

        {/* AGENT node */}
        {node.type === 'agent' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Prompt hint{' '}
              <span className="wf-config-field__optional">(optional)</span>
            </label>
            <textarea
              className="wf-config-field__textarea"
              rows={4}
              value={(node.data as AgentData).prompt}
              onChange={(e) =>
                patchData({ prompt: e.target.value } as Partial<AgentData>)
              }
              placeholder="Notes about what this agent does…"
            />
          </div>
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

const PALETTE_CATEGORIES: { label: string; types: NodeType[] }[] = [
  { label: 'Input', types: ['start', 'input-text'] },
  { label: 'Models', types: ['server', 'agent'] },
  { label: 'Data', types: ['profile', 'text-data'] },
];

const NODE_HINTS: Record<NodeType, string> = {
  start: 'Entry point — outputs continue',
  profile: 'Provides a profile object',
  'text-data': 'Provides a static text value',
  server: 'Starts a model server',
  'input-text': 'Prompts user for text input',
  agent: 'Runs a prompt on a server',
};

function NodePalette({ onDragStart }: NodePaletteProps) {
  return (
    <div className="wf-palette">
      {PALETTE_CATEGORIES.map((cat) => (
        <div key={cat.label} className="wf-palette__category">
          <div className="wf-palette__category-label">{cat.label}</div>
          {cat.types.map((type) => {
            const meta = NODE_META[type];
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
                  <span className="wf-palette__item-hint">
                    {NODE_HINTS[type]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="wf-palette__tip">
        <Unlink size={11} />
        Drag onto canvas
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
  // ports that are valid targets while connecting (used for highlight)
  compatibleInputPorts: Set<string>; // "nodeId:portId"
  // ports that are valid targets while reconnecting tail
  compatibleInputPortsForReconnect: Set<string>;
  // port currently being hovered during a connection/reconnect drag
  snapTargetPort: string | null; // "nodeId:portId" | null
  profiles: Profile[];
  onNodeMouseDown: (e: ReactMouseEvent, id: string) => void;
  onPortMouseDown: (
    e: ReactMouseEvent,
    nodeId: string,
    portId: string,
    side: 'input' | 'output',
  ) => void;
  onPortMouseUp: (e: ReactMouseEvent, nodeId: string, portId: string) => void;
  onPortClick: (e: ReactMouseEvent, nodeId: string, portId: string) => void;
}

function CanvasNode({
  node,
  isSelected,
  compatibleInputPorts,
  compatibleInputPortsForReconnect,
  snapTargetPort,
  profiles,
  onNodeMouseDown,
  onPortMouseDown,
  onPortMouseUp,
  onPortClick,
}: CanvasNodeProps) {
  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const ports = NODE_PORTS[node.type];
  const inputs = ports.filter((p) => p.side === 'input');
  const outputs = ports.filter((p) => p.side === 'output');
  const h = nodeHeight(node.type);

  // preview text
  let preview = '';
  switch (node.type) {
    case 'profile': {
      const d = node.data as ProfileData;
      preview = d.profileId
        ? (profiles.find((p) => p.id === d.profileId)?.name ??
          'Unknown profile')
        : 'No profile selected';
      break;
    }
    case 'text-data': {
      const v = (node.data as TextDataData).value;
      preview = v
        ? `"${v.slice(0, 40)}${v.length > 40 ? '…' : ''}"`
        : 'No value set';
      break;
    }
    case 'server': {
      const d = node.data as ServerData;
      preview = d.profileId
        ? (profiles.find((p) => p.id === d.profileId)?.name ?? 'Profile set')
        : 'No profile';
      break;
    }
    case 'input-text': {
      const q = (node.data as InputTextData).question;
      preview = q
        ? `"${q.slice(0, 40)}${q.length > 40 ? '…' : ''}"`
        : 'No question set';
      break;
    }
    case 'agent': {
      const pr = (node.data as AgentData).prompt;
      preview = pr
        ? pr.slice(0, 44) + (pr.length > 44 ? '…' : '')
        : 'No prompt hint';
      break;
    }
  }

  const isConnectingTarget =
    compatibleInputPorts.size > 0 || compatibleInputPortsForReconnect.size > 0;

  return (
    <div
      className={[
        'wf-node',
        `wf-node--${node.type}`,
        isSelected ? 'wf-node--selected' : '',
        isConnectingTarget ? 'wf-node--connectable' : '',
      ].join(' ')}
      style={
        {
          transform: `translate(${node.position.x}px, ${node.position.y}px)`,
          width: NODE_WIDTH,
          height: h,
        } as React.CSSProperties
      }
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('.wf-port')) return;
        onNodeMouseDown(e, node.id);
      }}
    >
      {/* Header */}
      <div
        className="wf-node__header"
        style={{ '--node-color': meta.colorVar } as React.CSSProperties}
      >
        <div className="wf-node__header-icon">
          <Icon size={13} />
        </div>
        <span className="wf-node__header-label">{node.label}</span>
      </div>

      {/* Body preview */}
      {preview && (
        <div className="wf-node__body">
          <span
            className={`wf-node__preview${!preview || preview.startsWith('No ') ? ' wf-node__preview--empty' : ''}`}
          >
            {preview}
          </span>
        </div>
      )}

      {/* Input ports */}
      {inputs.map((port, idx) => {
        const key = `${node.id}:${port.id}`;
        const isSnap = snapTargetPort === key;
        const isCompat =
          compatibleInputPorts.has(key) ||
          compatibleInputPortsForReconnect.has(key);
        return (
          <div
            key={port.id}
            className={[
              'wf-port',
              'wf-port--input',
              isCompat ? 'wf-port--compatible' : '',
              isSnap ? 'wf-port--snap' : '',
            ].join(' ')}
            style={
              {
                top: PORT_TOP + idx * PORT_GAP,
                '--port-color': PORT_TYPE_COLOR[port.type],
              } as React.CSSProperties
            }
            title={`${port.label} (${port.type})`}
            onMouseDown={(e) => {
              e.stopPropagation();
              onPortMouseDown(e, node.id, port.id, 'input');
            }}
            onMouseUp={(e) => {
              e.stopPropagation();
              onPortMouseUp(e, node.id, port.id);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onPortClick(e, node.id, port.id);
            }}
          >
            <span className="wf-port__label wf-port__label--left">
              {port.label}
            </span>
          </div>
        );
      })}

      {/* Output ports */}
      {outputs.map((port, idx) => (
        <div
          key={port.id}
          className="wf-port wf-port--output"
          style={
            {
              top: PORT_TOP + idx * PORT_GAP,
              '--port-color': PORT_TYPE_COLOR[port.type],
            } as React.CSSProperties
          }
          title={`${port.label} (${port.type})`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onPortMouseDown(e, node.id, port.id, 'output');
          }}
          onMouseUp={(e) => {
            e.stopPropagation();
            onPortMouseUp(e, node.id, port.id);
          }}
        >
          <span className="wf-port__label wf-port__label--right">
            {port.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// HISTORY
// ============================================================================

interface HistoryEntry {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ============================================================================
// WORKFLOW EDITOR
// ============================================================================

interface WorkflowEditorProps {
  workflow: Workflow;
  profiles: Profile[];
  onChange: (updated: Workflow) => void;
  onBack: () => void;
  onRename: (id: string, name: string) => void;
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
  startTx: { x: number; y: number };
}

// Active connection drag: drawing a new edge from an output port
interface ConnectState {
  sourceNodeId: string;
  sourcePortId: string;
  sourcePortType: PortType;
  mouseCanvas: { x: number; y: number };
}

// Edge tail drag: reconnecting an existing edge's target
interface ReconnectState {
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  sourcePortType: PortType;
  mouseCanvas: { x: number; y: number };
}

function WorkflowEditor({
  workflow,
  profiles,
  onChange,
  onBack,
  onRename,
}: WorkflowEditorProps) {
  const [nodes, setNodes] = useState<WorkflowNode[]>(workflow.nodes);
  const [edges, setEdges] = useState<WorkflowEdge[]>(workflow.edges);
  const [transform, setTransform] = useState<Transform>({
    x: 80,
    y: 80,
    scale: 1,
  });
  const [panOffset, setPanOffset] = useState({ x: 80, y: 80 }); // dots only move on pan
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [panning, setPanning] = useState<PanState | null>(null);
  const [connecting, setConnecting] = useState<ConnectState | null>(null);
  const [reconnecting, setReconnecting] = useState<ReconnectState | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [snapTarget, setSnapTarget] = useState<string | null>(null); // "nodeId:portId"
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(workflow.name);

  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // History
  const history = useRef<HistoryEntry[]>([
    { nodes: workflow.nodes, edges: workflow.edges },
  ]);
  const historyIdx = useRef(0);

  const pushHistory = useCallback((n: WorkflowNode[], e: WorkflowEdge[]) => {
    history.current = history.current.slice(0, historyIdx.current + 1);
    history.current.push({ nodes: n, edges: e });
    if (history.current.length > MAX_HISTORY) history.current.shift();
    historyIdx.current = history.current.length - 1;
  }, []);

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

  const commit = useCallback(
    (n: WorkflowNode[], e: WorkflowEdge[], hist = true) => {
      setNodes(n);
      setEdges(e);
      triggerSave(n, e);
      if (hist) pushHistory(n, e);
    },
    [triggerSave, pushHistory],
  );

  // ── Coordinate helper ────────────────────────────────────────────────────
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

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Ctrl+Z
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

      // Ctrl+A — select all nodes
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !inField) {
        e.preventDefault();
        setSelectedNodeIds(new Set(nodes.map((n) => n.id)));
        setSelectedEdgeId(null);
        return;
      }

      if (inField) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedNodeIds.size > 0) {
          const ids = selectedNodeIds;
          const nextNodes = nodes.filter((n) => !ids.has(n.id));
          const nextEdges = edges.filter(
            (ed) => !ids.has(ed.source) && !ids.has(ed.target),
          );
          commit(nextNodes, nextEdges);
          setSelectedNodeIds(new Set());
        } else if (selectedEdgeId) {
          commit(
            nodes,
            edges.filter((ed) => ed.id !== selectedEdgeId),
          );
          setSelectedEdgeId(null);
        }
      }

      if (e.key === 'Escape') {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
        setConnecting(null);
        setReconnecting(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeIds, selectedEdgeId, nodes, edges, commit, triggerSave]);

  // ── Pan ──────────────────────────────────────────────────────────────────
  const onCanvasMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.wf-node, .wf-port')) return;
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setPanning({
      startMouse: { x: e.clientX, y: e.clientY },
      startTx: { x: transform.x, y: transform.y },
    });
  };

  useEffect(() => {
    if (!panning) return;
    const onMove = (e: MouseEvent) => {
      const nx = panning.startTx.x + e.clientX - panning.startMouse.x;
      const ny = panning.startTx.y + e.clientY - panning.startMouse.y;
      setTransform((p) => ({ ...p, x: nx, y: ny }));
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

  // ── Zoom (panOffset unchanged — dots stay still) ──────────────────────
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setTransform((prev) => {
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale + delta));
      const r = ns / prev.scale;
      return {
        scale: ns,
        x: mx - r * (mx - prev.x),
        y: my - r * (my - prev.y),
      };
    });
    // panOffset intentionally NOT updated here — dots stay fixed during zoom
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
    const maxY = Math.max(...ys) + 160;
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

  // ── Node drag ────────────────────────────────────────────────────────────
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
        setDragging((p) => (p ? { ...p, didMove: true } : null));
        setNodes((prev) =>
          prev.map((n) =>
            n.id === dragging.nodeId
              ? {
                  ...n,
                  position: {
                    x: snapG(dragging.startPos.x + dx / transform.scale),
                    y: snapG(dragging.startPos.y + dy / transform.scale),
                  },
                }
              : n,
          ),
        );
      }
    };
    const onUp = () => {
      setDragging((p) => {
        if (!p) return null;
        if (!p.didMove) {
          // click — toggle selection
          setSelectedNodeIds((prev) => {
            const next = new Set(prev);
            if (next.has(p.nodeId)) next.delete(p.nodeId);
            else next.add(p.nodeId);
            return next;
          });
        } else {
          setNodes((cur) => {
            pushHistory(cur, edges);
            triggerSave(cur, edges);
            return cur;
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

  // ── Port interaction ─────────────────────────────────────────────────────

  // Returns all input ports on all nodes that are compatible with the given output type
  const compatiblePorts = useCallback(
    (outputType: PortType): Set<string> => {
      const result = new Set<string>();
      for (const n of nodes) {
        for (const p of NODE_PORTS[n.type]) {
          if (p.side === 'input' && portsCompatible(outputType, p.type)) {
            result.add(`${n.id}:${p.id}`);
          }
        }
      }
      return result;
    },
    [nodes],
  );

  const onPortMouseDown = (
    e: ReactMouseEvent,
    nodeId: string,
    portId: string,
    side: 'input' | 'output',
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    if (side === 'output') {
      // Start a new connection from this output port
      const portDef = NODE_PORTS[nodes.find((n) => n.id === nodeId)!.type].find(
        (p) => p.id === portId,
      )!;
      setConnecting({
        sourceNodeId: nodeId,
        sourcePortId: portId,
        sourcePortType: portDef.type,
        mouseCanvas: screenToCanvas(e.clientX, e.clientY),
      });
      setSelectedEdgeId(null);
      setSelectedNodeIds(new Set());
    }

    // Input port clicked/dragged — check if we're near the tail of an existing edge
    // (we handle this in onPortClick for pure clicks; here we check for drag intent)
    // Nothing to do on mousedown for input port reconnect — handled in onPortMouseDown with side=output
    // for reconnect we detect it in the edge SVG elements
  };

  const onPortMouseUp = (
    e: ReactMouseEvent,
    nodeId: string,
    portId: string,
  ) => {
    e.stopPropagation();

    if (connecting) {
      const { sourceNodeId, sourcePortId, sourcePortType } = connecting;
      setConnecting(null);
      setSnapTarget(null);

      if (nodeId === sourceNodeId) return; // self-loop

      const portDef = NODE_PORTS[nodes.find((n) => n.id === nodeId)!.type].find(
        (p) => p.id === portId,
      );
      if (!portDef || portDef.side !== 'input') return;

      if (!portsCompatible(sourcePortType, portDef.type)) {
        // Incompatible — drop, do nothing (the wire just disappears)
        return;
      }

      // Avoid duplicate
      if (
        edges.some(
          (ed) =>
            ed.source === sourceNodeId &&
            ed.sourcePort === sourcePortId &&
            ed.target === nodeId &&
            ed.targetPort === portId,
        )
      )
        return;

      commit(nodes, [
        ...edges,
        {
          id: uid(),
          source: sourceNodeId,
          sourcePort: sourcePortId,
          target: nodeId,
          targetPort: portId,
        },
      ]);
      return;
    }

    if (reconnecting) {
      const { edgeId, sourceNodeId, sourcePortId, sourcePortType } =
        reconnecting;
      setReconnecting(null);
      setSnapTarget(null);

      // Remove original edge always
      const withoutOriginal = edges.filter((ed) => ed.id !== edgeId);

      if (nodeId === sourceNodeId) {
        // Dropped back on source — just delete
        commit(nodes, withoutOriginal);
        return;
      }

      const portDef = NODE_PORTS[nodes.find((n) => n.id === nodeId)!.type].find(
        (p) => p.id === portId,
      );
      if (
        !portDef ||
        portDef.side !== 'input' ||
        !portsCompatible(sourcePortType, portDef.type)
      ) {
        // Incompatible drop — just delete original
        commit(nodes, withoutOriginal);
        return;
      }

      // Re-attach
      commit(nodes, [
        ...withoutOriginal,
        {
          id: uid(),
          source: sourceNodeId,
          sourcePort: sourcePortId,
          target: nodeId,
          targetPort: portId,
        },
      ]);
    }
  };

  const onPortClick = (e: ReactMouseEvent, nodeId: string, portId: string) => {
    e.stopPropagation();
    if (connecting || reconnecting) return;

    // Input port click → select the attached edge
    const inbound = edges.filter(
      (ed) => ed.target === nodeId && ed.targetPort === portId,
    );
    if (inbound.length === 0) return;
    const currentIdx = inbound.findIndex((ed) => ed.id === selectedEdgeId);
    const next = inbound[(currentIdx + 1) % inbound.length];
    setSelectedEdgeId(next.id);
    setSelectedNodeIds(new Set());
  };

  // ── Connection mousemove tracking ────────────────────────────────────────
  useEffect(() => {
    if (!connecting && !reconnecting) return;
    const onMove = (e: MouseEvent) => {
      const pos = screenToCanvas(e.clientX, e.clientY);
      if (connecting)
        setConnecting((p) => (p ? { ...p, mouseCanvas: pos } : null));
      if (reconnecting)
        setReconnecting((p) => (p ? { ...p, mouseCanvas: pos } : null));

      // Find snap target
      const portType =
        connecting?.sourcePortType ?? reconnecting?.sourcePortType;
      if (!portType) return;
      let found: string | null = null;
      outer: for (const n of nodes) {
        for (const port of NODE_PORTS[n.type]) {
          if (port.side !== 'input') continue;
          if (!portsCompatible(portType, port.type)) continue;
          const cp = portCanvasPos(n, port.id);
          if (!cp) continue;
          const dist = Math.hypot(pos.x - cp.x, pos.y - cp.y);
          if (dist < 20 / transform.scale) {
            found = `${n.id}:${port.id}`;
            break outer;
          }
        }
      }
      setSnapTarget(found);
    };
    const onUp = () => {
      if (connecting) {
        // Released on canvas (not a port) — if over snap target reconnect, handled in onPortMouseUp
        // Otherwise check if we're over a snap target at mouse-up time
        setConnecting(null);
        setSnapTarget(null);
      }
      if (reconnecting) {
        // Released on canvas — delete original
        setReconnecting((p) => {
          if (!p) return null;
          commit(
            nodes,
            edges.filter((ed) => ed.id !== p.edgeId),
          );
          return null;
        });
        setSnapTarget(null);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, reconnecting, nodes, screenToCanvas, transform.scale]);

  // ── Snap-target mouseup forwarding ───────────────────────────────────────
  // When releasing over a snap target (not directly over the port DOM element),
  // we synthesise the connection from snapTarget state
  // This is handled in the mousemove onUp above via snapTarget

  // ── Palette drag-drop ────────────────────────────────────────────────────
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
    const node = makeNode(
      type,
      pos.x - NODE_WIDTH / 2,
      pos.y - nodeHeight(type) / 2,
    );
    commit([...nodes, node], edges);
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeId(null);
  };

  // ── Delete helpers ────────────────────────────────────────────────────────
  const deleteNode = useCallback(
    (id: string) => {
      const nextNodes = nodes.filter((n) => n.id !== id);
      const nextEdges = edges.filter(
        (ed) => ed.source !== id && ed.target !== id,
      );
      commit(nextNodes, nextEdges);
      setSelectedNodeIds((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
    },
    [nodes, edges, commit],
  );

  const patchNode = useCallback(
    (id: string, patch: Partial<WorkflowNode>) => {
      commit(
        nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        edges,
      );
    },
    [nodes, edges, commit],
  );

  // ── Edge SVG click/reconnect ──────────────────────────────────────────────
  const onEdgeClick = (
    e: ReactMouseEvent,
    edgeId: string,
    isTail: boolean,
    mouseCanvasPos: { x: number; y: number },
  ) => {
    e.stopPropagation();
    if (isTail) {
      // Start reconnect
      const edge = edges.find((ed) => ed.id === edgeId)!;
      const srcNode = nodes.find((n) => n.id === edge.source)!;
      const portDef = NODE_PORTS[srcNode.type].find(
        (p) => p.id === edge.sourcePort,
      )!;
      setReconnecting({
        edgeId,
        sourceNodeId: edge.source,
        sourcePortId: edge.sourcePort,
        sourcePortType: portDef.type,
        mouseCanvas: mouseCanvasPos,
      });
      setSelectedEdgeId(null);
      setSelectedNodeIds(new Set());
    } else {
      setSelectedEdgeId((p) => (p === edgeId ? null : edgeId));
      setSelectedNodeIds(new Set());
    }
  };

  // ── Port positions ────────────────────────────────────────────────────────
  const edgeEndpoints = (edge: WorkflowEdge) => {
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    if (!src || !tgt) return null;
    const s = portCanvasPos(src, edge.sourcePort);
    const t = portCanvasPos(tgt, edge.targetPort);
    if (!s || !t) return null;
    return { s, t };
  };

  // ── Drag in-progress wire source ─────────────────────────────────────────
  const wireSource = connecting
    ? portCanvasPos(
        nodes.find((n) => n.id === connecting.sourceNodeId)!,
        connecting.sourcePortId,
      )
    : reconnecting
      ? portCanvasPos(
          nodes.find((n) => n.id === reconnecting.sourceNodeId)!,
          reconnecting.sourcePortId,
        )
      : null;

  const wireMouse =
    connecting?.mouseCanvas ?? reconnecting?.mouseCanvas ?? null;
  const wirePortType =
    connecting?.sourcePortType ?? reconnecting?.sourcePortType ?? null;

  // ── Compatible ports for highlight ───────────────────────────────────────
  const activeCompatPorts = useMemo((): Set<string> => {
    if (!connecting && !reconnecting) return new Set();
    const type = connecting?.sourcePortType ?? reconnecting?.sourcePortType;
    if (!type) return new Set();
    return compatiblePorts(type);
  }, [connecting, reconnecting, compatiblePorts]);

  // ── Dot grid background position ─────────────────────────────────────────
  const dotBgX = ((panOffset.x % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
  const dotBgY = ((panOffset.y % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;

  // ── Single selected node (for config panel) ───────────────────────────────
  const singleSelected =
    selectedNodeIds.size === 1
      ? (nodes.find((n) => n.id === [...selectedNodeIds][0]) ?? null)
      : null;

  // Is the profile input port wired for the selected server node?
  const profilePortWired = useMemo(() => {
    if (!singleSelected || singleSelected.type !== 'server') return false;
    return edges.some(
      (ed) => ed.target === singleSelected.id && ed.targetPort === 'in-profile',
    );
  }, [singleSelected, edges]);

  const textPortWired = useMemo(() => {
    if (!singleSelected || singleSelected.type !== 'input-text') return false;
    return edges.some(
      (ed) => ed.target === singleSelected.id && ed.targetPort === 'in-text',
    );
  }, [singleSelected, edges]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Separate edges into non-selected and selected for layering
  const nonSelectedEdges = edges.filter((ed) => ed.id !== selectedEdgeId);
  const selectedEdge = edges.find((ed) => ed.id === selectedEdgeId);

  const renderEdge = (edge: WorkflowEdge, isSelected: boolean) => {
    const ep = edgeEndpoints(edge);
    if (!ep) return null;
    const { s, t } = ep;
    const isHov = hoveredEdgeId === edge.id;
    const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };

    const onMouseDown = (e: ReactMouseEvent<SVGElement>, isTail: boolean) => {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      onEdgeClick(e, edge.id, isTail, canvasPos);
    };

    return (
      <g key={edge.id}>
        {/* Wide hit area */}
        <path
          d={bezierPath(s.x, s.y, t.x, t.y)}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredEdgeId(edge.id)}
          onMouseLeave={() => setHoveredEdgeId(null)}
          onMouseDown={(e) => {
            const canvasPos = screenToCanvas(e.clientX, e.clientY);
            const isTail = pointNearTail(
              canvasPos.x,
              canvasPos.y,
              s.x,
              s.y,
              t.x,
              t.y,
              14 / transform.scale,
            );
            onMouseDown(e, isTail);
          }}
        />
        {/* Visible line */}
        <path
          d={bezierPath(s.x, s.y, t.x, t.y)}
          fill="none"
          className={`wf-edge${isSelected ? ' wf-edge--selected' : isHov ? ' wf-edge--hovered' : ''}`}
          markerEnd={
            isSelected
              ? 'url(#wf-arrow-sel)'
              : isHov
                ? 'url(#wf-arrow-hov)'
                : 'url(#wf-arrow)'
          }
          style={{ pointerEvents: 'none' }}
        />
        {/* Endpoint circles */}
        <circle
          cx={s.x}
          cy={s.y}
          r={5}
          className={`wf-edge__endpoint${isHov || isSelected ? ' wf-edge__endpoint--visible' : ''}`}
          onMouseEnter={() => setHoveredEdgeId(edge.id)}
          onMouseLeave={() => setHoveredEdgeId(null)}
          onMouseDown={(e) => onMouseDown(e, false)}
          style={{ cursor: 'pointer' }}
        />
        <circle
          cx={t.x}
          cy={t.y}
          r={5}
          className={`wf-edge__endpoint${isHov || isSelected ? ' wf-edge__endpoint--visible' : ''}`}
          style={{ cursor: 'crosshair' }}
          onMouseEnter={() => setHoveredEdgeId(edge.id)}
          onMouseLeave={() => setHoveredEdgeId(null)}
          onMouseDown={(e) => onMouseDown(e, true)}
        />
        {/* Midpoint delete */}
        {(isHov || isSelected) && (
          <g
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredEdgeId(edge.id)}
            onMouseLeave={() => setHoveredEdgeId(null)}
            onClick={(e) => {
              e.stopPropagation();
              commit(
                nodes,
                edges.filter((ed) => ed.id !== edge.id),
              );
              if (selectedEdgeId === edge.id) setSelectedEdgeId(null);
            }}
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
  };

  const editor = (
    <div className="wf-portal">
      {/* Toolbar */}
      <div className="wf-toolbar">
        <button type="button" className="wf-toolbar__back" onClick={onBack}>
          <ChevronLeft size={15} />
          Workflows
        </button>

        {/* Inline name edit */}
        {editingName ? (
          <input
            ref={nameInputRef}
            className="wf-toolbar__name-input"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => {
              setEditingName(false);
              if (nameValue.trim() && nameValue.trim() !== workflow.name) {
                onRename(workflow.id, nameValue.trim());
              }
            }}
            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setNameValue(workflow.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="wf-toolbar__name"
            title="Click to rename"
            onClick={() => {
              setEditingName(true);
              setTimeout(() => nameInputRef.current?.select(), 0);
            }}
          >
            {workflow.name}
            <Pencil size={11} className="wf-toolbar__name-pencil" />
          </button>
        )}

        <div className="wf-toolbar__zoom-group">
          <button
            type="button"
            className="wf-toolbar__zoom-btn"
            onClick={zoomOut}
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
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="wf-toolbar__zoom-btn"
            onClick={fitView}
          >
            <Maximize size={13} />
          </button>
        </div>

        {/* Selection bar */}
        {(selectedEdgeId || selectedNodeIds.size > 0) && (
          <div className="wf-toolbar__sel-bar">
            <span className="wf-toolbar__sel-label">
              {selectedEdgeId
                ? 'Edge selected'
                : selectedNodeIds.size === 1
                  ? nodes.find((n) => n.id === [...selectedNodeIds][0])?.label
                  : `${selectedNodeIds.size} nodes`}
            </span>
            <button
              type="button"
              className="wf-toolbar__sel-delete"
              onClick={() => {
                if (selectedEdgeId) {
                  commit(
                    nodes,
                    edges.filter((ed) => ed.id !== selectedEdgeId),
                  );
                  setSelectedEdgeId(null);
                } else {
                  const ids = selectedNodeIds;
                  commit(
                    nodes.filter((n) => !ids.has(n.id)),
                    edges.filter(
                      (ed) => !ids.has(ed.source) && !ids.has(ed.target),
                    ),
                  );
                  setSelectedNodeIds(new Set());
                }
              }}
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="wf-editor__body">
        {/* Left palette */}
        <NodePalette onDragStart={onPaletteDragStart} />

        {/* Canvas */}
        <div
          ref={canvasRef}
          className={[
            'wf-canvas',
            panning ? 'wf-canvas--panning' : '',
            connecting || reconnecting ? 'wf-canvas--connecting' : '',
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
            {/* SVG — non-selected edges first, then nodes, then selected edge on top */}
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
                  <polygon points="0 0,8 3,0 6" className="wf-edge__arrow" />
                </marker>
                <marker
                  id="wf-arrow-hov"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0,8 3,0 6"
                    className="wf-edge__arrow wf-edge__arrow--hov"
                  />
                </marker>
                <marker
                  id="wf-arrow-sel"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0,8 3,0 6"
                    className="wf-edge__arrow wf-edge__arrow--sel"
                  />
                </marker>
              </defs>

              {/* Pass 1: non-selected edges */}
              {nonSelectedEdges.map((ed) => renderEdge(ed, false))}

              {/* In-progress wire */}
              {wireSource && wireMouse && wirePortType && (
                <path
                  d={bezierPath(
                    wireSource.x,
                    wireSource.y,
                    wireMouse.x,
                    wireMouse.y,
                  )}
                  fill="none"
                  className="wf-edge wf-edge--connecting"
                  strokeDasharray="6 4"
                  style={{ stroke: PORT_TYPE_COLOR[wirePortType] }}
                />
              )}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const nodeKey = `${node.id}:`;
              // Filter compatible ports to this node
              const nodeCompatPorts = new Set(
                [...activeCompatPorts].filter((k) => k.startsWith(nodeKey)),
              );
              return (
                <CanvasNode
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeIds.has(node.id)}
                  compatibleInputPorts={
                    connecting ? nodeCompatPorts : new Set()
                  }
                  compatibleInputPortsForReconnect={
                    reconnecting ? nodeCompatPorts : new Set()
                  }
                  snapTargetPort={snapTarget}
                  profiles={profiles}
                  onNodeMouseDown={onNodeMouseDown}
                  onPortMouseDown={onPortMouseDown}
                  onPortMouseUp={onPortMouseUp}
                  onPortClick={onPortClick}
                />
              );
            })}

            {/* SVG Pass 2: selected edge on top */}
            {selectedEdge && (
              <svg
                className="wf-canvas__svg wf-canvas__svg--top"
                overflow="visible"
              >
                {renderEdge(selectedEdge, true)}
              </svg>
            )}
          </div>

          {nodes.length === 0 && (
            <div className="wf-canvas__empty">
              <GitBranch size={34} className="wf-canvas__empty-icon" />
              <p>Drag a node from the left panel to get started.</p>
            </div>
          )}
        </div>

        {/* Right config panel */}
        {singleSelected && NODE_META[singleSelected.type].hasConfig && (
          <NodeConfigPanel
            node={singleSelected}
            profiles={profiles}
            onChange={patchNode}
            onDelete={deleteNode}
            onClose={() => setSelectedNodeIds(new Set())}
            profilePortWired={profilePortWired}
            textPortWired={textPortWired}
          />
        )}
      </div>

      {/* Hint bar */}
      <div className="wf-hint">
        <kbd>Del</kbd> delete
        <span className="wf-hint__sep" />
        <kbd>Ctrl A</kbd> select all
        <span className="wf-hint__sep" />
        <kbd>Ctrl Z</kbd> undo
        <span className="wf-hint__sep" />
        Drag tail of edge to reconnect
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

  const handleDelete = (id: string) => {
    saveAll(workflows.filter((w) => w.id !== id));
    if (openId === id) setOpenId(null);
  };
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
          onRename={handleRename}
        />
      )}
    </>
  );
}

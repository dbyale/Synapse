// src/renderer/pages/WorkflowsPage.tsx

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
  Database,
  PenLine,
  FilePenLine,
  GitFork,
  FileText,
  FileEdit,
  FileX,
  FilePlus,
  Layers,
  Wrench,
  Upload,
  Download,
  Square,
} from 'lucide-react';
import IconPicker, { resolveIcon } from '../components/workflows/IconPicker';
import { Profile } from '../types/profile';
import '../styles/WorkflowsPage.css';

// ============================================================================
// PORT TYPES
// ============================================================================

export type PortType =
  | 'continue'
  | 'profile'
  | 'profile-cache'
  | 'server'
  | 'text'
  | 'tool-trigger'
  | 'edits'
  | 'server-profile';

function portsCompatible(output: PortType, input: PortType): boolean {
  return output === input;
}

// ============================================================================
// NODE TYPES
// ============================================================================

export type NodeType =
  | 'start'
  | 'profile'
  | 'profile-cache'
  | 'text-data'
  | 'server'
  | 'input-text'
  | 'agent'
  | 'write-text'
  | 'edit-text'
  | 'decide-if'
  | 'write-file'
  | 'read-file'
  | 'edit-file'
  | 'delete-file'
  | 'profile-load'
  | 'profile-unload'
  | 'end'
  | 'comment';

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  side: 'input' | 'output';
}

// Static port definitions — dynamic nodes (profile-cache, agent, server) are
// handled by getNodePorts() below.
const NODE_PORTS_STATIC: Record<NodeType, PortDef[]> = {
  start: [
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
  ],
  profile: [
    { id: 'out-profile', label: 'profile', type: 'profile', side: 'output' },
  ],
  // dynamic — see getNodePorts()
  'profile-cache': [
    { id: 'in-profile-0', label: 'profile 1', type: 'profile', side: 'input' },
    {
      id: 'out-profile-cache',
      label: 'cache',
      type: 'profile-cache',
      side: 'output',
    },
  ],
  'text-data': [
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
  ],
  // dynamic — see getNodePorts()
  server: [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-profile', label: 'profile', type: 'profile', side: 'input' },
    {
      id: 'in-profile-cache',
      label: 'profile cache',
      type: 'profile-cache',
      side: 'input',
    },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-server', label: 'server', type: 'server', side: 'output' },
  ],
  'input-text': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-text', label: 'question', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
  ],
  // dynamic — see getNodePorts()
  agent: [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-server', label: 'server', type: 'server', side: 'input' },
    { id: 'in-text', label: 'prompt', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
  ],
  // ── Tool nodes ──────────────────────────────────────────────────────────
  'write-text': [
    {
      id: 'in-tool',
      label: 'tool trigger',
      type: 'tool-trigger',
      side: 'input',
    },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
  ],
  'edit-text': [
    {
      id: 'in-tool',
      label: 'tool trigger',
      type: 'tool-trigger',
      side: 'input',
    },
    { id: 'in-text', label: 'text in', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-text', label: 'text', type: 'text', side: 'output' },
    { id: 'out-edits', label: 'edits', type: 'edits', side: 'output' },
  ],
  'decide-if': [
    {
      id: 'in-tool',
      label: 'tool trigger',
      type: 'tool-trigger',
      side: 'input',
    },
    {
      id: 'out-continue-true',
      label: 'true',
      type: 'continue',
      side: 'output',
    },
    {
      id: 'out-continue-false',
      label: 'false',
      type: 'continue',
      side: 'output',
    },
  ],
  // ── File nodes ───────────────────────────────────────────────────────────
  'write-file': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-name', label: 'name', type: 'text', side: 'input' },
    { id: 'in-content', label: 'content', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
  ],
  'read-file': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-name', label: 'name', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-content', label: 'content', type: 'text', side: 'output' },
  ],
  'edit-file': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-name', label: 'filename', type: 'text', side: 'input' },
    { id: 'in-edits', label: 'edits', type: 'edits', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
  ],
  'delete-file': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-name', label: 'filename', type: 'text', side: 'input' },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
  ],
  // ── Profile management nodes ────────────────────────────────────────────
  'profile-load': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-server', label: 'server', type: 'server', side: 'input' },
    {
      id: 'in-profile',
      label: 'profile',
      type: 'server-profile',
      side: 'input',
    },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
    { id: 'out-profile', label: 'profile', type: 'profile', side: 'output' },
  ],
  'profile-unload': [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
    { id: 'in-server', label: 'server', type: 'server', side: 'input' },
    {
      id: 'in-profile',
      label: 'profile',
      type: 'server-profile',
      side: 'input',
    },
    { id: 'out-continue', label: 'continue', type: 'continue', side: 'output' },
  ],
  end: [
    { id: 'in-continue', label: 'continue', type: 'continue', side: 'input' },
  ],
  comment: [],
};

// ── Colour per port type ─────────────────────────────────────────────────────
const PORT_TYPE_COLOR: Record<PortType, string> = {
  continue: 'var(--wf-continue)',
  profile: 'var(--wf-profile)',
  'profile-cache': 'var(--wf-profile-cache)',
  server: 'var(--wf-server)',
  text: 'var(--wf-text)',
  'tool-trigger': 'var(--wf-tool-trigger)',
  edits: 'var(--wf-edits)',
  'server-profile': 'var(--wf-server-profile)',
};

// ============================================================================
// NODE DATA TYPES
// ============================================================================

export interface StartData {
  type: 'start';
}
export interface ProfileData {
  type: 'profile';
  profileId: string | null;
}
export interface ProfileCacheData {
  type: 'profile-cache';
}
export interface TextDataData {
  type: 'text-data';
  value: string;
}
export interface ServerData {
  type: 'server';
  profileId: string | null;
}
export interface InputTextData {
  type: 'input-text';
  question: string;
}
export interface AgentData {
  type: 'agent';
  prompt: string;
}
export interface WriteTextData {
  type: 'write-text';
  description: string;
}
export interface EditTextData {
  type: 'edit-text';
  instruction: string;
}
export interface DecideIfData {
  type: 'decide-if';
  condition: string;
}
export interface WriteFileData {
  type: 'write-file';
}
export interface ReadFileData {
  type: 'read-file';
}
export interface EditFileData {
  type: 'edit-file';
}
export interface DeleteFileData {
  type: 'delete-file';
}
export interface ProfileLoadData {
  type: 'profile-load';
}
export interface ProfileUnloadData {
  type: 'profile-unload';
}
export interface EndData {
  type: 'end';
}
export interface CommentData {
  type: 'comment';
  text: string;
}

export type NodeData =
  | StartData
  | ProfileData
  | ProfileCacheData
  | TextDataData
  | ServerData
  | InputTextData
  | AgentData
  | WriteTextData
  | EditTextData
  | DecideIfData
  | WriteFileData
  | ReadFileData
  | EditFileData
  | DeleteFileData
  | ProfileLoadData
  | ProfileUnloadData
  | EndData
  | CommentData;

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
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface Workflow {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ============================================================================
// NODE META
// ============================================================================

interface NodeMeta {
  label: string;
  icon: React.ElementType;
  colorVar: string;
  category: 'Input' | 'Models' | 'Data' | 'Tools' | 'Files';
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
  'profile-cache': {
    label: 'Profile Cache',
    icon: Database,
    colorVar: 'var(--wf-profile-cache)',
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
  'write-text': {
    label: 'Write Text',
    icon: PenLine,
    colorVar: 'var(--wf-tool)',
    category: 'Tools',
    hasConfig: true,
  },
  'edit-text': {
    label: 'Edit Text',
    icon: FilePenLine,
    colorVar: 'var(--wf-tool)',
    category: 'Tools',
    hasConfig: true,
  },
  'decide-if': {
    label: 'Decide If',
    icon: GitFork,
    colorVar: 'var(--wf-tool)',
    category: 'Tools',
    hasConfig: true,
  },
  'write-file': {
    label: 'Write File',
    icon: FilePlus,
    colorVar: 'var(--wf-file)',
    category: 'Files',
    hasConfig: false,
  },
  'read-file': {
    label: 'Read File',
    icon: FileText,
    colorVar: 'var(--wf-file)',
    category: 'Files',
    hasConfig: false,
  },
  'edit-file': {
    label: 'Edit File',
    icon: FileEdit,
    colorVar: 'var(--wf-file)',
    category: 'Files',
    hasConfig: false,
  },
  'delete-file': {
    label: 'Delete File',
    icon: FileX,
    colorVar: 'var(--wf-file)',
    category: 'Files',
    hasConfig: false,
  },
  'profile-load': {
    label: 'Profile Load',
    icon: Upload,
    colorVar: 'var(--wf-profile-op)',
    category: 'Models',
    hasConfig: false,
  },
  'profile-unload': {
    label: 'Profile Unload',
    icon: Download,
    colorVar: 'var(--wf-profile-op)',
    category: 'Models',
    hasConfig: false,
  },
  end: {
    label: 'End',
    icon: Square,
    colorVar: 'var(--wf-end)',
    category: 'Input',
    hasConfig: false,
  },
  comment: {
    label: 'Comment',
    icon: FileText,
    colorVar: 'var(--wf-text)',
    category: 'Data',
    hasConfig: true,
  },
};

// ============================================================================
// DYNAMIC PORT RESOLUTION
// ============================================================================

/**
 * Returns the live port list for a node, accounting for dynamic ports on
 * profile-cache (variable profile inputs), agent (variable context + profile
 * inputs), and server (variable profile outputs when cache is connected).
 */
function getNodePorts(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  profiles: Profile[],
): PortDef[] {
  if (node.type === 'profile-cache') {
    const wiredIndices = edges
      .filter(
        (e) => e.target === node.id && e.targetPort.startsWith('in-profile-'),
      )
      .map((e) => parseInt(e.targetPort.replace('in-profile-', ''), 10))
      .filter((n) => !isNaN(n));
    const maxIdx = wiredIndices.length > 0 ? Math.max(...wiredIndices) : -1;
    const count = Math.max(1, maxIdx + 2);
    const inputs: PortDef[] = Array.from({ length: count }, (_, i) => ({
      id: `in-profile-${i}`,
      label: `profile ${i + 1}`,
      type: 'profile' as PortType,
      side: 'input' as const,
    }));
    return [
      ...inputs,
      {
        id: 'out-profile-cache',
        label: 'cache',
        type: 'profile-cache',
        side: 'output',
      },
    ];
  }

  if (node.type === 'agent') {
    const staticInputs = NODE_PORTS_STATIC.agent.filter(
      (p) => p.side === 'input',
    );
    const staticOutputs = NODE_PORTS_STATIC.agent.filter(
      (p) => p.side === 'output',
    );

    // Context inputs (text)
    const ctxWired = edges
      .filter(
        (e) => e.target === node.id && e.targetPort.startsWith('in-context-'),
      )
      .map((e) => parseInt(e.targetPort.replace('in-context-', ''), 10))
      .filter((n) => !isNaN(n));
    const maxCtxIdx = ctxWired.length > 0 ? Math.max(...ctxWired) : -1;
    const ctxCount = Math.max(1, maxCtxIdx + 2);
    const contextPorts: PortDef[] = Array.from(
      { length: ctxCount },
      (_, i) => ({
        id: `in-context-${i}`,
        label: `context ${i + 1}`,
        type: 'text' as PortType,
        side: 'input' as const,
      }),
    );

    // Single profile input when connected server exposes server-profiles
    const serverEdge = edges.find(
      (e) => e.target === node.id && e.targetPort === 'in-server',
    );
    let profilePorts: PortDef[] = [];
    if (serverEdge) {
      const serverNode = nodes.find((n) => n.id === serverEdge.source);
      if (serverNode && serverNode.type === 'server') {
        const serverPorts = getNodePorts(serverNode, edges, nodes, profiles);
        const hasProfileOutputs = serverPorts.some(
          (p) => p.side === 'output' && p.type === 'server-profile',
        );
        if (hasProfileOutputs) {
          profilePorts = [
            {
              id: 'in-profile-0',
              label: 'server profile',
              type: 'server-profile' as PortType,
              side: 'input' as const,
            },
          ];
        }
      }
    }

    // Resource outputs (tool-trigger)
    const resWired = edges
      .filter(
        (e) => e.source === node.id && e.sourcePort.startsWith('out-resource-'),
      )
      .map((e) => parseInt(e.sourcePort.replace('out-resource-', ''), 10))
      .filter((n) => !isNaN(n));
    const maxResIdx = resWired.length > 0 ? Math.max(...resWired) : -1;
    const resCount = Math.max(1, maxResIdx + 2);
    const resourcePorts: PortDef[] = Array.from(
      { length: resCount },
      (_, i) => ({
        id: `out-resource-${i}`,
        label: `resource ${i + 1}`,
        type: 'tool-trigger' as PortType,
        side: 'output' as const,
      }),
    );

    return [
      ...staticInputs,
      ...contextPorts,
      ...profilePorts,
      ...staticOutputs,
      ...resourcePorts,
    ];
  }

  if (node.type === 'server') {
    const staticPorts = NODE_PORTS_STATIC.server;
    const profileOutputs: PortDef[] = [];

    // Direct profile input -> one server-profile output
    const directEdge = edges.find(
      (e) => e.target === node.id && e.targetPort === 'in-profile',
    );
    if (directEdge) {
      const srcNode = nodes.find((n) => n.id === directEdge.source);
      let label = 'Unknown profile';
      if (srcNode?.type === 'profile') {
        const d = srcNode.data as ProfileData;
        label = d.profileId
          ? (profiles.find((p) => p.id === d.profileId)?.name ??
            'Unknown profile')
          : 'No profile selected';
      }
      profileOutputs.push({
        id: 'out-profile-direct',
        label,
        type: 'server-profile' as PortType,
        side: 'output' as const,
      });
    }

    // Cache input -> one server-profile output per wired cache slot
    const cacheEdge = edges.find(
      (e) => e.target === node.id && e.targetPort === 'in-profile-cache',
    );
    if (cacheEdge) {
      const cacheNode = nodes.find((n) => n.id === cacheEdge.source);
      if (cacheNode && cacheNode.type === 'profile-cache') {
        const cachePorts = getNodePorts(cacheNode, edges, nodes, profiles);
        const wiredProfileInputs = cachePorts
          .filter((p) => p.side === 'input' && p.type === 'profile')
          .filter((p) =>
            edges.some(
              (e) => e.target === cacheNode.id && e.targetPort === p.id,
            ),
          );
        wiredProfileInputs.forEach((p, i) => {
          const inputEdge = edges.find(
            (e) => e.target === cacheNode.id && e.targetPort === p.id,
          )!;
          const srcNode = nodes.find((n) => n.id === inputEdge.source);
          let label = 'Unknown profile';
          if (srcNode?.type === 'profile') {
            const d = srcNode.data as ProfileData;
            label = d.profileId
              ? (profiles.find((pr) => pr.id === d.profileId)?.name ??
                'Unknown profile')
              : 'No profile selected';
          }
          profileOutputs.push({
            id: `out-profile-${i}`,
            label,
            type: 'server-profile' as PortType,
            side: 'output' as const,
          });
        });
      }
    }
    return [...staticPorts, ...profileOutputs];
  }

  return NODE_PORTS_STATIC[node.type] ?? [];
}

// ============================================================================
// LAYOUT CONSTANTS
// ============================================================================

const NODE_WIDTH = 220;
const PORT_GAP = 28;
const PORT_TOP = 44;
const PORT_RADIUS = 6;
const PORT_HIT = 12;
const BEZIER_OFFSET = 90;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.02;
const GRID_SIZE = 20;
const DRAG_THRESHOLD = 5;
const DOT_SPACING = 24;
const MAX_HISTORY = 60;
const scrollThreshold = () =>
  Math.max(24, Math.min(window.innerWidth, window.innerHeight) * 0.1);
const SCROLL_SPEED = 12;
const TAIL_HIT_PCT = 0.18;
const WORKFLOWS_KEY = 'workflows';

// ============================================================================
// STORAGE
// ============================================================================

function loadWorkflows(): Workflow[] {
  try {
    const raw = JSON.parse(
      localStorage.getItem(WORKFLOWS_KEY) ?? '[]',
    ) as Workflow[];
    return raw
      .map((wf, i) => ({
        ...wf,
        color: (wf as any).color || '#89b4fa',
        order: wf.order ?? i,
      }))
      .sort((a, b) => a.order - b.order);
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
      return { ...base, data: { type: 'start' } };
    case 'profile':
      return { ...base, data: { type: 'profile', profileId: null } };
    case 'profile-cache':
      return { ...base, data: { type: 'profile-cache' } };
    case 'text-data':
      return { ...base, data: { type: 'text-data', value: '' } };
    case 'server':
      return { ...base, data: { type: 'server', profileId: null } };
    case 'input-text':
      return { ...base, data: { type: 'input-text', question: '' } };
    case 'agent':
      return { ...base, data: { type: 'agent', prompt: '' } };
    case 'write-text':
      return { ...base, data: { type: 'write-text', description: '' } };
    case 'edit-text':
      return { ...base, data: { type: 'edit-text', instruction: '' } };
    case 'decide-if':
      return { ...base, data: { type: 'decide-if', condition: '' } };
    case 'write-file':
      return { ...base, data: { type: 'write-file' } };
    case 'read-file':
      return { ...base, data: { type: 'read-file' } };
    case 'edit-file':
      return { ...base, data: { type: 'edit-file' } };
    case 'delete-file':
      return { ...base, data: { type: 'delete-file' } };
    case 'profile-load':
      return { ...base, data: { type: 'profile-load' } };
    case 'profile-unload':
      return { ...base, data: { type: 'profile-unload' } };
    case 'end':
      return { ...base, data: { type: 'end' } };
    case 'comment':
      return { ...base, data: { type: 'comment', text: '' } };
  }
}

// ============================================================================
// PORT POSITION CALCULATION
// ============================================================================

function portOffset(
  node: WorkflowNode,
  portId: string,
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  profiles: Profile[],
): { x: number; y: number } | null {
  const ports = getNodePorts(node, edges, nodes, profiles);
  const inputs = ports.filter((p) => p.side === 'input');
  const outputs = ports.filter((p) => p.side === 'output');
  const nonResOutputs = outputs.filter(
    (p) => !p.id.startsWith('out-resource-'),
  );
  const resOutputs = outputs.filter((p) =>
    p.id.startsWith('out-resource-'),
  );

  const inIdx = inputs.findIndex((p) => p.id === portId);
  if (inIdx !== -1) return { x: 0, y: PORT_TOP + inIdx * PORT_GAP };

  const outIdx = nonResOutputs.findIndex((p) => p.id === portId);
  if (outIdx !== -1)
    return { x: NODE_WIDTH, y: PORT_TOP + outIdx * PORT_GAP };

  const resIdx = resOutputs.findIndex((p) => p.id === portId);
  if (resIdx !== -1) {
    const mainCount = Math.max(inputs.length, nonResOutputs.length, 1);
    const mainBottom = PORT_TOP + (mainCount - 1) * PORT_GAP + 28;
    const spacing = NODE_WIDTH / (resOutputs.length + 1);
    // Y at the bottom edge of the node, matching the CSS port position
    const bottomY = mainBottom + 34;
    return { x: spacing * (resIdx + 1), y: bottomY };
  }
  return null;
}

function portCanvasPos(
  node: WorkflowNode,
  portId: string,
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  profiles: Profile[],
): { x: number; y: number } | null {
  const off = portOffset(node, portId, edges, nodes, profiles);
  if (!off) return null;
  return { x: node.position.x + off.x, y: node.position.y + off.y };
}

// ============================================================================
// BEZIER PATH
// ============================================================================

function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  return `M ${sx} ${sy} C ${sx + BEZIER_OFFSET} ${sy}, ${tx - BEZIER_OFFSET} ${ty}, ${tx} ${ty}`;
}

function bezierPoint(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  t: number,
) {
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

function pointNearTail(
  px: number,
  py: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  threshold: number,
): boolean {
  for (let t = 1 - TAIL_HIT_PCT; t <= 1; t += 0.02) {
    const pt = bezierPoint(sx, sy, tx, ty, t);
    if (Math.hypot(px - pt.x, py - pt.y) < threshold) return true;
  }
  return false;
}

// ============================================================================
// NODE HEIGHT
// ============================================================================

function getPreviewText(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  profiles: Profile[],
): string {
  const ports = getNodePorts(node, edges, nodes, profiles);
  const inputs = ports.filter((p) => p.side === 'input');

  switch (node.type) {
    case 'profile': {
      const d = node.data as ProfileData;
      return d.profileId
        ? (profiles.find((p) => p.id === d.profileId)?.name ?? 'Unknown profile')
        : 'No profile selected';
    }
    case 'profile-cache': {
      const wired = edges
        .filter(
          (e) => e.target === node.id && e.targetPort.startsWith('in-profile-'),
        )
        .sort((a, b) => {
          const ai = parseInt(a.targetPort.replace('in-profile-', ''), 10);
          const bi = parseInt(b.targetPort.replace('in-profile-', ''), 10);
          return ai - bi;
        });
      if (wired.length === 0) return 'No profiles connected';
      const names = wired.map((e) => {
        const src = nodes.find((n) => n.id === e.source);
        if (src?.type === 'profile') {
          const d = src.data as ProfileData;
          if (d.profileId) {
            return (
              profiles.find((p) => p.id === d.profileId)?.name ??
              'Unknown profile'
            );
          }
          return 'No profile selected';
        }
        return 'Invalid source';
      });
      return names.map((n) => `• ${n}`).join('\n');
    }
    case 'text-data': {
      const v = (node.data as TextDataData).value;
      return v
        ? `"${v.slice(0, 40)}${v.length > 40 ? '…' : ''}"`
        : 'No value set';
    }
    case 'server': {
      const directEdge = edges.find(
        (e) => e.target === node.id && e.targetPort === 'in-profile',
      );
      const cacheEdge = edges.find(
        (e) => e.target === node.id && e.targetPort === 'in-profile-cache',
      );
      const names: string[] = [];
      if (directEdge) {
        const src = nodes.find((n) => n.id === directEdge.source);
        if (src?.type === 'profile') {
          const d = src.data as ProfileData;
          names.push(
            d.profileId
              ? (profiles.find((p) => p.id === d.profileId)?.name ??
                  'Unknown profile')
              : 'No profile selected',
          );
        }
      }
      if (cacheEdge) {
        const cacheNode = nodes.find((n) => n.id === cacheEdge.source);
        if (cacheNode?.type === 'profile-cache') {
          const cachePorts = getNodePorts(cacheNode, edges, nodes, profiles);
          cachePorts
            .filter((p) => p.side === 'input' && p.type === 'profile')
            .forEach((p) => {
              const we = edges.find(
                (e) => e.target === cacheNode.id && e.targetPort === p.id,
              );
              if (we) {
                const src = nodes.find((n) => n.id === we.source);
                if (src?.type === 'profile') {
                  const d = src.data as ProfileData;
                  names.push(
                    d.profileId
                      ? (profiles.find((pr) => pr.id === d.profileId)?.name ??
                          'Unknown profile')
                      : 'No profile selected',
                  );
                }
              }
            });
        }
      }
      return names.length > 0
        ? names.map((n) => `• ${n}`).join('\n')
        : 'No profile';
    }
    case 'input-text': {
      const q = (node.data as InputTextData).question;
      return q
        ? `"${q.slice(0, 40)}${q.length > 40 ? '…' : ''}"`
        : 'No question set';
    }
    case 'agent': {
      const d = node.data as AgentData;
      const labels: string[] = [];

      for (const p of inputs) {
        if (['in-continue', 'in-server', 'in-profile-0'].includes(p.id))
          continue;
        const edge = edges.find(
          (e) => e.target === node.id && e.targetPort === p.id,
        );
        if (!edge) continue;
        const src = nodes.find((n) => n.id === edge.source);
        labels.push(`• ${src?.label || 'Unknown'}`);
      }

      const profileEdge = edges.find(
        (e) => e.target === node.id && e.targetPort === 'in-profile-0',
      );
      if (profileEdge) {
        const src = nodes.find((n) => n.id === profileEdge.source);
        if (src?.type === 'server') {
          const serverPorts = getNodePorts(src, edges, nodes, profiles);
          const portDef = serverPorts.find(
            (p) => p.id === profileEdge.sourcePort,
          );
          labels.push(`• ${portDef?.label || src.label}`);
        } else {
          labels.push(`• ${src?.label || 'Unknown'}`);
        }
      }

      if (!profileEdge) {
        const serverEdge = edges.find(
          (e) => e.target === node.id && e.targetPort === 'in-server',
        );
        if (serverEdge) {
          const serverNode = nodes.find((n) => n.id === serverEdge.source);
          if (serverNode?.type === 'server') {
            const serverPorts = getNodePorts(
              serverNode,
              edges,
              nodes,
              profiles,
            );
            const profileOutputs = serverPorts.filter(
              (p) => p.side === 'output' && p.type === 'server-profile',
            );
            if (profileOutputs.length === 1) {
              labels.push(`• ${profileOutputs[0].label}`);
            }
          }
        }
      }

      // Connected resource outputs
      const resourceEdges = edges
        .filter(
          (e) =>
            e.source === node.id &&
            e.sourcePort.startsWith('out-resource-'),
        )
        .sort((a, b) => {
          const ai = parseInt(
            a.sourcePort.replace('out-resource-', ''),
            10,
          );
          const bi = parseInt(
            b.sourcePort.replace('out-resource-', ''),
            10,
          );
          return ai - bi;
        });
      if (resourceEdges.length > 0) {
        labels.push('• Resources:');
        resourceEdges.forEach((e, i) => {
          const tgt = nodes.find((n) => n.id === e.target);
          labels.push(`\u00A0\u00A0\u00A0${i + 1}. ${tgt?.label || 'Unknown'}`); // HACK: non-breaking spaces for indent
        });
      }

      return labels.length > 0
        ? labels.join('\n')
        : d.prompt
          ? d.prompt.slice(0, 44) + (d.prompt.length > 44 ? '…' : '')
          : 'No prompt hint';
    }
    case 'write-text': {
      const d = node.data as WriteTextData;
      return d.description || 'No description';
    }
    case 'edit-text': {
      const d = node.data as EditTextData;
      return d.instruction || 'No instruction';
    }
    case 'decide-if': {
      const d = node.data as DecideIfData;
      return d.condition || 'No condition set';
    }
    case 'profile-load':
      return 'Load profile into server';
    case 'profile-unload':
      return 'Unload profile from server';
    case 'end':
      return 'Terminates workflow';
    case 'comment':
      return (node.data as CommentData).text || 'Empty comment';
    default:
      return '';
  }
}

function estimatePreviewHeight(preview: string): number {
  if (!preview) return 0;
  const CHARS_PER_LINE = 32;
  const LINE_HEIGHT = 15.4;
  const PADDING = 14;
  let lines = 0;
  for (const segment of preview.split('\n')) {
    lines += Math.max(1, Math.ceil(segment.length / CHARS_PER_LINE));
  }
  return Math.round(lines * LINE_HEIGHT + PADDING);
}

const HEADER_HEIGHT = 36;

function nodeHeight(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  profiles: Profile[],
): number {
  const ports = getNodePorts(node, edges, nodes, profiles);
  const inputs = ports.filter((p) => p.side === 'input').length;
  const outputs = ports.filter((p) => p.side === 'output');
  const resCount = outputs.filter((p) => p.id.startsWith('out-resource-')).length;
  const regOutputs = outputs.length - resCount;
  const maxPorts = Math.max(inputs, regOutputs, 1);
  let base = PORT_TOP + (maxPorts - 1) * PORT_GAP + 28;
  if (resCount > 0) base += 34;
  const preview = getPreviewText(node, edges, nodes, profiles);
  if (!preview) return base;
  const naturalBody = base - HEADER_HEIGHT;
  const needed = estimatePreviewHeight(preview);
  return needed > naturalBody ? base + (needed - naturalBody) : base;
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
  onColorChange: (id: string, color: string) => void;
  onReorder: (ids: string[]) => void;
}
function WorkflowGrid({
  workflows,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onIconChange,
  onColorChange,
  onReorder,
}: WorkflowGridProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    setDragOverIndex(idx);
  };
  const handleDragLeave = () => {
    setDragOverIndex(null);
  };
  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIdx) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const ids = workflows.map((w) => w.id);
    const [moved] = ids.splice(dragIndex, 1);
    ids.splice(dropIdx, 0, moved);
    onReorder(ids);
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

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
          <GitBranchPlus size={16} /> New Workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="wf-empty">
          <GitBranch size={48} className="wf-empty__icon" />
          <h2>No workflows yet</h2>
          <p>Create your first workflow to start building agent pipelines.</p>
          <button type="button" className="btn-accent" onClick={onCreate}>
            <GitBranchPlus size={16} /> New Workflow
          </button>
        </div>
      ) : (
        <div className="wf-grid">
          {workflows.map((wf, idx) => {
            const WfIcon = resolveIcon(wf.icon);
            const isDragging = dragIndex === idx;
            const isDragOver = dragOverIndex === idx && dragIndex !== idx;
            return (
              <div
                key={wf.id}
                className={[
                  'wf-card',
                  isDragging ? 'wf-card--dragging' : '',
                  isDragOver ? 'wf-card--drag-over' : '',
                ].join(' ')}
                draggable={renamingId !== wf.id}
                onClick={() => renamingId !== wf.id && onOpen(wf.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renamingId !== wf.id) onOpen(wf.id);
                }}
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                <div className="wf-card__top">
                  <div className="wf-card__top-left">
                    <button
                      type="button"
                      className="wf-card__icon-wrap"
                      title="Change icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIconPickerId(wf.id);
                      }}
                      style={
                        { '--wf-icon-color': wf.color } as React.CSSProperties
                      }
                    >
                      <WfIcon size={20} />
                    </button>
                  </div>
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
                  <button type="button" className="wf-card__run-btn">
                    <Play size={13} /> Start
                  </button>
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
          currentColor={pickerWorkflow.color}
          onSelect={(name) => {
            onIconChange(iconPickerId, name);
            setIconPickerId(null);
          }}
          onColorSelect={(color) => {
            onColorChange(iconPickerId, color);
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
  profilePortWired: boolean;
  profileCachePortWired: boolean;
  textPortWired: boolean;
}
function NodeConfigPanel({
  node,
  profiles,
  onChange,
  onDelete,
  onClose,
  profilePortWired,
  profileCachePortWired,
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

        {/* ── PROFILE ── */}
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

        {/* ── TEXT DATA ── */}
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

        {/* ── SERVER ── */}
        {node.type === 'server' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Profile source
              {(profilePortWired || profileCachePortWired) && (
                <span className="wf-config-field__wired-badge">wired</span>
              )}
            </label>
            {profilePortWired && (
              <div className="wf-config-field__disabled-row">
                <span className="wf-config-field__disabled-text">
                  Set by connected Profile node
                </span>
                <X size={13} className="wf-config-field__disabled-icon" />
              </div>
            )}
            {profileCachePortWired && (
              <div className="wf-config-field__disabled-row">
                <span className="wf-config-field__disabled-text">
                  Set by connected Profile Cache node
                </span>
                <X size={13} className="wf-config-field__disabled-icon" />
              </div>
            )}
            {!profilePortWired &&
              !profileCachePortWired &&
              (profiles.length === 0 ? (
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
              ))}
            {profilePortWired && profileCachePortWired && (
              <p className="wf-config-field__hint wf-config-field__hint--warn">
                ⚠ Both profile and profile-cache are wired — only one should be
                connected.
              </p>
            )}
          </div>
        )}

        {/* ── INPUT TEXT ── */}
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

        {/* ── AGENT ── */}
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

        {/* ── WRITE TEXT (tool) ── */}
        {node.type === 'write-text' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Description{' '}
              <span className="wf-config-field__optional">(optional)</span>
            </label>
            <textarea
              className="wf-config-field__textarea"
              rows={3}
              value={(node.data as WriteTextData).description}
              onChange={(e) =>
                patchData({
                  description: e.target.value,
                } as Partial<WriteTextData>)
              }
              placeholder="Describe what the agent should write…"
            />
          </div>
        )}

        {/* ── EDIT TEXT (tool) ── */}
        {node.type === 'edit-text' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Instruction{' '}
              <span className="wf-config-field__optional">(optional)</span>
            </label>
            <textarea
              className="wf-config-field__textarea"
              rows={3}
              value={(node.data as EditTextData).instruction}
              onChange={(e) =>
                patchData({
                  instruction: e.target.value,
                } as Partial<EditTextData>)
              }
              placeholder="Describe how the text should be edited…"
            />
          </div>
        )}

        {/* ── DECIDE IF (tool) ── */}
        {node.type === 'decide-if' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">
              Condition{' '}
              <span className="wf-config-field__optional">(optional)</span>
            </label>
            <textarea
              className="wf-config-field__textarea"
              rows={3}
              value={(node.data as DecideIfData).condition}
              onChange={(e) =>
                patchData({
                  condition: e.target.value,
                } as Partial<DecideIfData>)
              }
              placeholder="Describe the condition to evaluate…"
            />
            <p className="wf-config-field__hint">
              The agent evaluates this condition and routes to the{' '}
              <strong>true</strong> or <strong>false</strong> continue output.
            </p>
          </div>
        )}

        {/* ── COMMENT ── */}
        {node.type === 'comment' && (
          <div className="wf-config-field">
            <label className="wf-config-field__label">Comment</label>
            <textarea
              className="wf-config-field__textarea"
              rows={4}
              value={(node.data as CommentData).text}
              onChange={(e) =>
                patchData({ text: e.target.value } as Partial<CommentData>)
              }
              placeholder="Write a comment…"
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
          <Trash2 size={13} /> Delete Node
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
  { label: 'Input', types: ['start', 'input-text', 'end'] },
  {
    label: 'Models',
    types: ['server', 'agent', 'profile-load', 'profile-unload'],
  },
  { label: 'Data', types: ['profile', 'profile-cache', 'text-data', 'comment'] },
  { label: 'Tools', types: ['write-text', 'edit-text', 'decide-if'] },
  {
    label: 'Files',
    types: ['write-file', 'read-file', 'edit-file', 'delete-file'],
  },
];

const NODE_HINTS: Record<NodeType, string> = {
  start: 'Entry point — outputs continue',
  profile: 'Provides a profile object',
  'profile-cache': 'Merges multiple profiles into one cache',
  'text-data': 'Provides a static text value',
  server: 'Starts a model server',
  'input-text': 'Prompts user for text input',
  agent: 'Runs a prompt on a server',
  'write-text': 'Agent tool — writes new text',
  'edit-text': 'Agent tool — edits existing text',
  'decide-if': 'Agent tool — branches on condition',
  'write-file': 'Writes content to a file',
  'read-file': 'Reads content from a file',
  'edit-file': 'Applies edits object to a file',
  'delete-file': 'Deletes a file by name',
  'profile-load': 'Loads a profile into a server',
  'profile-unload': 'Unloads a profile from a server',
  end: 'Terminates a workflow path',
  comment: 'Annotation — no inputs or outputs',
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
        <Unlink size={11} /> Drag onto canvas
      </div>
    </div>
  );
}

// ============================================================================
// CANVAS NODE
// ============================================================================

interface CanvasNodeProps {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isSelected: boolean;
  compatibleInputPorts: Set<string>;
  compatibleInputPortsForReconnect: Set<string>;
  snapTargetPort: string | null;
  profiles: Profile[];
  connectedPorts: Set<string>;
  disabledInputPorts: Set<string>;
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
  nodes,
  edges,
  isSelected,
  compatibleInputPorts,
  compatibleInputPortsForReconnect,
  snapTargetPort,
  profiles,
  connectedPorts,
  disabledInputPorts,
  onNodeMouseDown,
  onPortMouseDown,
  onPortMouseUp,
  onPortClick,
}: CanvasNodeProps) {
  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const ports = getNodePorts(node, edges, nodes, profiles);
  const inputs = ports.filter((p) => p.side === 'input');
  const outputs = ports.filter((p) => p.side === 'output');
  const resources = outputs.filter((p) => p.id.startsWith('out-resource-'));
  const regularOutputs = outputs.filter((p) => !p.id.startsWith('out-resource-'));
  const h = nodeHeight(node, edges, nodes, profiles);

  // Preview text
  const preview = getPreviewText(node, edges, nodes, profiles);

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
      <div
        className="wf-node__header"
        style={{ '--node-color': meta.colorVar } as React.CSSProperties}
      >
        <div className="wf-node__header-icon">
          <Icon size={13} />
        </div>
        <span className="wf-node__header-label">{node.label}</span>
        {/* Category badge for Tools/Files */}
        {(meta.category === 'Tools' || meta.category === 'Files') && (
          <span className="wf-node__category-badge">
            {meta.category === 'Tools' ? (
              <Wrench size={9} />
            ) : (
              <Layers size={9} />
            )}
          </span>
        )}
      </div>

      {preview && (
        <div className="wf-node__body">
          <span
            className={`wf-node__preview${!preview || preview.startsWith('No ') ? ' wf-node__preview--empty' : ''}`}
          >
            {preview}
          </span>
        </div>
      )}

      {inputs.map((port, idx) => {
        const portKey = `${node.id}:${port.id}`;
        const isSnap = snapTargetPort === portKey;
        const isComp =
          compatibleInputPorts.has(portKey) ||
          compatibleInputPortsForReconnect.has(portKey);
        const isConnected = connectedPorts.has(portKey);
        const isDisabled = disabledInputPorts.has(portKey);
        return (
          <div
            key={port.id}
            className={[
              'wf-port',
              'wf-port--input',
              isComp ? 'wf-port--compatible' : '',
              isSnap ? 'wf-port--snap' : '',
              isConnected ? 'wf-port--connected' : '',
              isDisabled ? 'wf-port--disabled' : '',
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
              if (!isDisabled) onPortMouseDown(e, node.id, port.id, 'input');
            }}
            onMouseUp={(e) => {
              e.stopPropagation();
              if (!isDisabled) onPortMouseUp(e, node.id, port.id);
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

      {regularOutputs.map((port, idx) => {
        const portKey = `${node.id}:${port.id}`;
        const isConnected = connectedPorts.has(portKey);
        return (
          <div
            key={port.id}
            className={[
              'wf-port',
              'wf-port--output',
              isConnected ? 'wf-port--connected' : '',
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
        );
      })}

      {resources.length > 0 && (
        <div className="wf-node__resources">
          {resources.map((port, idx) => {
            const portKey = `${node.id}:${port.id}`;
            const isConnectedRes = connectedPorts.has(portKey);
            return (
              <div
                key={port.id}
                className={[
                  'wf-port',
                  'wf-port--resource',
                  isConnectedRes ? 'wf-port--connected' : '',
                ].join(' ')}
                style={
                  {
                    left: `${((idx + 1) / (resources.length + 1)) * 100}%`,
                    '--port-color': PORT_TYPE_COLOR[port.type],
                  } as React.CSSProperties
                }
                title={port.label}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onPortMouseDown(e, node.id, port.id, 'output');
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
                <span className="wf-port__label wf-port__label--bottom">
                  {port.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
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
interface ConnectState {
  sourceNodeId: string;
  sourcePortId: string;
  sourcePortType: PortType;
  mouseCanvas: { x: number; y: number };
}
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
  const [panOffset, setPanOffset] = useState({ x: 80, y: 80 });
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [panning, setPanning] = useState<PanState | null>(null);
  const [connecting, setConnecting] = useState<ConnectState | null>(null);
  const [reconnecting, setReconnecting] = useState<ReconnectState | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [snapTarget, setSnapTarget] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(workflow.name);
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = Date.now();
    setToast({ message, id });
    toastTimer.current = setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 3000);
  }, []);

  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const scrollVelRef = useRef({ x: 0, y: 0 });
  const scrollAccumRef = useRef({ x: 0, y: 0 });

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
          commit(
            nodes.filter((n) => !ids.has(n.id)),
            edges.filter((ed) => !ids.has(ed.source) && !ids.has(ed.target)),
          );
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

  // ── Zoom ─────────────────────────────────────────────────────────────────
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

  // ── Continuous scroll loop ─────────────────────────────────────────────────
  const scrollLoopActive = !!(connecting || reconnecting || dragging);
  useEffect(() => {
    if (!scrollLoopActive) return;
    const id = window.setInterval(() => {
      const { x: sx, y: sy } = scrollVelRef.current;
      if (sx === 0 && sy === 0) return;
      setTransform((prev) => ({ ...prev, x: prev.x + sx, y: prev.y + sy }));
      scrollAccumRef.current.x += sx;
      scrollAccumRef.current.y += sy;
    }, 16);
    return () => {
      clearInterval(id);
      scrollAccumRef.current = { x: 0, y: 0 };
    };
  }, [scrollLoopActive]);

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
      let dx = e.clientX - dragging.startMouse.x;
      let dy = e.clientY - dragging.startMouse.y;
      const rect = canvasRef.current!.getBoundingClientRect();
      let scrollX = 0;
      let scrollY = 0;
      if (e.clientX - rect.left < scrollThreshold()) scrollX = SCROLL_SPEED;
      if (rect.right - e.clientX < scrollThreshold()) scrollX = -SCROLL_SPEED;
      if (e.clientY - rect.top < scrollThreshold()) scrollY = SCROLL_SPEED;
      if (rect.bottom - e.clientY < scrollThreshold()) scrollY = -SCROLL_SPEED;
      if (scrollX !== 0 || scrollY !== 0) {
        scrollVelRef.current = { x: scrollX, y: scrollY };
        setTransform((prev) => ({
          ...prev,
          x: prev.x + scrollX,
          y: prev.y + scrollY,
        }));
        setDragging((p) =>
          p
            ? {
                ...p,
                startMouse: {
                  x: p.startMouse.x + scrollX,
                  y: p.startMouse.y + scrollY,
                },
              }
            : null,
        );
        dx -= scrollX;
        dy -= scrollY;
      } else {
        scrollVelRef.current = { x: 0, y: 0 };
      }
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        setDragging((p) => (p ? { ...p, didMove: true } : null));
        setNodes((prev) =>
          prev.map((n) =>
            n.id === dragging.nodeId
              ? {
                  ...n,
                  position: {
                    x: snapG(
                      dragging.startPos.x +
                        (dx - scrollAccumRef.current.x) / transform.scale,
                    ),
                    y: snapG(
                      dragging.startPos.y +
                        (dy - scrollAccumRef.current.y) / transform.scale,
                    ),
                  },
                }
              : n,
          ),
        );
      }
    };
    const onUp = (e: MouseEvent) => {
      const paletteEl =
        canvasRef.current?.parentElement?.querySelector('.wf-palette');
      const overPalette = paletteEl
        ? e.clientX >= paletteEl.getBoundingClientRect().left &&
          e.clientX <= paletteEl.getBoundingClientRect().right &&
          e.clientY >= paletteEl.getBoundingClientRect().top &&
          e.clientY <= paletteEl.getBoundingClientRect().bottom
        : false;
      setDragging((p) => {
        if (!p) return null;
        if (!p.didMove) {
          if (e.shiftKey) {
            setSelectedNodeIds((prev) => {
              const next = new Set(prev);
              next.has(p.nodeId) ? next.delete(p.nodeId) : next.add(p.nodeId);
              return next;
            });
          } else {
            setSelectedNodeIds(new Set([p.nodeId]));
          }
        } else if (overPalette) {
          const filteredNodes = nodes.filter((n) => n.id !== p.nodeId);
          const filteredEdges = edges.filter(
            (ed) => ed.source !== p.nodeId && ed.target !== p.nodeId,
          );
          commit(filteredNodes, filteredEdges);
          setSelectedNodeIds((prev) => {
            const next = new Set(prev);
            next.delete(p.nodeId);
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

  // ── Port interaction ──────────────────────────────────────────────────────
  const connectedPorts = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      set.add(`${e.source}:${e.sourcePort}`);
      set.add(`${e.target}:${e.targetPort}`);
    }
    return set;
  }, [edges]);

  const disabledInputPorts = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.type === 'server') {
        const data = n.data as ServerData;
        const hasProfile = data.profileId != null;
        const profileWired = edges.some(
          (e) => e.target === n.id && e.targetPort === 'in-profile',
        );
        const cacheWired = edges.some(
          (e) => e.target === n.id && e.targetPort === 'in-profile-cache',
        );
        if (hasProfile || cacheWired) set.add(`${n.id}:in-profile`);
        if (hasProfile || profileWired) set.add(`${n.id}:in-profile-cache`);
      }
    }
    return set;
  }, [nodes, edges]);

  const compatiblePorts = useCallback(
    (outputType: PortType): Set<string> => {
      const result = new Set<string>();
      for (const n of nodes) {
        for (const p of getNodePorts(n, edges, nodes, profiles)) {
          if (p.side === 'input' && portsCompatible(outputType, p.type)) {
            const key = `${n.id}:${p.id}`;
            if (!disabledInputPorts.has(key)) result.add(key);
          }
        }
      }
      return result;
    },
    [nodes, edges, profiles, disabledInputPorts],
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
      const portDef = getNodePorts(
        nodes.find((n) => n.id === nodeId)!,
        edges,
        nodes,
        profiles,
      ).find((p) => p.id === portId)!;
      setConnecting({
        sourceNodeId: nodeId,
        sourcePortId: portId,
        sourcePortType: portDef.type,
        mouseCanvas: screenToCanvas(e.clientX, e.clientY),
      });
      setSelectedEdgeId(null);
      setSelectedNodeIds(new Set());
    }
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
      if (nodeId === sourceNodeId) return;
      const portDef = getNodePorts(
        nodes.find((n) => n.id === nodeId)!,
        edges,
        nodes,
        profiles,
      ).find((p) => p.id === portId);
      if (!portDef || portDef.side !== 'input') {
        showToast(
          !portDef
            ? 'Cannot connect: invalid port'
            : 'Cannot connect: both ports are outputs',
        );
        return;
      }
      if (!portsCompatible(sourcePortType, portDef.type)) {
        showToast('Cannot connect: incompatible port types');
        return;
      }
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
      const withoutOriginal = edges.filter((ed) => ed.id !== edgeId);
      if (nodeId === sourceNodeId) {
        commit(nodes, withoutOriginal);
        return;
      }
      const portDef = getNodePorts(
        nodes.find((n) => n.id === nodeId)!,
        edges,
        nodes,
        profiles,
      ).find((p) => p.id === portId);
      if (!portDef || portDef.side !== 'input') {
        showToast(
          !portDef
            ? 'Cannot connect: invalid port'
            : 'Cannot connect: both ports are outputs',
        );
        commit(nodes, withoutOriginal);
        return;
      }
      if (!portsCompatible(sourcePortType, portDef.type)) {
        showToast('Cannot connect: incompatible port types');
        commit(nodes, withoutOriginal);
        return;
      }
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
    const inbound = edges.filter(
      (ed) => ed.target === nodeId && ed.targetPort === portId,
    );
    if (inbound.length === 0) return;
    const currentIdx = inbound.findIndex((ed) => ed.id === selectedEdgeId);
    setSelectedEdgeId(inbound[(currentIdx + 1) % inbound.length].id);
    setSelectedNodeIds(new Set());
  };

  // ── Connection mousemove ──────────────────────────────────────────────────
  useEffect(() => {
    if (!connecting && !reconnecting) return;
    const onMove = (e: MouseEvent) => {
      const pos = screenToCanvas(e.clientX, e.clientY);
      const rect = canvasRef.current!.getBoundingClientRect();
      let scrollX = 0;
      let scrollY = 0;
      if (e.clientX - rect.left < scrollThreshold()) scrollX = SCROLL_SPEED;
      if (rect.right - e.clientX < scrollThreshold()) scrollX = -SCROLL_SPEED;
      if (e.clientY - rect.top < scrollThreshold()) scrollY = SCROLL_SPEED;
      if (rect.bottom - e.clientY < scrollThreshold()) scrollY = -SCROLL_SPEED;
      if (scrollX !== 0 || scrollY !== 0) {
        scrollVelRef.current = { x: scrollX, y: scrollY };
        setTransform((prev) => ({
          ...prev,
          x: prev.x + scrollX,
          y: prev.y + scrollY,
        }));
        pos.x -= scrollX / transform.scale;
        pos.y -= scrollY / transform.scale;
      } else {
        scrollVelRef.current = { x: 0, y: 0 };
      }
      if (connecting)
        setConnecting((p) => (p ? { ...p, mouseCanvas: pos } : null));
      if (reconnecting)
        setReconnecting((p) => (p ? { ...p, mouseCanvas: pos } : null));
      const portType =
        connecting?.sourcePortType ?? reconnecting?.sourcePortType;
      if (!portType) return;
      let found: string | null = null;
      outer: for (const n of nodes) {
        for (const port of getNodePorts(n, edges, nodes, profiles)) {
          if (port.side !== 'input' || !portsCompatible(portType, port.type))
            continue;
          const cp = portCanvasPos(n, port.id, edges, nodes, profiles);
          if (!cp) continue;
          if (Math.hypot(pos.x - cp.x, pos.y - cp.y) < 20 / transform.scale) {
            found = `${n.id}:${port.id}`;
            break outer;
          }
        }
      }
      setSnapTarget(found);
    };
    const onUp = () => {
      if (connecting) {
        setConnecting(null);
        setSnapTarget(null);
      }
      if (reconnecting) {
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
  }, [connecting, reconnecting, nodes, edges, screenToCanvas, transform.scale]);

  // ── Palette drag/drop ─────────────────────────────────────────────────────
  const onPaletteDragStart = (e: React.DragEvent, type: NodeType) =>
    e.dataTransfer.setData('nodeType', type);
  const onCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('nodeType') as NodeType;
    if (!type || !NODE_META[type]) return;
    const pos = screenToCanvas(e.clientX, e.clientY);
    const tempNode = makeNode(type, 0, 0);
    const node = makeNode(
      type,
      pos.x - NODE_WIDTH / 2,
      pos.y - nodeHeight(tempNode, edges, nodes, profiles) / 2,
    );
    commit([...nodes, node], edges);
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeId(null);
  };

  // ── Delete / patch helpers ────────────────────────────────────────────────
  const deleteNode = useCallback(
    (id: string) => {
      commit(
        nodes.filter((n) => n.id !== id),
        edges.filter((ed) => ed.source !== id && ed.target !== id),
      );
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

  // ── Edge click / reconnect ────────────────────────────────────────────────
  const onEdgeClick = (
    e: ReactMouseEvent,
    edgeId: string,
    isTail: boolean,
    mouseCanvasPos: { x: number; y: number },
  ) => {
    e.stopPropagation();
    if (isTail) {
      const edge = edges.find((ed) => ed.id === edgeId)!;
      const srcNode = nodes.find((n) => n.id === edge.source)!;
      const portDef = getNodePorts(srcNode, edges, nodes, profiles).find(
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

  const edgeEndpoints = (edge: WorkflowEdge) => {
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    if (!src || !tgt) return null;
    const s = portCanvasPos(src, edge.sourcePort, edges, nodes, profiles);
    const t = portCanvasPos(tgt, edge.targetPort, edges, nodes, profiles);
    if (!s || !t) return null;
    return { s, t };
  };

  // ── Wire in progress ──────────────────────────────────────────────────────
  const wireSource = connecting
    ? portCanvasPos(
        nodes.find((n) => n.id === connecting.sourceNodeId)!,
        connecting.sourcePortId,
        edges,
        nodes,
        profiles,
      )
    : reconnecting
      ? portCanvasPos(
          nodes.find((n) => n.id === reconnecting.sourceNodeId)!,
          reconnecting.sourcePortId,
          edges,
          nodes,
          profiles,
        )
      : null;
  const wireMouse =
    connecting?.mouseCanvas ?? reconnecting?.mouseCanvas ?? null;
  const wirePortType =
    connecting?.sourcePortType ?? reconnecting?.sourcePortType ?? null;

  // ── Compatible port sets ──────────────────────────────────────────────────
  const activeCompatPorts = useMemo((): Set<string> => {
    if (!connecting && !reconnecting) return new Set();
    const type = connecting?.sourcePortType ?? reconnecting?.sourcePortType;
    if (!type) return new Set();
    return compatiblePorts(type);
  }, [connecting, reconnecting, compatiblePorts]);

  // ── Dot grid ──────────────────────────────────────────────────────────────
  const dotBgX = ((panOffset.x % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
  const dotBgY = ((panOffset.y % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;

  // ── Single-selected node (config panel) ──────────────────────────────────
  const singleSelected =
    selectedNodeIds.size === 1
      ? (nodes.find((n) => n.id === [...selectedNodeIds][0]) ?? null)
      : null;

  const profilePortWired = useMemo(
    () =>
      !!(
        singleSelected?.type === 'server' &&
        edges.some(
          (ed) =>
            ed.target === singleSelected.id && ed.targetPort === 'in-profile',
        )
      ),
    [singleSelected, edges],
  );

  const profileCachePortWired = useMemo(
    () =>
      !!(
        singleSelected?.type === 'server' &&
        edges.some(
          (ed) =>
            ed.target === singleSelected.id &&
            ed.targetPort === 'in-profile-cache',
        )
      ),
    [singleSelected, edges],
  );

  const textPortWired = useMemo(
    () =>
      !!(
        singleSelected?.type === 'input-text' &&
        edges.some(
          (ed) =>
            ed.target === singleSelected.id && ed.targetPort === 'in-text',
        )
      ),
    [singleSelected, edges],
  );

  // ── Edge rendering ────────────────────────────────────────────────────────
  const nonSelectedEdges = edges.filter((ed) => ed.id !== selectedEdgeId);
  const selectedEdge = edges.find((ed) => ed.id === selectedEdgeId);

  const renderEdge = (edge: WorkflowEdge, isSelected: boolean) => {
    const ep = edgeEndpoints(edge);
    if (!ep) return null;
    const { s, t } = ep;
    const isHov = hoveredEdgeId === edge.id;
    const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };

    const srcNode = nodes.find((n) => n.id === edge.source);
    const portDef = srcNode
      ? getNodePorts(srcNode, edges, nodes, profiles).find(
          (p) => p.id === edge.sourcePort,
        )
      : undefined;
    const edgeColor = portDef ? PORT_TYPE_COLOR[portDef.type] : undefined;

    const arrowFill = isSelected
      ? '#f38ba8'
      : isHov
        ? 'var(--accent)'
        : edgeColor || 'var(--text-secondary)';

    const onMouseDown = (e: ReactMouseEvent<SVGElement>, isTail: boolean) =>
      onEdgeClick(e, edge.id, isTail, screenToCanvas(e.clientX, e.clientY));

    return (
      <g key={edge.id}>
        <path
          d={bezierPath(s.x, s.y, t.x, t.y)}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredEdgeId(edge.id)}
          onMouseLeave={() => setHoveredEdgeId(null)}
          onMouseDown={(e) => {
            const cp = screenToCanvas(e.clientX, e.clientY);
            onMouseDown(
              e,
              pointNearTail(
                cp.x,
                cp.y,
                s.x,
                s.y,
                t.x,
                t.y,
                14 / transform.scale,
              ),
            );
          }}
        />
        <path
          d={bezierPath(s.x, s.y, t.x, t.y)}
          fill="none"
          className={`wf-edge${isSelected ? ' wf-edge--selected' : isHov ? ' wf-edge--hovered' : ''}`}
          style={{
            pointerEvents: 'none',
            stroke: !isSelected && !isHov && edgeColor ? edgeColor : undefined,
          }}
        />
        {/* Inline arrowhead — original 8×6 marker size */}
        <polygon
          points={`${t.x - 8},${t.y - 3} ${t.x},${t.y} ${t.x - 8},${t.y + 3}`}
          fill={arrowFill}
          className="wf-edge__arrowhead"
          style={{ pointerEvents: 'none' }}
        />
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
          onMouseEnter={() => setHoveredEdgeId(edge.id)}
          onMouseLeave={() => setHoveredEdgeId(null)}
          onMouseDown={(e) => onMouseDown(e, true)}
          style={{ cursor: 'crosshair' }}
        />
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
          <ChevronLeft size={15} /> Workflows
        </button>

        {editingName ? (
          <input
            ref={nameInputRef}
            className="wf-toolbar__name-input"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => {
              setEditingName(false);
              if (nameValue.trim() && nameValue.trim() !== workflow.name)
                onRename(workflow.id, nameValue.trim());
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
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="wf-editor__body">
        <NodePalette onDragStart={onPaletteDragStart} />

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
            <svg className="wf-canvas__svg" overflow="visible">
              {nonSelectedEdges.map((ed) => renderEdge(ed, false))}
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

            {nodes.map((node) => {
              const nodeKey = `${node.id}:`;
              const nodeCompatPorts = new Set(
                [...activeCompatPorts].filter((k) => k.startsWith(nodeKey)),
              );
              return (
                <CanvasNode
                  key={node.id}
                  node={node}
                  nodes={nodes}
                  edges={edges}
                  isSelected={selectedNodeIds.has(node.id)}
                  compatibleInputPorts={
                    connecting ? nodeCompatPorts : new Set()
                  }
                  compatibleInputPortsForReconnect={
                    reconnecting ? nodeCompatPorts : new Set()
                  }
                  snapTargetPort={snapTarget}
                  profiles={profiles}
                  connectedPorts={connectedPorts}
                  disabledInputPorts={disabledInputPorts}
                  onNodeMouseDown={onNodeMouseDown}
                  onPortMouseDown={onPortMouseDown}
                  onPortMouseUp={onPortMouseUp}
                  onPortClick={onPortClick}
                />
              );
            })}

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

        {singleSelected && NODE_META[singleSelected.type].hasConfig && (
          <NodeConfigPanel
            node={singleSelected}
            profiles={profiles}
            onChange={patchNode}
            onDelete={deleteNode}
            onClose={() => setSelectedNodeIds(new Set())}
            profilePortWired={profilePortWired}
            profileCachePortWired={profileCachePortWired}
            textPortWired={textPortWired}
          />
        )}
      </div>

      <div className="wf-hint">
        <kbd>Del</kbd> Delete <span className="wf-hint__sep" />
        <kbd>Shift + Click</kbd> Multi-Select <span className="wf-hint__sep" />
        <kbd>Ctrl A</kbd> Select All <span className="wf-hint__sep" />
        <kbd>Ctrl Z</kbd> Undo <span className="wf-hint__sep" />
      </div>
    </div>
  );

  return (
    <>
      {createPortal(editor, document.body)}
      {toast &&
        createPortal(
          <div key={toast.id} className="wf-toast">
            {toast.message}
          </div>,
          document.body,
        )}
    </>
  );
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
    const maxOrder = workflows.reduce(
      (max, w) => Math.max(max, w.order),
      -1,
    );
    const wf: Workflow = {
      id: uid(),
      name: 'Untitled Workflow',
      icon: 'GitBranch',
      color: '#89b4fa',
      order: maxOrder + 1,
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
  const handleColorChange = (id: string, color: string) =>
    saveAll(
      workflows.map((w) =>
        w.id === id ? { ...w, color, updatedAt: Date.now() } : w,
      ),
    );
  const handleChange = (updated: Workflow) =>
    saveAll(workflows.map((w) => (w.id === updated.id ? updated : w)));

  const handleReorder = (ids: string[]) => {
    const map = new Map(workflows.map((w) => [w.id, w]));
    const updated = ids.map((id, i) => ({
      ...map.get(id)!,
      order: i,
      updatedAt: Date.now(),
    }));
    saveAll(updated);
  };

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
        onColorChange={handleColorChange}
        onReorder={handleReorder}
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

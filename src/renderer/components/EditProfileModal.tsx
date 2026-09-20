import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  MouseEvent,
  KeyboardEvent,
} from 'react';
import {
  X,
  Search,
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
  Server,
  Shield,
  Plus,
  Trash2,
  Flag,
  Copy,
  Check,
} from 'lucide-react';
import {
  Profile,
  CacheType,
} from '../types/profile';
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
  MMPROJ_OFFLOAD_TOOLTIP,
  IMAGE_MIN_TOKENS_TOOLTIP,
  IMAGE_MAX_TOKENS_TOOLTIP,
  MTMD_BATCH_MAX_TOKENS_TOOLTIP,
  TEMPERATURE_TOOLTIP,
  TOP_K_TOOLTIP,
  TOP_P_TOOLTIP,
  MIN_P_TOOLTIP,
  SEED_TOOLTIP,
  IGNORE_EOS_TOOLTIP,
  TYPICAL_P_TOOLTIP,
  TOP_N_SIGMA_TOOLTIP,
  XTC_PROBABILITY_TOOLTIP,
  XTC_THRESHOLD_TOOLTIP,
  REPEAT_PENALTY_TOOLTIP,
  LAST_TOKENS_TOOLTIP,
  REPEAT_PENALTY_VALUE_TOOLTIP,
  FREQUENCY_PENALTY_TOOLTIP,
  PRESENCE_PENALTY_TOOLTIP,
  DRY_MULTIPLIER_TOOLTIP,
  DRY_BASE_TOOLTIP,
  DRY_ALLOWED_LENGTH_TOOLTIP,
  DRY_PENALTY_LAST_N_TOOLTIP,
  DRY_SEQUENCE_BREAKERS_TOOLTIP,
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
  REPACK_TOOLTIP,
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
  FLASH_ATTENTION_TOOLTIP,
  CORS_ORIGINS_TOOLTIP,
  CORS_METHODS_TOOLTIP,
  CORS_HEADERS_TOOLTIP,
  CORS_CREDENTIALS_TOOLTIP,
  HOST_TOOLTIP,
  PORT_TOOLTIP,
  DRY_PENALTY_ENABLED,
  MANUAL_LAUNCH_TOOLTIP,
  CUSTOM_FLAGS_PAGE_TOOLTIP,
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
  defaultHost?: string;
  defaultPort?: number;
  defaultCorsOrigins?: string;
  defaultCorsMethods?: string;
  defaultCorsHeaders?: string;
  defaultCorsCredentials?: boolean;
}

const PAGE_DEPTH: Record<string, number> = {
  main: 0,
  'system-prompt': 1,
  tools: 1,
  advanced: 1,
  'repeat-penalty': 2,
  'advanced-samplers': 2,
  projector: 1,
  'video-settings': 2,
  performance: 1,
  'cache-options': 2,
  'memory-options': 2,
  'rope-scaling': 2,
  'draft-model': 2,
  'moe-options': 2,
  'server-settings': 1,
  'cors-settings': 2,
  'custom-flags': 2,
};

const BREADCRUMB_MAP: Record<string, { label: string; parent: string | null }> =
  {
    main: { label: 'Profile', parent: null },
    'system-prompt': { label: 'System Prompt', parent: 'main' },
    tools: { label: 'Tools', parent: 'main' },
    advanced: { label: 'Advanced Parameters', parent: 'main' },
    'repeat-penalty': { label: 'Repeat Penalty', parent: 'advanced' },
    'advanced-samplers': {
      label: 'Advanced Samplers',
      parent: 'advanced',
    },
    projector: { label: 'Projector', parent: 'main' },
    'video-settings': { label: 'Video Settings', parent: 'projector' },
    performance: { label: 'Performance', parent: 'main' },
    'cache-options': { label: 'Cache Options', parent: 'performance' },
    'memory-options': { label: 'Memory Options', parent: 'performance' },
    'rope-scaling': {
      label: 'Context Scaling (RoPE/YaRN)',
      parent: 'cache-options',
    },
    'draft-model': { label: 'Draft Model', parent: 'performance' },
    'moe-options': { label: 'Mixture of Experts', parent: 'performance' },
    'server-settings': { label: 'Server Settings', parent: 'main' },
    'cors-settings': { label: 'CORS', parent: 'server-settings' },
    'custom-flags': { label: 'Custom Flags', parent: 'server-settings' },
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

// ── Search ──

interface SearchIndexEntry {
  id: string;
  label: string;
  keywords: string[];
  page: string;
  categoryId?: string;
}

interface ScoredSearchResult extends SearchIndexEntry {
  score: number;
}

// Static index: every settable field / card / page. Labels match the UI text.
const SEARCH_INDEX: SearchIndexEntry[] = [
  // main
  {
    id: 'main:profile-name',
    label: 'Profile Name',
    keywords: ['name', 'title'],
    page: 'main',
  },
  {
    id: 'main:model',
    label: 'Model',
    keywords: ['model', 'weights', 'gguf'],
    page: 'main',
  },
  {
    id: 'main:projector-card',
    label: 'Projector',
    keywords: ['projector', 'mmproj', 'vision', 'image model'],
    page: 'main',
  },
  {
    id: 'main:performance-card',
    label: 'Performance',
    keywords: ['performance', 'gpu', 'vram', 'speed', 'optimization'],
    page: 'main',
  },
  {
    id: 'main:system-prompt-card',
    label: 'System Prompt',
    keywords: ['system prompt', 'persona', 'instructions', 'behavior'],
    page: 'main',
  },
  {
    id: 'main:tools-card',
    label: 'Tools',
    keywords: ['tools', 'extensions', 'function calling'],
    page: 'main',
  },
  {
    id: 'main:advanced-card',
    label: 'Advanced Parameters',
    keywords: ['advanced', 'sampling', 'temperature'],
    page: 'main',
  },
  {
    id: 'main:server-card',
    label: 'Server Settings',
    keywords: ['server', 'host', 'port', 'launch'],
    page: 'main',
  },
  // system-prompt
  {
    id: 'system-prompt:page',
    label: 'System Prompt',
    keywords: ['system prompt', 'persona', 'instructions'],
    page: 'system-prompt',
  },
  // tools
  {
    id: 'tools:page',
    label: 'Tools',
    keywords: ['tools', 'extensions', 'file', 'web search'],
    page: 'tools',
  },
  // advanced
  {
    id: 'advanced:page',
    label: 'Advanced Parameters',
    keywords: ['advanced', 'sampling'],
    page: 'advanced',
  },
  {
    id: 'advanced:temperature',
    label: 'Temperature',
    keywords: ['temperature', 'temp', 'sampling', 'creativity'],
    page: 'advanced',
  },
  {
    id: 'advanced:top-k',
    label: 'Top K',
    keywords: ['top k', 'topk', 'sampling'],
    page: 'advanced',
  },
  {
    id: 'advanced:top-p',
    label: 'Top P',
    keywords: ['top p', 'topp', 'nucleus', 'sampling'],
    page: 'advanced',
  },
  {
    id: 'advanced:min-p',
    label: 'Min P',
    keywords: ['min p', 'minp', 'sampling'],
    page: 'advanced',
  },
  {
    id: 'advanced:repeat-card',
    label: 'Repeat Penalty',
    keywords: ['repeat', 'penalty', 'repetition'],
    page: 'advanced',
  },
  {
    id: 'advanced:samplers-card',
    label: 'Advanced Samplers',
    keywords: ['samplers', 'seed', 'xtc', 'typical'],
    page: 'advanced',
  },
  // repeat-penalty
  {
    id: 'repeat-penalty:page',
    label: 'Repeat Penalty',
    keywords: ['repeat', 'penalty'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:enabled',
    label: 'Repeat Penalty Enabled',
    keywords: ['repeat', 'enabled', 'toggle'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:last-tokens',
    label: 'Last Tokens',
    keywords: ['last tokens', 'repeat', 'window'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:penalty',
    label: 'Repeat Penalty Value',
    keywords: ['penalty', 'repeat'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:frequency',
    label: 'Frequency Penalty',
    keywords: ['frequency', 'penalty'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:presence',
    label: 'Presence Penalty',
    keywords: ['presence', 'penalty'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:dry-enabled',
    label: 'DRY Enabled',
    keywords: ['dry', 'enabled', 'repetition'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:dry-multiplier',
    label: 'DRY Multiplier',
    keywords: ['dry', 'multiplier'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:dry-base',
    label: 'DRY Base',
    keywords: ['dry', 'base'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:dry-allowed-length',
    label: 'DRY Allowed Length',
    keywords: ['dry', 'allowed length'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:dry-penalty-last-n',
    label: 'DRY Penalty Last N',
    keywords: ['dry', 'penalty', 'last n'],
    page: 'repeat-penalty',
  },
  {
    id: 'repeat-penalty:dry-breakers',
    label: 'Sequence Breakers',
    keywords: ['dry', 'sequence breakers', 'delimiters'],
    page: 'repeat-penalty',
  },
  // advanced-samplers
  {
    id: 'advanced-samplers:page',
    label: 'Advanced Samplers',
    keywords: ['samplers', 'advanced'],
    page: 'advanced-samplers',
  },
  {
    id: 'advanced-samplers:ignore-eos',
    label: 'Ignore EOS',
    keywords: ['ignore eos', 'end of stream', 'generation'],
    page: 'advanced-samplers',
  },
  {
    id: 'advanced-samplers:seed',
    label: 'Seed',
    keywords: ['seed', 'random', 'deterministic'],
    page: 'advanced-samplers',
  },
  {
    id: 'advanced-samplers:typical-p',
    label: 'Typical P',
    keywords: ['typical p', 'typical', 'sampling'],
    page: 'advanced-samplers',
  },
  {
    id: 'advanced-samplers:top-n-sigma',
    label: 'Top N Sigma',
    keywords: ['top n sigma', 'sigma', 'sampling'],
    page: 'advanced-samplers',
  },
  {
    id: 'advanced-samplers:xtc-probability',
    label: 'XTC Probability',
    keywords: ['xtc', 'probability', 'sampling'],
    page: 'advanced-samplers',
  },
  {
    id: 'advanced-samplers:xtc-threshold',
    label: 'XTC Threshold',
    keywords: ['xtc', 'threshold', 'sampling'],
    page: 'advanced-samplers',
  },
  // projector
  {
    id: 'projector:page',
    label: 'Projector',
    keywords: ['projector', 'mmproj', 'vision'],
    page: 'projector',
  },
  {
    id: 'projector:model',
    label: 'Projector Model',
    keywords: ['projector', 'mmproj', 'model file'],
    page: 'projector',
  },
  {
    id: 'projector:video-card',
    label: 'Video Settings',
    keywords: ['video', 'frames', 'fps'],
    page: 'projector',
  },
  {
    id: 'projector:mmproj-offload',
    label: 'MMProj GPU Offload',
    keywords: ['mmproj', 'offload', 'gpu', 'vision'],
    page: 'projector',
  },
  {
    id: 'projector:image-min-tokens',
    label: 'Image Min Tokens',
    keywords: ['image', 'min tokens', 'vision'],
    page: 'projector',
  },
  {
    id: 'projector:image-max-tokens',
    label: 'Image Max Tokens',
    keywords: ['image', 'max tokens', 'vision'],
    page: 'projector',
  },
  {
    id: 'projector:mtmd-batch',
    label: 'Batch Max Tokens (MTMD)',
    keywords: ['mtmd', 'batch', 'tokens', 'multimodal'],
    page: 'projector',
  },
  // video-settings
  {
    id: 'video-settings:page',
    label: 'Video Settings',
    keywords: ['video', 'frames'],
    page: 'video-settings',
  },
  {
    id: 'video-settings:unlimited',
    label: 'Disable Frame Limit',
    keywords: ['video', 'unlimited', 'frame limit'],
    page: 'video-settings',
  },
  {
    id: 'video-settings:fps',
    label: 'Frames Per Second (FPS)',
    keywords: ['fps', 'frames', 'video'],
    page: 'video-settings',
  },
  {
    id: 'video-settings:max-frames',
    label: 'Max Frames',
    keywords: ['max frames', 'video'],
    page: 'video-settings',
  },
  {
    id: 'video-settings:quality',
    label: 'JPEG Quality',
    keywords: ['quality', 'jpeg', 'video'],
    page: 'video-settings',
  },
  {
    id: 'video-settings:width',
    label: 'Max Width',
    keywords: ['width', 'resolution', 'video'],
    page: 'video-settings',
  },
  // performance
  {
    id: 'performance:page',
    label: 'Performance',
    keywords: ['performance', 'gpu', 'optimization'],
    page: 'performance',
  },
  {
    id: 'performance:optimizer',
    label: 'Optimization Mode',
    keywords: ['optimization', 'longest context', 'most gpu', 'custom', 'auto'],
    page: 'performance',
  },
  {
    id: 'performance:memory',
    label: 'Estimated Memory Usage',
    keywords: ['memory', 'vram', 'ram', 'estimate'],
    page: 'performance',
  },
  {
    id: 'performance:gpu-auto',
    label: 'GPU Layers Auto',
    keywords: ['gpu layers', 'auto', 'ngl', 'offload'],
    page: 'performance',
  },
  {
    id: 'performance:gpu-layers',
    label: 'GPU Layers (NGL)',
    keywords: ['gpu layers', 'ngl', 'offload'],
    page: 'performance',
  },
  {
    id: 'performance:context-size',
    label: 'Context Length',
    keywords: ['context', 'ctx', 'context size', 'length'],
    page: 'performance',
  },
  {
    id: 'performance:cache-card',
    label: 'Cache Options',
    keywords: ['cache', 'kv', 'flash attention'],
    page: 'performance',
  },
  {
    id: 'performance:draft-card',
    label: 'Draft Model',
    keywords: ['draft', 'speculative', 'decoding'],
    page: 'performance',
  },
  {
    id: 'performance:memory-card',
    label: 'Memory Options',
    keywords: ['memory', 'mmap', 'mlock'],
    page: 'performance',
  },
  {
    id: 'performance:moe-card',
    label: 'Mixture of Experts',
    keywords: ['moe', 'mixture of experts'],
    page: 'performance',
  },
  // cache-options
  {
    id: 'cache-options:page',
    label: 'Cache Options',
    keywords: ['cache', 'kv'],
    page: 'cache-options',
  },
  {
    id: 'cache-options:flash',
    label: 'Flash Attention',
    keywords: ['flash attention', 'fa', 'cache'],
    page: 'cache-options',
  },
  {
    id: 'cache-options:kv-offload',
    label: 'KV Cache Offload',
    keywords: ['kv', 'offload', 'cache', 'gpu'],
    page: 'cache-options',
  },
  {
    id: 'cache-options:k-type',
    label: 'K Cache Type',
    keywords: ['k cache', 'quantization', 'cache type'],
    page: 'cache-options',
  },
  {
    id: 'cache-options:v-type',
    label: 'V Cache Type',
    keywords: ['v cache', 'quantization', 'cache type'],
    page: 'cache-options',
  },
  {
    id: 'cache-options:rope-card',
    label: 'Context Scaling (RoPE/YaRN)',
    keywords: ['rope', 'yarn', 'context scaling'],
    page: 'cache-options',
  },
  // memory-options
  {
    id: 'memory-options:page',
    label: 'Memory Options',
    keywords: ['memory', 'mmap'],
    page: 'memory-options',
  },
  {
    id: 'memory-options:mmap',
    label: 'Memory-Mapped (MMAP)',
    keywords: ['mmap', 'memory mapped'],
    page: 'memory-options',
  },
  {
    id: 'memory-options:mlock',
    label: 'MLock (Pin RAM)',
    keywords: ['mlock', 'pin', 'ram'],
    page: 'memory-options',
  },
  {
    id: 'memory-options:repack',
    label: 'Weight Repacking',
    keywords: ['repack', 'weights'],
    page: 'memory-options',
  },
  // rope-scaling
  {
    id: 'rope-scaling:page',
    label: 'Context Scaling (RoPE/YaRN)',
    keywords: ['rope', 'yarn', 'context scaling'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:method',
    label: 'RoPE Scaling Method',
    keywords: ['rope', 'method', 'none', 'linear', 'yarn'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:scale',
    label: 'RoPE Scale Factor',
    keywords: ['rope', 'scale'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:freq-base',
    label: 'RoPE Freq Base',
    keywords: ['rope', 'freq base', 'frequency'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:freq-scale',
    label: 'RoPE Freq Scale',
    keywords: ['rope', 'freq scale', 'frequency'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:yarn-orig',
    label: 'YaRN Original Context',
    keywords: ['yarn', 'original context'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:yarn-ext',
    label: 'YaRN Extrapolation Factor',
    keywords: ['yarn', 'extrapolation'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:yarn-attn',
    label: 'YaRN Attention Factor',
    keywords: ['yarn', 'attention'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:yarn-beta-slow',
    label: 'YaRN Beta Slow',
    keywords: ['yarn', 'beta slow'],
    page: 'rope-scaling',
  },
  {
    id: 'rope-scaling:yarn-beta-fast',
    label: 'YaRN Beta Fast',
    keywords: ['yarn', 'beta fast'],
    page: 'rope-scaling',
  },
  // draft-model
  {
    id: 'draft-model:page',
    label: 'Draft Model',
    keywords: ['draft', 'speculative'],
    page: 'draft-model',
  },
  {
    id: 'draft-model:type',
    label: 'Draft Type',
    keywords: ['draft type', 'mtp', 'eagle', 'ngram', 'speculative'],
    page: 'draft-model',
  },
  {
    id: 'draft-model:model',
    label: 'External Draft Model',
    keywords: ['draft model', 'external', 'model file'],
    page: 'draft-model',
  },
  {
    id: 'draft-model:n-max',
    label: 'Draft N Max',
    keywords: ['draft', 'n max'],
    page: 'draft-model',
  },
  {
    id: 'draft-model:n-min',
    label: 'Draft N Min',
    keywords: ['draft', 'n min'],
    page: 'draft-model',
  },
  {
    id: 'draft-model:p-split',
    label: 'Draft P Split',
    keywords: ['draft', 'p split'],
    page: 'draft-model',
  },
  {
    id: 'draft-model:p-min',
    label: 'Draft P Min',
    keywords: ['draft', 'p min'],
    page: 'draft-model',
  },
  // moe-options
  {
    id: 'moe-options:page',
    label: 'Mixture of Experts',
    keywords: ['moe', 'mixture of experts'],
    page: 'moe-options',
  },
  {
    id: 'moe-options:cpu-moe',
    label: 'CPU MoE',
    keywords: ['cpu moe', 'mixture of experts', 'offload'],
    page: 'moe-options',
  },
  {
    id: 'moe-options:n-cpu-moe',
    label: 'N CPU MoE',
    keywords: ['n cpu moe', 'expert count'],
    page: 'moe-options',
  },
  // server-settings
  {
    id: 'server-settings:page',
    label: 'Server Settings',
    keywords: ['server', 'host', 'port'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:manual',
    label: 'Manual Launch Command',
    keywords: ['manual', 'launch', 'custom command'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:host',
    label: 'Host',
    keywords: ['host', 'address', 'bind', 'ip'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:port',
    label: 'Port',
    keywords: ['port', 'server'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:parallel',
    label: 'Parallel Server Slot Count',
    keywords: ['parallel', 'slots', 'server'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:cors-card',
    label: 'CORS',
    keywords: ['cors', 'origins', 'browser'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:flags-card',
    label: 'Custom Flags',
    keywords: ['custom flags', 'arguments', 'args'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:launch-args',
    label: 'Launch Arguments',
    keywords: ['launch', 'arguments', 'preview', 'command'],
    page: 'server-settings',
  },
  {
    id: 'server-settings:launch-cmd',
    label: 'Launch Command',
    keywords: ['launch', 'command', 'manual'],
    page: 'server-settings',
  },
  // cors-settings
  {
    id: 'cors-settings:page',
    label: 'CORS',
    keywords: ['cors', 'browser', 'origins'],
    page: 'cors-settings',
  },
  {
    id: 'cors-settings:origins',
    label: 'Allowed Origins',
    keywords: ['cors', 'origins', 'allowed'],
    page: 'cors-settings',
  },
  {
    id: 'cors-settings:methods',
    label: 'Allowed Methods',
    keywords: ['cors', 'methods', 'allowed'],
    page: 'cors-settings',
  },
  {
    id: 'cors-settings:headers',
    label: 'Allowed Headers',
    keywords: ['cors', 'headers', 'allowed'],
    page: 'cors-settings',
  },
  {
    id: 'cors-settings:credentials',
    label: 'Allow Credentials',
    keywords: ['cors', 'credentials'],
    page: 'cors-settings',
  },
  // custom-flags
  {
    id: 'custom-flags:page',
    label: 'Custom Flags',
    keywords: ['custom flags', 'arguments'],
    page: 'custom-flags',
  },
];

function normalizeSearchText(s: string): string {
  return s.toLowerCase().trim();
}

function isSubsequence(query: string, target: string): boolean {
  if (!query) return true;
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target[ti] === query[qi]) qi += 1;
  }
  return qi === query.length;
}

function scoreSearchEntry(entry: SearchIndexEntry, tokens: string[]): number {
  const label = normalizeSearchText(entry.label);
  const keywordText = normalizeSearchText(entry.keywords.join(' '));
  let failed = false;
  const total = tokens.reduce((sum, rawToken) => {
    if (failed) return sum;
    const token = normalizeSearchText(rawToken);
    if (!token) return sum;
    let tokenScore = 0;
    if (label.includes(token)) {
      tokenScore = 100;
      if (label.startsWith(token)) tokenScore += 20;
      else if (label.split(/[\s()/-]+/).some((w) => w.startsWith(token)))
        tokenScore += 10;
    } else if (keywordText.includes(token)) {
      tokenScore = 50;
    } else if (isSubsequence(token, label.replace(/[^a-z0-9]/g, ''))) {
      tokenScore = 10;
    } else if (isSubsequence(token, keywordText.replace(/[^a-z0-9]/g, ''))) {
      tokenScore = 5;
    } else {
      failed = true;
      return sum;
    }
    return sum + tokenScore;
  }, 0);
  return failed ? 0 : total;
}

function searchEntries(
  entries: SearchIndexEntry[],
  query: string,
  limit = 30,
): ScoredSearchResult[] {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return entries
    .map((entry) => ({ ...entry, score: scoreSearchEntry(entry, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function SearchResultsPage({
  query,
  results,
  onSelect,
  onClear,
}: {
  query: string;
  results: ScoredSearchResult[];
  onSelect: (entry: ScoredSearchResult) => void;
  onClear: () => void;
}) {
  if (results.length === 0) {
    return (
      <div className="epm-search-empty">
        <p className="epm-search-empty__title">
          No settings match &ldquo;{query}&rdquo;
        </p>
        <p className="epm-search-empty__hint">
          Try a different keyword, e.g. temperature, cache, or CORS.
        </p>
        <button
          type="button"
          className="epm-search-empty__clear"
          onClick={onClear}
        >
          Clear search
        </button>
      </div>
    );
  }
  const groups: Array<{ page: string; items: ScoredSearchResult[] }> = [];
  results.forEach((result) => {
    const group = groups.find((g) => g.page === result.page);
    if (group) {
      group.items.push(result);
    } else {
      groups.push({ page: result.page, items: [result] });
    }
  });
  return (
    <div className="epm-search-results">
      {groups.map((group) => (
        <div key={group.page}>
          <div className="epm-search-group">
            {BREADCRUMB_MAP[group.page]?.label ?? group.page}
          </div>
          {group.items.map((result) => {
            const trail = buildBreadcrumb(result.page)
              .map((c) => c.label)
              .join(' › ');
            return (
              <button
                key={result.id}
                type="button"
                className="epm-search-row"
                onClick={() => onSelect(result)}
              >
                <span className="epm-search-row__body">
                  <span className="epm-search-row__label">{result.label}</span>
                  <span className="epm-search-row__trail">{trail}</span>
                </span>
                <ChevronRight size={16} className="epm-search-row__chevron" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
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
  editAutoOptimizer,
  editLayers,
  editContextSize,
  modelMaxLayers,
  modelMaxContext,
  editParallel,
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
  editAutoOptimizer: 'longest-context' | 'most-gpu' | 'custom' | null;
  editLayers: number | undefined;
  editContextSize: number | undefined;
  modelMaxLayers: number;
  modelMaxContext: number;
  editParallel: string;
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
                  <span className="epm-model-not-selected">Not Selected</span>
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
            preview={
              editAutoOptimizer
                ? autoOptimizerLabel(editAutoOptimizer)
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
          preview="Set the AI's behavior and personality."
          onClick={() => onNavigate('system-prompt')}
        />
        <SectionCard
          icon={<Wrench size={20} />}
          title="Tools"
          preview="Enable AI tools like file I/O and web search."
          onClick={() => onNavigate('tools')}
        />
        <SectionCard
          icon={<Settings size={20} />}
          title="Advanced Parameters"
          preview="Fine-tune how the AI generates responses."
          onClick={() => onNavigate('advanced')}
        />
        <SectionCard
          icon={<Server size={20} />}
          title="Server Settings"
          preview="Advanced settings for llama-server"
          onClick={() => onNavigate('server-settings')}
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

function SystemPromptPage({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + variable + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + variable.length;
      ta.setSelectionRange(pos, pos);
    });
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
      <textarea
        ref={textareaRef}
        className="epm-textarea epm-textarea--editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter your system prompt here..."
      />
    </>
  );
}

function ToolsPage({
  extensionGroups,
  editTools,
  onToolToggle,
  openCategoryId,
  onOpenCategoryConsumed,
}: {
  extensionGroups: Array<{
    extension: {
      manifest: {
        id: string;
        name: string;
        description: string;
        icon: string;
        iconSvgData?: string;
      };
      tools: Record<string, any>;
    };
    toolKeys: string[];
  }>;
  editTools: string[];
  onToolToggle: (key: string) => void;
  openCategoryId?: string | null;
  onOpenCategoryConsumed?: () => void;
}) {
  const [modalExt, setModalExt] = useState<{
    id: string;
    name: string;
    description: string;
    toolKeys: string[];
  } | null>(null);

  useEffect(() => {
    if (!openCategoryId) return;
    const match = extensionGroups.find(
      ({ extension }) => extension.manifest.id === openCategoryId,
    );
    if (match) {
      setModalExt({
        id: match.extension.manifest.id,
        name: match.extension.manifest.name,
        description: match.extension.manifest.description,
        toolKeys: match.toolKeys,
      });
    }
    onOpenCategoryConsumed?.();
  }, [openCategoryId, extensionGroups, onOpenCategoryConsumed]);

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
                    icon: meta.icon,
                    displayType: meta.displayType,
                    tags: meta.tags,
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
      </div>

      <div style={{ marginTop: '20px' }}>
        <SectionCard
          icon={<Settings size={18} />}
          title="Repeat Penalty"
          preview="Discourages the model from repeating recent tokens"
          onClick={() => onNavigate('repeat-penalty')}
        />
        <div style={{ marginTop: '12px' }}>
          <SectionCard
            icon={<SlidersHorizontal size={18} />}
            title="Advanced Samplers"
            preview="Ignore EOS, seed, locally typical, top-n-sigma and XTC sampling"
            onClick={() => onNavigate('advanced-samplers')}
          />
        </div>
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
  editDryEnabled,
  setEditDryEnabled,
  editDryMultiplier,
  setEditDryMultiplier,
  editDryBase,
  setEditDryBase,
  editDryAllowedLength,
  setEditDryAllowedLength,
  editDryPenaltyLastN,
  setEditDryPenaltyLastN,
  editDrySequenceBreakers,
  setEditDrySequenceBreakers,
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
  editDryEnabled: boolean;
  setEditDryEnabled: (v: boolean) => void;
  editDryMultiplier: string;
  setEditDryMultiplier: (v: string) => void;
  editDryBase: string;
  setEditDryBase: (v: string) => void;
  editDryAllowedLength: string;
  setEditDryAllowedLength: (v: string) => void;
  editDryPenaltyLastN: string;
  setEditDryPenaltyLastN: (v: string) => void;
  editDrySequenceBreakers: string;
  setEditDrySequenceBreakers: (v: string) => void;
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

      <label className="epm-perf-toggle-row" style={{ paddingTop: 0 }}>
        <InfoTooltip
          content={REPEAT_PENALTY_TOOLTIP}
          side="right"
          stretch
          portal
          className="info-tooltip-stretch--row"
          title="Repeat Penalty"
        >
          <span className="epm-perf-toggle-label">Enabled</span>
          <div
            className={`epm-toggle-switch${editRpEnabled ? ' epm-toggle-switch--on' : ''}`}
            onClick={() => setEditRpEnabled(!editRpEnabled)}
            role="switch"
            aria-checked={editRpEnabled}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setEditRpEnabled(!editRpEnabled);
              }
            }}
          >
            <div className="epm-toggle-switch__knob" />
          </div>
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

      <div style={{ marginTop: '24px' }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '12px',
          }}
        >
          DRY SETTINGS
        </div>

        <label className="epm-perf-toggle-row" style={{ paddingTop: 0 }}>
          <InfoTooltip
            content={DRY_PENALTY_ENABLED}
            side="right"
            stretch
            portal
            className="info-tooltip-stretch--row"
            title="DRY Sampling"
          >
            <span className="epm-perf-toggle-label">Enabled</span>
            <div
              className={`epm-toggle-switch${editDryEnabled ? ' epm-toggle-switch--on' : ''}`}
              onClick={() => setEditDryEnabled(!editDryEnabled)}
              role="switch"
              aria-checked={editDryEnabled}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setEditDryEnabled(!editDryEnabled);
                }
              }}
            >
              <div className="epm-toggle-switch__knob" />
            </div>
          </InfoTooltip>
        </label>

        <div
          className={
            !editDryEnabled ? 'epm-repeat-penalty-fields--disabled' : undefined
          }
        >
          <div className="epm-number-grid">
            <NumberField
              label="DRY Multiplier"
              value={editDryMultiplier}
              onChange={setEditDryMultiplier}
              min="0"
              step="0.01"
              helper="Default: 0.00"
              tooltip={DRY_MULTIPLIER_TOOLTIP}
            />
            <NumberField
              label="DRY Base"
              value={editDryBase}
              onChange={setEditDryBase}
              min="0"
              step="0.01"
              helper="Default: 1.75"
              tooltip={DRY_BASE_TOOLTIP}
            />
            <NumberField
              label="DRY Allowed Length"
              value={editDryAllowedLength}
              onChange={setEditDryAllowedLength}
              min="0"
              step="1"
              helper="Default: 2"
              tooltip={DRY_ALLOWED_LENGTH_TOOLTIP}
            />
            <NumberField
              label="DRY Penalty Last N"
              value={editDryPenaltyLastN}
              onChange={setEditDryPenaltyLastN}
              step="1"
              helper="Default: -1 (context size)"
              tooltip={DRY_PENALTY_LAST_N_TOOLTIP}
            />
          </div>
          <div className="epm-section" style={{ marginTop: '12px' }}>
            <InfoTooltip
              content={DRY_SEQUENCE_BREAKERS_TOOLTIP}
              side="bottom"
              stretch
              className="info-tooltip-stretch--col"
              title="DRY Sequence Breakers"
            >
              <div className="epm-section__label">Sequence Breakers</div>
              <input
                type="text"
                className="epm-input"
                value={editDrySequenceBreakers}
                onChange={(e) => setEditDrySequenceBreakers(e.target.value)}
                placeholder='\n : " *'
                style={{ marginTop: '8px' }}
              />
            </InfoTooltip>
          </div>
        </div>
      </div>
    </>
  );
}

function AdvancedSamplersPage({
  editIgnoreEos,
  setEditIgnoreEos,
  editSeed,
  setEditSeed,
  editTypicalP,
  setEditTypicalP,
  editTopNSigma,
  setEditTopNSigma,
  editXtcProbability,
  setEditXtcProbability,
  editXtcThreshold,
  setEditXtcThreshold,
}: {
  editIgnoreEos: boolean;
  setEditIgnoreEos: (v: boolean) => void;
  editSeed: string;
  setEditSeed: (v: string) => void;
  editTypicalP: string;
  setEditTypicalP: (v: string) => void;
  editTopNSigma: string;
  setEditTopNSigma: (v: string) => void;
  editXtcProbability: string;
  setEditXtcProbability: (v: string) => void;
  editXtcThreshold: string;
  setEditXtcThreshold: (v: string) => void;
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
        Additional sampling strategies for fine-tuning generation.
      </p>

      <label className="epm-perf-toggle-row" style={{ paddingTop: 0 }}>
        <InfoTooltip
          content={IGNORE_EOS_TOOLTIP}
          side="right"
          stretch
          portal
          className="info-tooltip-stretch--row"
          title="Ignore EOS"
        >
          <span className="epm-perf-toggle-label">Ignore EOS</span>
          <div
            className={`epm-toggle-switch${editIgnoreEos ? ' epm-toggle-switch--on' : ''}`}
            onClick={() => setEditIgnoreEos(!editIgnoreEos)}
            role="switch"
            aria-checked={editIgnoreEos}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setEditIgnoreEos(!editIgnoreEos);
              }
            }}
          >
            <div className="epm-toggle-switch__knob" />
          </div>
        </InfoTooltip>
      </label>

      <div className="epm-number-grid" style={{ marginTop: '16px' }}>
        <NumberField
          label="Seed"
          value={editSeed}
          onChange={setEditSeed}
          min="0"
          step="1"
          helper="Default: -1 (random)"
          tooltip={SEED_TOOLTIP}
        />
        <NumberField
          label="Typical P"
          value={editTypicalP}
          onChange={setEditTypicalP}
          min="0"
          max="1"
          step="0.01"
          helper="Default: 1.00 (disabled)"
          tooltip={TYPICAL_P_TOOLTIP}
        />
        <NumberField
          label="Top N Sigma"
          value={editTopNSigma}
          onChange={setEditTopNSigma}
          min="-1"
          step="0.01"
          helper="Default: -1.00 (disabled)"
          tooltip={TOP_N_SIGMA_TOOLTIP}
        />
        <NumberField
          label="XTC Probability"
          value={editXtcProbability}
          onChange={setEditXtcProbability}
          min="0"
          max="1"
          step="0.01"
          helper="Default: 0.00 (disabled)"
          tooltip={XTC_PROBABILITY_TOOLTIP}
        />
        <NumberField
          label="XTC Threshold"
          value={editXtcThreshold}
          onChange={setEditXtcThreshold}
          min="0"
          max="1"
          step="0.01"
          helper="Default: 0.10"
          tooltip={XTC_THRESHOLD_TOOLTIP}
        />
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

function formatCacheType(t: CacheType): string {
  return t === 'f16' ? 'F16 (Default)' : t.toUpperCase();
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
          {formatCacheType(value)}
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
                {formatCacheType(t)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const FLASH_ATTN_OPTIONS: Array<'on' | 'off' | 'auto'> = ['auto', 'on', 'off'];

function FlashAttnSelector({
  value,
  onChange,
}: {
  value: 'on' | 'off' | 'auto';
  onChange: (v: 'on' | 'off' | 'auto') => void;
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
    <div
      className="epm-cache-selector"
      ref={ref}
      style={{ width: '250px', flex: 'none' }}
    >
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
          <div className="epm-flash-attn-dropdown">
            {FLASH_ATTN_OPTIONS.map((t) => (
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

const ROPE_SCALING_METHODS: Array<{ value: string; label: string }> = [
  { value: '', label: 'model default' },
  { value: 'none', label: 'none' },
  { value: 'linear', label: 'linear' },
  { value: 'yarn', label: 'yarn' },
];

function RopeScalingMethodSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
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

  const current = ROPE_SCALING_METHODS.find((m) => m.value === value);

  return (
    <div className="epm-cache-selector" ref={ref}>
      <span className="epm-cache-selector-label">Method</span>
      <div className="epm-cache-selector-wrap">
        <button
          className="epm-cache-selector-trigger"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {current ? current.label : 'model default'}
          <ChevronDown size={13} />
        </button>
        {open && (
          <div className="epm-cache-selector-dropdown">
            {ROPE_SCALING_METHODS.map((m) => (
              <button
                key={m.value}
                className={`epm-cache-selector-option${m.value === value ? ' epm-cache-selector-option--active' : ''}`}
                onClick={() => {
                  onChange(m.value);
                  setOpen(false);
                }}
                type="button"
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Context Scaling (RoPE/YaRN) subpage ──

function RopeScalingPage({
  editRopeScaling,
  onSetRopeScaling,
  editRopeScale,
  onSetRopeScale,
  editRopeFreqBase,
  onSetRopeFreqBase,
  editRopeFreqScale,
  onSetRopeFreqScale,
  editYarnOrigCtx,
  onSetYarnOrigCtx,
  editYarnExtFactor,
  onSetYarnExtFactor,
  editYarnAttnFactor,
  onSetYarnAttnFactor,
  editYarnBetaSlow,
  onSetYarnBetaSlow,
  editYarnBetaFast,
  onSetYarnBetaFast,
}: {
  editRopeScaling: string;
  onSetRopeScaling: (v: string) => void;
  editRopeScale: string;
  onSetRopeScale: (v: string) => void;
  editRopeFreqBase: string;
  onSetRopeFreqBase: (v: string) => void;
  editRopeFreqScale: string;
  onSetRopeFreqScale: (v: string) => void;
  editYarnOrigCtx: string;
  onSetYarnOrigCtx: (v: string) => void;
  editYarnExtFactor: string;
  onSetYarnExtFactor: (v: string) => void;
  editYarnAttnFactor: string;
  onSetYarnAttnFactor: (v: string) => void;
  editYarnBetaSlow: string;
  onSetYarnBetaSlow: (v: string) => void;
  editYarnBetaFast: string;
  onSetYarnBetaFast: (v: string) => void;
}) {
  const isYarn = editRopeScaling === 'yarn';

  return (
    <>
      <h2 className="epm-page-title">Context Scaling (RoPE/YaRN)</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Extend the effective context length using RoPE scaling or YaRN. Settings
        equal to the server defaults are left unset.
      </p>

      <div className="epm-section">
        <InfoTooltip
          content={[
            'RoPE (Rotary Position Embedding) encodes token positions using rotation matrices, which the model learns during training.',
            'RoPE scaling stretches those rotations so the model can reason beyond the context length it was trained on, at the cost of some accuracy.',
            'linear: stretches positions uniformly across the full context. Simple and predictable, but degrades sooner at very long contexts.',
            'yarn: YaRN (Yet another RoPE extensioN) re-calibrates the rotations and adds temperature smoothing, keeping quality high at much longer contexts.',
            "'model default' leaves the model's built-in setting untouched.",
          ]}
          side="right"
          hideIcon
          title="Method"
        >
          <div className="epm-section__label">Method</div>
        </InfoTooltip>
        <RopeScalingMethodSelector
          value={editRopeScaling}
          onChange={onSetRopeScaling}
        />
        <div className="epm-number-grid" style={{ marginTop: '16px' }}>
          <NumberField
            label="RoPE Scale Factor"
            value={editRopeScale}
            onChange={onSetRopeScale}
            min="0.01"
            step="0.01"
            helper="Default: 1.00"
            tooltip={[
              'Multiplies the trained context length by this factor, e.g. 2.0 doubles the usable context.',
              'Requires a matching value at load time; the same factor must be used every session or outputs will degrade.',
              'Keep at 1.0 to leave the model untouched. (default: 1.0)',
            ]}
          />
          <NumberField
            label="RoPE Freq Base"
            value={editRopeFreqBase}
            onChange={onSetRopeFreqBase}
            min="0"
            step="1"
            helper="Default: model"
            tooltip={[
              'Base frequency of the rotary embeddings.',
              'Increasing it (e.g. 500000–1000000) stretches the context window with minimal loss, often preferred over --rope-scale.',
              'Leave empty to use the value embedded in the model. (default: model)',
            ]}
          />
          <NumberField
            label="RoPE Freq Scale"
            value={editRopeFreqScale}
            onChange={onSetRopeFreqScale}
            min="0.01"
            step="0.01"
            helper="Default: 1.00"
            tooltip={[
              'Scales the computed rotation frequencies by this percentage.',
              'Most users should prefer --rope-scale or --rope-freq-base; this is rarely needed.',
              'Keep at 1.00 to leave the model untouched. (default: 1.0)',
            ]}
          />
        </div>
      </div>

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <InfoTooltip
          content={[
            'YaRN (Yet another RoPE extensioN) is a context extension method that keeps long-context quality much higher than plain linear scaling.',
            'It rescales RoPE rotations per-dimension and applies a temperature to the attention softmax, which stabilises the model at extreme context lengths.',
            'Requires --rope-scaling yarn (the Method setting above) to take effect.',
            'Settings left at their defaults (-1.00 / 0) are not passed to the server, so the model or llama.cpp chooses.',
          ]}
          side="right"
          hideIcon
          title="YaRN Settings"
        >
          <div className="epm-section__label">YaRN Settings</div>
        </InfoTooltip>
        <div className="epm-number-grid">
          <NumberField
            label="YaRN Original Context"
            value={editYarnOrigCtx}
            onChange={onSetYarnOrigCtx}
            min="0"
            step="1"
            helper="Default: 0 (model context)"
            tooltip={[
              'The context length the model was originally trained on, before any scaling.',
              'Used as the reference point for computing the YaRN rotation adjustments.',
              '0 uses the model’s native context size. (default: 0)',
            ]}
            disabled={!isYarn}
          />
          <NumberField
            label="YaRN Extrapolation Factor"
            value={editYarnExtFactor}
            onChange={onSetYarnExtFactor}
            min="-1"
            step="0.01"
            helper="Default: -1.00"
            tooltip={[
              'Controls how aggressively positions beyond the original context are extrapolated.',
              'Higher values extend further but reduce accuracy at extreme positions.',
              '-1.00 lets llama.cpp derive it automatically. (default: -1.0)',
            ]}
            disabled={!isYarn}
          />
          <NumberField
            label="YaRN Attention Factor"
            value={editYarnAttnFactor}
            onChange={onSetYarnAttnFactor}
            min="-1"
            step="0.01"
            helper="Default: -1.00"
            tooltip={[
              'Scales the attention temperature to compensate for the extra context length.',
              'Tuned together with the beta parameters; most users never need to change it.',
              '-1.00 lets llama.cpp derive it automatically. (default: -1.0)',
            ]}
            disabled={!isYarn}
          />
          <NumberField
            label="YaRN Beta Slow"
            value={editYarnBetaSlow}
            onChange={onSetYarnBetaSlow}
            min="-1"
            step="0.01"
            helper="Default: -1.00"
            tooltip={[
              'Lower bound of the frequency band that YaRN gradually rescales.',
              'Together with Beta Fast it defines which position frequencies are affected.',
              '-1.00 lets llama.cpp derive it automatically. (default: -1.0)',
            ]}
            disabled={!isYarn}
          />
          <NumberField
            label="YaRN Beta Fast"
            value={editYarnBetaFast}
            onChange={onSetYarnBetaFast}
            min="-1"
            step="0.01"
            helper="Default: -1.00"
            tooltip={[
              'Upper bound of the frequency band that YaRN gradually rescales.',
              'Frequencies above this bound are left mostly unchanged to avoid distortion.',
              '-1.00 lets llama.cpp derive it automatically. (default: -1.0)',
            ]}
            disabled={!isYarn}
          />
        </div>
      </div>
    </>
  );
}

// ── Projector Page (sub-page) ──

function ProjectorPage({
  selectedProjectorDisplay,
  onOpenProjectorModal,
  editProjector,
  onNavigate,
  editMmprojOffload,
  setEditMmprojOffload,
  editImageMinTokens,
  setEditImageMinTokens,
  editImageMaxTokens,
  setEditImageMaxTokens,
  editMtmdBatchMaxTokens,
  setEditMtmdBatchMaxTokens,
}: {
  selectedProjectorDisplay: {
    filename: string;
    quantization: string;
    sizeBytes: number;
  } | null;
  onOpenProjectorModal: () => void;
  editProjector: string;
  onNavigate: (page: string) => void;
  editMmprojOffload: boolean;
  setEditMmprojOffload: (v: boolean) => void;
  editImageMinTokens: string;
  setEditImageMinTokens: (v: string) => void;
  editImageMaxTokens: string;
  setEditImageMaxTokens: (v: string) => void;
  editMtmdBatchMaxTokens: string;
  setEditMtmdBatchMaxTokens: (v: string) => void;
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
            preview="Configure how video frames are extracted."
            onClick={() => onNavigate('video-settings')}
          />
          <div className="epm-section" style={{ marginTop: '20px' }}>
            <InfoTooltip
              content="Llama-server flags controlling projector GPU offloading and image token budgets."
              side="right"
              hideIcon
              title="Image Settings"
            >
              <div className="epm-section__label">Image Settings</div>
            </InfoTooltip>
            <label className="epm-perf-toggle-row">
              <InfoTooltip
                content={MMPROJ_OFFLOAD_TOOLTIP}
                side="right"
                stretch
                className="info-tooltip-stretch--row"
                title="MMProj GPU Offload"
              >
                <span className="epm-perf-toggle-label">
                  MMProj GPU Offload
                </span>
                <div
                  className={`epm-toggle-switch${editMmprojOffload ? ' epm-toggle-switch--on' : ''}`}
                  onClick={() => setEditMmprojOffload(!editMmprojOffload)}
                  role="switch"
                  aria-checked={editMmprojOffload}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setEditMmprojOffload(!editMmprojOffload);
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </InfoTooltip>
            </label>
            <div className="epm-number-grid" style={{ marginTop: '16px' }}>
              <NumberField
                label="Image Min Tokens"
                value={editImageMinTokens}
                onChange={setEditImageMinTokens}
                min="0"
                step="1"
                helper="Default: read from model"
                tooltip={IMAGE_MIN_TOKENS_TOOLTIP}
                tooltipTitle="Image Min Tokens"
              />
              <NumberField
                label="Image Max Tokens"
                value={editImageMaxTokens}
                onChange={setEditImageMaxTokens}
                min="0"
                step="1"
                helper="Default: read from model"
                tooltip={IMAGE_MAX_TOKENS_TOOLTIP}
                tooltipTitle="Image Max Tokens"
              />
              <NumberField
                label="Batch Max Tokens (MTMD)"
                value={editMtmdBatchMaxTokens}
                onChange={setEditMtmdBatchMaxTokens}
                min="0"
                step="1"
                helper="Default: 1024"
                tooltip={MTMD_BATCH_MAX_TOKENS_TOOLTIP}
                tooltipTitle="Batch Max Tokens (MTMD)"
              />
            </div>
          </div>
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
      <label className="epm-perf-toggle-row" style={{ paddingTop: 0 }}>
        <InfoTooltip
          content="Remove the maximum frame limit when extracting frames from videos."
          side="right"
          stretch
          className="info-tooltip-stretch--row"
          title="Disable Frame Limit"
        >
          <span className="epm-perf-toggle-label">Disable Frame Limit</span>
          <div
            className={`epm-toggle-switch${editVideoUnlimitedMaxFrames ? ' epm-toggle-switch--on' : ''}`}
            onClick={() =>
              setEditVideoUnlimitedMaxFrames(!editVideoUnlimitedMaxFrames)
            }
            role="switch"
            aria-checked={editVideoUnlimitedMaxFrames}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setEditVideoUnlimitedMaxFrames(!editVideoUnlimitedMaxFrames);
              }
            }}
          >
            <div className="epm-toggle-switch__knob" />
          </div>
        </InfoTooltip>
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
  optimizerRunning,
  modelMaxLayers,
  modelMaxContext,
  onSetAutoOptimizer,
  onSetGpuLayersAuto,
  onSetLayers,
  onSetContextSize,
  onRunOptimizer,
  onEstimateMemory,
  initialEstimate,
  onNavigate,
  editSpecType,
  editDraftModelFilename,
}: {
  editAutoOptimizer: 'longest-context' | 'most-gpu' | 'custom' | null;
  editLayers: number | undefined;
  editContextSize: number | undefined;
  editGpuLayersAuto: boolean;
  optimizerRunning: 'longest-context' | 'most-gpu' | null;
  modelMaxLayers: number;
  modelMaxContext: number;
  onSetAutoOptimizer: (
    v: 'longest-context' | 'most-gpu' | 'custom' | null,
  ) => void;
  onSetGpuLayersAuto: (v: boolean) => void;
  onSetLayers: (v: number | undefined) => void;
  onSetContextSize: (v: number | undefined) => void;
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
  const [totalVRAM, setTotalVRAM] = useState(0);
  const [totalRAM, setTotalRAM] = useState(0);
  useEffect(() => {
    window.electronAPI
      .getVramStats()
      .then((stats) => {
        setTotalRAM(stats.ram.total * 1024 * 1024);
        setTotalVRAM(stats.vram ? stats.vram.total * 1024 * 1024 : 0);
      })
      .catch(() => {});
  }, []);
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
              title="Context Length"
            >
              <label className="epm-perf-slider-label">
                Context Length: <strong>{sliderCtx.toLocaleString()}</strong>
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
              <div className="epm-section-card__title">Cache Options</div>
              <div className="epm-section-card__preview">
                Fine-tune KV cache behaviour and data types.
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
              <div className="epm-section-card__title">Draft Model</div>
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
              <div className="epm-section-card__title">Memory Options</div>
              <div className="epm-section-card__preview">
                Control how model weights are loaded into memory.
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
              <div className="epm-section-card__title">Mixture of Experts</div>
              <div className="epm-section-card__preview">
                Control where MoE weights are loaded.
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
  editFlashAttn,
  editCacheTypeK,
  editCacheTypeV,
  onSetKvOffload,
  onSetFlashAttn,
  onSetCacheTypeK,
  onSetCacheTypeV,
  onEstimateMemory,
  onNavigate,
}: {
  editKvOffload: boolean;
  editFlashAttn: 'on' | 'off' | 'auto';
  editCacheTypeK: CacheType;
  editCacheTypeV: CacheType;
  onSetKvOffload: (v: boolean) => void;
  onSetFlashAttn: (v: 'on' | 'off' | 'auto') => void;
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
  onNavigate: (page: string) => void;
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
              content={FLASH_ATTENTION_TOOLTIP}
              side="right"
              stretch
              className="info-tooltip-stretch--row"
              title="Flash Attention"
            >
              <span className="epm-perf-toggle-label">Flash Attention</span>
              <FlashAttnSelector
                value={editFlashAttn}
                onChange={(v) => {
                  onSetFlashAttn(v);
                }}
              />
            </InfoTooltip>
          </label>
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

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <div className="epm-section__label">Advanced Options</div>
        <div style={{ marginTop: '10px' }}>
          <button
            type="button"
            className="epm-section-card"
            onClick={() => onNavigate('rope-scaling')}
          >
            <div className="epm-section-card__icon">
              <SlidersHorizontal size={18} />
            </div>
            <div className="epm-section-card__body">
              <div className="epm-section-card__title">
                Context Scaling (RoPE/YaRN)
              </div>
              <div className="epm-section-card__preview">
                Extend context length with RoPE scaling or YaRN
              </div>
            </div>
            <ChevronRight size={16} className="epm-section-card__chevron" />
          </button>
        </div>
      </div>
    </>
  );
}

// ── Memory Options subpage ──

function MemoryOptionsPage({
  editMmap,
  editMlock,
  editRepack,
  onSetMmap,
  onSetMlock,
  onSetRepack,
}: {
  editMmap: boolean;
  editMlock: boolean;
  editRepack: boolean;
  onSetMmap: (v: boolean) => void;
  onSetMlock: (v: boolean) => void;
  onSetRepack: (v: boolean) => void;
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
        <label className="epm-perf-toggle-row">
          <InfoTooltip
            content={REPACK_TOOLTIP}
            side="right"
            stretch
            className="info-tooltip-stretch--row"
            title="Weight Repacking"
          >
            <span className="epm-perf-toggle-label">Weight Repacking</span>
            <div
              className={`epm-toggle-switch${editRepack ? ' epm-toggle-switch--on' : ''}`}
              onClick={() => onSetRepack(!editRepack)}
              role="switch"
              aria-checked={editRepack}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onSetRepack(!editRepack);
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

function launchArgClass(arg: string): string {
  if (arg.startsWith('-')) return 'epm-launch-args__flag';
  if (/[\\/]/.test(arg)) return 'epm-launch-args__path';
  return 'epm-launch-args__value';
}

function groupLaunchArgs(
  args: string[],
): Array<{ lineKey: string; tokens: Array<{ text: string; cls: string }> }> {
  const lines = args.reduce<string[][]>((acc, arg) => {
    if (arg.startsWith('-') || acc.length === 0) {
      acc.push([arg]);
    } else {
      acc[acc.length - 1].push(arg);
    }
    return acc;
  }, []);
  const lineCounts = new Map<string, number>();
  return lines.map((line) => {
    const first = line[0];
    const n = (lineCounts.get(first) ?? 0) + 1;
    lineCounts.set(first, n);
    return {
      lineKey: `${first}::${n}`,
      tokens: line.map((text) => ({ text, cls: launchArgClass(text) })),
    };
  });
}

function ServerSettingsPage({
  editHost,
  setEditHost,
  editPort,
  setEditPort,
  editParallel,
  setEditParallel,
  onNavigate,
  launchArgs,
  launchArgsLoading,
  hasModel,
  condensed,
  onToggleCondensed,
  editUseCustomLaunch,
  setEditUseCustomLaunch,
  editCustomLaunchCommand,
  setEditCustomLaunchCommand,
  customFlagsCount,
  modelFilename,
}: {
  editHost: string;
  setEditHost: (v: string) => void;
  editPort: string;
  setEditPort: (v: string) => void;
  editParallel: string;
  setEditParallel: (v: string) => void;
  onNavigate: (page: string) => void;
  launchArgs: string[] | null;
  launchArgsLoading: boolean;
  hasModel: boolean;
  condensed: boolean;
  onToggleCondensed: (v: boolean) => void;
  editUseCustomLaunch: boolean;
  setEditUseCustomLaunch: (v: boolean) => void;
  editCustomLaunchCommand: string;
  setEditCustomLaunchCommand: (v: string) => void;
  customFlagsCount: number;
  modelFilename: string;
}) {
  let emptyMessage = 'Launch arguments unavailable.';
  if (launchArgsLoading) {
    emptyMessage = 'Building launch arguments…';
  } else if (!hasModel) {
    emptyMessage = 'Select a model to preview its launch arguments.';
  }
  void modelFilename;

  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(async () => {
    if (!launchArgs || launchArgs.length === 0) return;
    const text = `llama-server ${launchArgs
      .map((a) =>
        a.includes(' ') || a.includes('"') ? `"${a.replace(/"/g, '\\"')}"` : a,
      )
      .join(' ')}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [launchArgs]);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  return (
    <>
      <h2 className="epm-page-title">Server Settings</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Advanced settings for llama-server.
      </p>

      {/* Manual Launch Toggle */}
      <div className="epm-section" style={{ marginTop: '20px' }}>
        <label className="epm-perf-toggle-row" style={{ paddingTop: 0 }}>
          <InfoTooltip
            content={MANUAL_LAUNCH_TOOLTIP}
            side="right"
            stretch
            className="info-tooltip-stretch--row"
            title="Manual Launch Command"
          >
            <span className="epm-perf-toggle-label">Manual Launch Command</span>
            <div
              className={`epm-toggle-switch${editUseCustomLaunch ? ' epm-toggle-switch--on' : ''}`}
              onClick={() => setEditUseCustomLaunch(!editUseCustomLaunch)}
              role="switch"
              aria-checked={editUseCustomLaunch}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setEditUseCustomLaunch(!editUseCustomLaunch);
                }
              }}
            >
              <div className="epm-toggle-switch__knob" />
            </div>
          </InfoTooltip>
        </label>
        <div
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            marginTop: '4px',
            lineHeight: 1.4,
          }}
        >
          {editUseCustomLaunch
            ? 'Full replace: the command below is passed verbatim to llama-server. Include --model, --host, --port, etc. No automatic injection.'
            : 'Automatic mode: Synapse builds the command from your settings. Add extra flags via Custom Flags submenu.'}
        </div>
      </div>

      {!editUseCustomLaunch ? (
        <>
          <div className="epm-section" style={{ marginTop: '20px' }}>
            <div
              style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="epm-section__label">Host</div>
                <InfoTooltip
                  content={HOST_TOOLTIP}
                  side="bottom"
                  stretch
                  className="info-tooltip-stretch--col"
                  title="Host"
                >
                  <input
                    type="text"
                    className="epm-input"
                    value={editHost}
                    onChange={(e) => setEditHost(e.target.value)}
                    placeholder="127.0.0.1"
                    style={{ marginTop: '8px' }}
                  />
                </InfoTooltip>
              </div>
              <div style={{ flex: 1, minWidth: 0, maxWidth: '240px' }}>
                <div className="epm-section__label">Port</div>
                <InfoTooltip
                  content={PORT_TOOLTIP}
                  side="bottom"
                  stretch
                  className="info-tooltip-stretch--col"
                  title="Port"
                >
                  <input
                    type="number"
                    className="epm-input"
                    value={editPort}
                    onChange={(e) => setEditPort(e.target.value)}
                    placeholder="9931"
                    min="1"
                    max="65535"
                    style={{ marginTop: '8px' }}
                  />
                </InfoTooltip>
              </div>
            </div>
          </div>

          <div className="epm-section" style={{ marginTop: '20px' }}>
            <div className="epm-number-grid">
              <NumberField
                label="Parallel Server Slot Count"
                value={editParallel}
                onChange={setEditParallel}
                min="-1"
                max="999"
                step="1"
                helper="Default: 1 (-1 = auto)"
                tooltip={[
                  'Controls how many concurrent requests the server can handle at once.',
                  'More slots allow multiple users or simultaneous conversations but use more memory.',
                  'Set to -1 to let the server choose automatically based on available resources.',
                ]}
                tooltipTitle="Parallel Server Slots"
              />
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
                onClick={() => onNavigate('cors-settings')}
              >
                <div className="epm-section-card__icon">
                  <Shield size={18} />
                </div>
                <div className="epm-section-card__body">
                  <div className="epm-section-card__title">CORS</div>
                  <div className="epm-section-card__preview">
                    Configure cross-origin access for the llama-server API.
                  </div>
                </div>
                <ChevronRight size={16} className="epm-section-card__chevron" />
              </button>
              <button
                type="button"
                className="epm-section-card"
                onClick={() => onNavigate('custom-flags')}
              >
                <div className="epm-section-card__icon">
                  <Flag size={18} />
                </div>
                <div className="epm-section-card__body">
                  <div className="epm-section-card__title">Custom Flags</div>
                  <div className="epm-section-card__preview">
                    {customFlagsCount > 0
                      ? `${customFlagsCount} flag${customFlagsCount === 1 ? '' : 's'}`
                      : 'Add arbitrary llama-server flags'}
                  </div>
                </div>
                <ChevronRight size={16} className="epm-section-card__chevron" />
              </button>
            </div>
          </div>

          {/* Launch Arguments Preview (auto) */}
          <div className="epm-section" style={{ marginTop: '20px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                marginBottom: '8px',
              }}
            >
              <div className="epm-section__label" style={{ marginBottom: 0 }}>
                Launch Arguments
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <button
                  type="button"
                  className={`epm-launch-args__copy ${copied ? 'epm-launch-args__copy--copied' : ''}`}
                  onClick={handleCopy}
                  disabled={!launchArgs || launchArgs.length === 0}
                  title={copied ? 'Copied' : 'Copy launch command'}
                  aria-label="Copy launch command"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <div className="epm-perf-toggle-row" style={{ padding: 0 }}>
                  <span className="epm-perf-toggle-label">Condensed view</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={condensed}
                    aria-label="Condensed view"
                    className={`epm-toggle-switch${condensed ? ' epm-toggle-switch--on' : ''}`}
                    onClick={() => onToggleCondensed(!condensed)}
                  >
                    <div className="epm-toggle-switch__knob" />
                  </button>
                </div>
              </div>
            </div>
            <div className="epm-launch-args__desc">
              Preview of the exact command line passed to llama-server when this
              profile is loaded.
            </div>
            <div
              className={`epm-launch-args${condensed ? ' epm-launch-args--condensed' : ''}`}
            >
              {launchArgs ? (
                <>
                  <span className="epm-launch-args__binary">llama-server</span>
                  {groupLaunchArgs(launchArgs).map((line) => (
                    <div key={line.lineKey} className="epm-launch-args__line">
                      {line.tokens.map((token) => (
                        <span key={token.text} className={token.cls}>
                          {token.text}
                        </span>
                      ))}
                    </div>
                  ))}
                </>
              ) : (
                <span className="epm-launch-args__empty">{emptyMessage}</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Manual mode: editable launch command reusing existing preview textarea */}
          <div className="epm-section" style={{ marginTop: '20px' }}>
            <InfoTooltip
              content={MANUAL_LAUNCH_TOOLTIP}
              side="right"
              hideIcon
              title="Launch Command"
            >
              <div className="epm-section__label">Launch Command</div>
            </InfoTooltip>
            <div className="epm-launch-args__desc">
              Replaces the auto-generated command above. Paste the full command
              or just arguments. You must include --host / --port yourself.
              Invalid commands will fail to start – allowed per spec.
            </div>
            <textarea
              className="epm-textarea epm-textarea--editor epm-launch-args--editable"
              value={editCustomLaunchCommand}
              onChange={(e) => setEditCustomLaunchCommand(e.target.value)}
              placeholder='llama-server --model "/path/to/model.gguf" --ctx-size 8192 --host 127.0.0.1 --port 9931 --verbose'
              style={{
                minHeight: '140px',
                fontFamily: 'Cascadia Code, JetBrains Mono, monospace',
                fontSize: '13px',
              }}
            />
          </div>

          <div className="epm-section" style={{ marginTop: '20px' }}>
            <div className="epm-section__label">
              Advanced Options (ignored in manual)
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '10px',
                opacity: 0.6,
              }}
            >
              <button
                type="button"
                className="epm-section-card"
                onClick={() => onNavigate('cors-settings')}
              >
                <div className="epm-section-card__icon">
                  <Shield size={18} />
                </div>
                <div className="epm-section-card__body">
                  <div className="epm-section-card__title">CORS</div>
                  <div className="epm-section-card__preview">
                    Ignored when manual is enabled
                  </div>
                </div>
                <ChevronRight size={16} className="epm-section-card__chevron" />
              </button>
              <button
                type="button"
                className="epm-section-card"
                onClick={() => onNavigate('custom-flags')}
              >
                <div className="epm-section-card__icon">
                  <Flag size={18} />
                </div>
                <div className="epm-section-card__body">
                  <div className="epm-section-card__title">Custom Flags</div>
                  <div className="epm-section-card__preview">
                    Ignored when manual is enabled
                  </div>
                </div>
                <ChevronRight size={16} className="epm-section-card__chevron" />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function CorsSettingsPage({
  editCorsOrigins,
  setEditCorsOrigins,
  editCorsMethods,
  setEditCorsMethods,
  editCorsHeaders,
  setEditCorsHeaders,
  editCorsCredentials,
  setEditCorsCredentials,
}: {
  editCorsOrigins: string;
  setEditCorsOrigins: (v: string) => void;
  editCorsMethods: string;
  setEditCorsMethods: (v: string) => void;
  editCorsHeaders: string;
  setEditCorsHeaders: (v: string) => void;
  editCorsCredentials: boolean;
  setEditCorsCredentials: (v: boolean) => void;
}) {
  return (
    <>
      <h2 className="epm-page-title">CORS</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Configure Cross-Origin Resource Sharing (CORS) for the llama-server HTTP
        API.
      </p>

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <div className="epm-section__label">Allowed Origins</div>
        <InfoTooltip
          content={CORS_ORIGINS_TOOLTIP}
          side="bottom"
          stretch
          className="info-tooltip-stretch--col"
          title="CORS Origins"
        >
          <input
            type="text"
            className="epm-input"
            value={editCorsOrigins}
            onChange={(e) => setEditCorsOrigins(e.target.value)}
            placeholder="*"
            style={{ marginTop: '8px' }}
          />
        </InfoTooltip>
      </div>

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <div className="epm-section__label">Allowed Methods</div>
        <InfoTooltip
          content={CORS_METHODS_TOOLTIP}
          side="bottom"
          stretch
          className="info-tooltip-stretch--col"
          title="CORS Methods"
        >
          <input
            type="text"
            className="epm-input"
            value={editCorsMethods}
            onChange={(e) => setEditCorsMethods(e.target.value)}
            placeholder="GET, POST, DELETE, OPTIONS"
            style={{ marginTop: '8px' }}
          />
        </InfoTooltip>
      </div>

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <div className="epm-section__label">Allowed Headers</div>
        <InfoTooltip
          content={CORS_HEADERS_TOOLTIP}
          side="bottom"
          stretch
          className="info-tooltip-stretch--col"
          title="CORS Headers"
        >
          <input
            type="text"
            className="epm-input"
            value={editCorsHeaders}
            onChange={(e) => setEditCorsHeaders(e.target.value)}
            placeholder="*"
            style={{ marginTop: '8px' }}
          />
        </InfoTooltip>
      </div>

      <div className="epm-section" style={{ marginTop: '20px' }}>
        <label className="epm-perf-toggle-row">
          <InfoTooltip
            content={CORS_CREDENTIALS_TOOLTIP}
            side="bottom"
            stretch
            className="info-tooltip-stretch--row"
            title="CORS Credentials"
          >
            <span className="epm-perf-toggle-label">Allow Credentials</span>
            <div
              className={`epm-toggle-switch${editCorsCredentials ? ' epm-toggle-switch--on' : ''}`}
              onClick={() => setEditCorsCredentials(!editCorsCredentials)}
              role="switch"
              aria-checked={editCorsCredentials}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setEditCorsCredentials(!editCorsCredentials);
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

function CustomFlagsPage({
  editCustomFlags,
  setEditCustomFlags,
}: {
  editCustomFlags: string[];
  setEditCustomFlags: (v: string[]) => void;
}) {
  const addFlag = () => {
    setEditCustomFlags([...editCustomFlags, '']);
  };
  const updateFlag = (idx: number, val: string) => {
    const next = [...editCustomFlags];
    next[idx] = val;
    setEditCustomFlags(next);
  };
  const removeFlag = (idx: number) => {
    const next = editCustomFlags.filter((_, i) => i !== idx);
    setEditCustomFlags(next);
  };

  return (
    <>
      <h2 className="epm-page-title">Custom Flags</h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}
      >
        Add arbitrary llama-server flags. Each row is one flag line — e.g.
        &quot;--verbose&quot; (no value), &quot;--threads 4&quot;, or
        &apos;--foo &quot;bar baz&quot;&apos; with quotes. Rows are appended
        before --metrics --no-ui.
      </p>

      <div className="epm-section">
        <InfoTooltip
          content={CUSTOM_FLAGS_PAGE_TOOLTIP}
          side="right"
          hideIcon
          title="Custom Flags"
        >
          <div className="epm-section__label">Flag Rows</div>
        </InfoTooltip>
        <div className="epm-launch-args__desc" style={{ marginTop: '6px' }}>
          One string per row; empty rows are ignored. Use shell-like quoting for
          values with spaces.
        </div>

        <div className="epm-custom-flags-list">
          {editCustomFlags.length === 0 ? (
            <div
              style={{
                padding: '12px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              No custom flags. Click “Add flag” to create one.
            </div>
          ) : (
            editCustomFlags.map((flag, idx) => (
              <div key={idx} className="epm-custom-flag-row">
                <input
                  type="text"
                  className="epm-input epm-custom-flag-input"
                  value={flag}
                  onChange={(e) => updateFlag(idx, e.target.value)}
                  placeholder="--flag value or --verbose"
                />
                <button
                  type="button"
                  className="epm-custom-flag-remove"
                  onClick={() => removeFlag(idx)}
                  aria-label={`Remove flag ${idx + 1}`}
                  title="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <button type="button" className="epm-custom-flag-add" onClick={addFlag}>
          <Plus size={16} />
          Add flag
        </button>
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
  defaultHost,
  defaultPort,
  defaultCorsOrigins,
  defaultCorsMethods,
  defaultCorsHeaders,
  defaultCorsCredentials,
}: EditProfileModalProps) {
  const [currentPage, setCurrentPage] = useState('main');
  const [navDirection, setNavDirection] = useState<'forward' | 'backward'>(
    'forward',
  );
  const [animating, setAnimating] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [pageBeforeSearch, setPageBeforeSearch] = useState<string | null>(null);
  const [pendingToolCategoryId, setPendingToolCategoryId] = useState<
    string | null
  >(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trimmedSearchQuery = searchQuery.trim();
  const isSearching = trimmedSearchQuery.length > 0;

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
  const [editIgnoreEos, setEditIgnoreEos] = useState(
    profile?.ignoreEos === true,
  );
  const [editTypicalP, setEditTypicalP] = useState(
    profile?.typicalP !== undefined ? String(profile.typicalP) : '',
  );
  const [editTopNSigma, setEditTopNSigma] = useState(
    profile?.topNSigma !== undefined ? String(profile.topNSigma) : '',
  );
  const [editXtcProbability, setEditXtcProbability] = useState(
    profile?.xtc?.probability !== undefined
      ? String(profile.xtc.probability)
      : '',
  );
  const [editXtcThreshold, setEditXtcThreshold] = useState(
    profile?.xtc?.threshold !== undefined ? String(profile.xtc.threshold) : '',
  );
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
  const [editMmprojOffload, setEditMmprojOffload] = useState<boolean>(
    profile?.mmprojOffload ?? true,
  );
  const [editImageMinTokens, setEditImageMinTokens] = useState<string>(
    profile?.imageMinTokens !== undefined ? String(profile.imageMinTokens) : '',
  );
  const [editImageMaxTokens, setEditImageMaxTokens] = useState<string>(
    profile?.imageMaxTokens !== undefined ? String(profile.imageMaxTokens) : '',
  );
  const [editMtmdBatchMaxTokens, setEditMtmdBatchMaxTokens] = useState<string>(
    profile?.mtmdBatchMaxTokens !== undefined
      ? String(profile.mtmdBatchMaxTokens)
      : '',
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

  // DRY sampling options
  const [editDryEnabled, setEditDryEnabled] = useState(
    profile?.repeatPenalty?.dry?.enabled === true,
  );
  const [editDryMultiplier, setEditDryMultiplier] = useState(
    profile?.repeatPenalty?.dry?.multiplier !== undefined
      ? String(profile.repeatPenalty.dry.multiplier)
      : '',
  );
  const [editDryBase, setEditDryBase] = useState(
    profile?.repeatPenalty?.dry?.base !== undefined
      ? String(profile.repeatPenalty.dry.base)
      : '',
  );
  const [editDryAllowedLength, setEditDryAllowedLength] = useState(
    profile?.repeatPenalty?.dry?.allowedLength !== undefined
      ? String(profile.repeatPenalty.dry.allowedLength)
      : '',
  );
  const [editDryPenaltyLastN, setEditDryPenaltyLastN] = useState(
    profile?.repeatPenalty?.dry?.penaltyLastN !== undefined
      ? String(profile.repeatPenalty.dry.penaltyLastN)
      : '',
  );
  const [editDrySequenceBreakers, setEditDrySequenceBreakers] = useState(
    profile?.repeatPenalty?.dry?.sequenceBreakers
      ? profile.repeatPenalty.dry.sequenceBreakers.join(', ')
      : '',
  );

  // Performance options
  const [editAutoOptimizer, setEditAutoOptimizer] = useState<
    'longest-context' | 'most-gpu' | 'custom' | null
  >(profile?.autoOptimizer ?? 'longest-context');
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
  const [editRepack, setEditRepack] = useState<boolean>(
    profile?.repack ?? true,
  );
  const [editCacheTypeK, setEditCacheTypeK] = useState<CacheType>(
    profile?.cacheTypeK ?? 'f16',
  );
  const [editCacheTypeV, setEditCacheTypeV] = useState<CacheType>(
    profile?.cacheTypeV ?? 'f16',
  );
  const [editFlashAttn, setEditFlashAttn] = useState<'on' | 'off' | 'auto'>(
    profile?.flashAttn ?? 'auto',
  );

  // Context scaling (RoPE/YaRN) options
  const [editRopeScaling, setEditRopeScaling] = useState<string>(
    profile?.rope?.scaling ?? '',
  );
  const [editRopeScale, setEditRopeScale] = useState<string>(
    profile?.rope?.scale !== undefined ? String(profile.rope.scale) : '',
  );
  const [editRopeFreqBase, setEditRopeFreqBase] = useState<string>(
    profile?.rope?.freqBase !== undefined ? String(profile.rope.freqBase) : '',
  );
  const [editRopeFreqScale, setEditRopeFreqScale] = useState<string>(
    profile?.rope?.freqScale !== undefined
      ? String(profile.rope.freqScale)
      : '',
  );
  const [editYarnOrigCtx, setEditYarnOrigCtx] = useState<string>(
    profile?.yarn?.origCtx !== undefined ? String(profile.yarn.origCtx) : '',
  );
  const [editYarnExtFactor, setEditYarnExtFactor] = useState<string>(
    profile?.yarn?.extFactor !== undefined
      ? String(profile.yarn.extFactor)
      : '',
  );
  const [editYarnAttnFactor, setEditYarnAttnFactor] = useState<string>(
    profile?.yarn?.attnFactor !== undefined
      ? String(profile.yarn.attnFactor)
      : '',
  );
  const [editYarnBetaSlow, setEditYarnBetaSlow] = useState<string>(
    profile?.yarn?.betaSlow !== undefined ? String(profile.yarn.betaSlow) : '',
  );
  const [editYarnBetaFast, setEditYarnBetaFast] = useState<string>(
    profile?.yarn?.betaFast !== undefined ? String(profile.yarn.betaFast) : '',
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

  // Server settings
  const [editParallel, setEditParallel] = useState<string>(
    String(profile?.parallel ?? 1),
  );
  const [editCorsOrigins, setEditCorsOrigins] = useState<string>(
    profile !== null
      ? (profile.corsOrigins ?? 'localhost')
      : (defaultCorsOrigins ?? 'localhost'),
  );
  const [editCorsMethods, setEditCorsMethods] = useState<string>(
    profile !== null ? (profile.corsMethods ?? '') : (defaultCorsMethods ?? ''),
  );
  const [editCorsHeaders, setEditCorsHeaders] = useState<string>(
    profile !== null ? (profile.corsHeaders ?? '') : (defaultCorsHeaders ?? ''),
  );
  const [editCorsCredentials, setEditCorsCredentials] = useState<boolean>(
    profile !== null
      ? (profile.corsCredentials ?? true)
      : (defaultCorsCredentials ?? true),
  );

  const [editHost, setEditHost] = useState<string>(
    profile !== null
      ? (profile.host ?? '127.0.0.1')
      : (defaultHost ?? '127.0.0.1'),
  );
  const [editPort, setEditPort] = useState<string>(
    profile !== null
      ? String(profile.port ?? 9931)
      : String(defaultPort ?? 9931),
  );

  const [editCustomFlags, setEditCustomFlags] = useState<string[]>(
    profile?.customFlags ?? [],
  );
  const [editUseCustomLaunch, setEditUseCustomLaunch] = useState<boolean>(
    !!profile?.useCustomLaunch,
  );
  const [editCustomLaunchCommand, setEditCustomLaunchCommand] =
    useState<string>(profile?.customLaunchCommand ?? '');

  // Launch arguments preview (built by the main process via chat.ts)
  const [launchArgs, setLaunchArgs] = useState<string[] | null>(null);
  const [launchArgsLoading, setLaunchArgsLoading] = useState(false);
  const [launchArgsCondensed, setLaunchArgsCondensed] = useState(false);
  const launchArgsReqId = useRef(0);
  useEffect(() => {
    if (editUseCustomLaunch) {
      launchArgsReqId.current += 1;
      setLaunchArgs(null);
      setLaunchArgsLoading(false);
      return undefined;
    }
    if (!editModelFilename) {
      launchArgsReqId.current += 1;
      setLaunchArgs(null);
      setLaunchArgsLoading(false);
      return undefined;
    }
    launchArgsReqId.current += 1;
    const reqId = launchArgsReqId.current;
    setLaunchArgsLoading(true);
    const timer = setTimeout(() => {
      const rope: NonNullable<Profile['rope']> = {};
      if (editRopeScaling) {
        rope.scaling = editRopeScaling as 'none' | 'linear' | 'yarn';
      }
      if (editRopeScale !== '' && parseFloat(editRopeScale) !== 1.0) {
        rope.scale = parseFloat(editRopeScale);
      }
      if (editRopeFreqBase !== '') {
        rope.freqBase = parseFloat(editRopeFreqBase);
      }
      if (editRopeFreqScale !== '' && parseFloat(editRopeFreqScale) !== 1.0) {
        rope.freqScale = parseFloat(editRopeFreqScale);
      }

      const yarn: NonNullable<Profile['yarn']> = {};
      if (editYarnOrigCtx !== '' && parseFloat(editYarnOrigCtx) !== 0) {
        yarn.origCtx = parseFloat(editYarnOrigCtx);
      }
      if (editYarnExtFactor !== '' && parseFloat(editYarnExtFactor) !== -1.0) {
        yarn.extFactor = parseFloat(editYarnExtFactor);
      }
      if (
        editYarnAttnFactor !== '' &&
        parseFloat(editYarnAttnFactor) !== -1.0
      ) {
        yarn.attnFactor = parseFloat(editYarnAttnFactor);
      }
      if (editYarnBetaSlow !== '' && parseFloat(editYarnBetaSlow) !== -1.0) {
        yarn.betaSlow = parseFloat(editYarnBetaSlow);
      }
      if (editYarnBetaFast !== '' && parseFloat(editYarnBetaFast) !== -1.0) {
        yarn.betaFast = parseFloat(editYarnBetaFast);
      }

      const draft = {
        modelAuthor: editModelAuthor,
        modelFolder: editModelFolder,
        modelFilename: editModelFilename,
        projectorFilename: editProjectorFilename || undefined,
        mmprojOffload: editMmprojOffload,
        imageMinTokens: parseInt(editImageMinTokens, 10) || undefined,
        imageMaxTokens: parseInt(editImageMaxTokens, 10) || undefined,
        mtmdBatchMaxTokens: parseInt(editMtmdBatchMaxTokens, 10) || undefined,
        kvOffload: editKvOffload,
        mmap: editMmap,
        mlock: editMlock,
        repack: editRepack,
        cacheTypeK: editCacheTypeK,
        cacheTypeV: editCacheTypeV,
        flashAttn: editFlashAttn,
        rope: Object.keys(rope).length > 0 ? rope : undefined,
        yarn: Object.keys(yarn).length > 0 ? yarn : undefined,
        gpuLayersAuto: editGpuLayersAuto,
        cpuMoe: editCpuMoe,
        nCpuMoe: parseInt(editNCpuMoe, 10),
        specType: editSpecType,
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
        parallel: parseInt(editParallel, 10),
        host: editHost || undefined,
        port: parseInt(editPort, 10) || undefined,
        corsOrigins: editCorsOrigins || undefined,
        corsMethods: editCorsMethods || undefined,
        corsHeaders: editCorsHeaders || undefined,
        corsCredentials: editCorsCredentials,
        customFlags: editCustomFlags.filter((s) => s.trim().length > 0),
        useCustomLaunch: editUseCustomLaunch || undefined,
        customLaunchCommand: editUseCustomLaunch
          ? editCustomLaunchCommand
          : undefined,
      };
      window.electronAPI
        .getLaunchArgs(draft, {
          ngl: editLayers ?? 0,
          ctx: editContextSize ?? 512,
        })
        .then((args) => {
          if (launchArgsReqId.current === reqId) {
            setLaunchArgs(args);
            setLaunchArgsLoading(false);
          }
          return undefined;
        })
        .catch(() => {
          if (launchArgsReqId.current === reqId) {
            setLaunchArgs(null);
            setLaunchArgsLoading(false);
          }
          return undefined;
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [
    editModelFilename,
    editModelAuthor,
    editModelFolder,
    editProjectorFilename,
    editMmprojOffload,
    editImageMinTokens,
    editImageMaxTokens,
    editMtmdBatchMaxTokens,
    editKvOffload,
    editMmap,
    editMlock,
    editRepack,
    editCacheTypeK,
    editCacheTypeV,
    editFlashAttn,
    editRopeScaling,
    editRopeScale,
    editRopeFreqBase,
    editRopeFreqScale,
    editYarnOrigCtx,
    editYarnExtFactor,
    editYarnAttnFactor,
    editYarnBetaSlow,
    editYarnBetaFast,
    editGpuLayersAuto,
    editCpuMoe,
    editNCpuMoe,
    editSpecType,
    editDraftModelAuthor,
    editDraftModelFolder,
    editDraftModelFilename,
    editSpecDraftNMax,
    editSpecDraftNMin,
    editSpecDraftPSplit,
    editSpecDraftPMin,
    editParallel,
    editHost,
    editPort,
    editCorsOrigins,
    editCorsMethods,
    editCorsHeaders,
    editCorsCredentials,
    editCustomFlags,
    editUseCustomLaunch,
    editCustomLaunchCommand,
    editLayers,
    editContextSize,
  ]);

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

  const parallelValue = parseInt(editParallel, 10);
  const effectiveParallel = parallelValue === -1 ? 1 : parallelValue;

  // Model metadata (max layers/context) — fetched when model changes
  const [modelMeta, setModelMeta] = useState<{
    maxLayers: number;
    maxContext: number;
  } | null>(null);

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
        parallel: effectiveParallel,
      })
      .then((meta) => setModelMeta(meta))
      .catch(() => setModelMeta(null));
  }, [
    editModelFilename,
    editProjectorFilename,
    editModelAuthor,
    editModelFolder,
  ]);

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
        flashAttn: editFlashAttn,
        mmap: editMmap,
        cacheTypeK: editCacheTypeK,
        cacheTypeV: editCacheTypeV,
        parallel: effectiveParallel,
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
      flashAttn: editFlashAttn,
      mmap: mmap ?? editMmap,
      cacheTypeK: cacheTypeK ?? editCacheTypeK,
      cacheTypeV: cacheTypeV ?? editCacheTypeV,
      parallel: effectiveParallel,
    });
    setLastEstimate(result);
    return result;
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleSave();
    }
  };

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setPageBeforeSearch(null);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopPropagation();
      if (!pageBeforeSearch && !isSearching) {
        setPageBeforeSearch(currentPage);
      }
      searchInputRef.current?.focus();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !isSearching) {
        e.preventDefault();
        if (!pageBeforeSearch) {
          setPageBeforeSearch(currentPage);
        }
        searchInputRef.current?.focus();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (showModelModal || showProjectorModal || showDraftModelModal) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (isSearching) {
          e.stopPropagation();
          clearSearch();
        }
        return;
      }
      if (isSearching) {
        clearSearch();
        return;
      }
      handleSave();
    }
  };

  // Dynamic tool/extension entries for search
  const toolSearchEntries: SearchIndexEntry[] = useMemo(() => {
    const entries: SearchIndexEntry[] = [];
    extensionGroups.forEach(({ extension, toolKeys }) => {
      const categoryName = extension.manifest.name;
      entries.push({
        id: `tools:category:${extension.manifest.id}`,
        label: categoryName,
        keywords: ['tools', 'extension', extension.manifest.description ?? ''],
        page: 'tools',
        categoryId: extension.manifest.id,
      });
      toolKeys.forEach((tk) => {
        const meta = getToolMeta(tk);
        if (meta) {
          entries.push({
            id: `tools:tool:${tk}`,
            label: meta.label || tk,
            keywords: [categoryName, meta.description ?? '', tk],
            page: 'tools',
            categoryId: extension.manifest.id,
          });
        }
      });
    });
    return entries;
  }, [extensionGroups]);

  const searchResults: ScoredSearchResult[] = useMemo(
    () =>
      searchEntries(
        [...SEARCH_INDEX, ...toolSearchEntries],
        trimmedSearchQuery,
      ),
    [trimmedSearchQuery, toolSearchEntries],
  );

  const handleSearchChange = (value: string) => {
    if (!pageBeforeSearch && !isSearching && value.trim()) {
      setPageBeforeSearch(currentPage);
    }
    setSearchQuery(value);
    if (!value.trim()) {
      setPageBeforeSearch(null);
    }
  };

  const handleSearchSelect = (entry: ScoredSearchResult) => {
    if (entry.categoryId) {
      setPendingToolCategoryId(entry.categoryId);
    }
    const target = entry.page;
    setSearchQuery('');
    setPageBeforeSearch(null);
    if (target !== currentPage) {
      navigateTo(target);
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
    if (!editName.trim()) return;

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

    const buildRopeScaling = (): Profile['rope'] => {
      const rope: NonNullable<Profile['rope']> = {};
      if (editRopeScaling) {
        rope.scaling = editRopeScaling as 'none' | 'linear' | 'yarn';
      }
      if (editRopeScale !== '' && parseFloat(editRopeScale) !== 1.0) {
        rope.scale = parseFloat(editRopeScale);
      }
      if (editRopeFreqBase !== '') {
        rope.freqBase = parseFloat(editRopeFreqBase);
      }
      if (editRopeFreqScale !== '' && parseFloat(editRopeFreqScale) !== 1.0) {
        rope.freqScale = parseFloat(editRopeFreqScale);
      }
      return Object.keys(rope).length > 0 ? rope : undefined;
    };

    const buildYarnScaling = (): Profile['yarn'] => {
      const yarn: NonNullable<Profile['yarn']> = {};
      if (editYarnOrigCtx !== '' && parseFloat(editYarnOrigCtx) !== 0) {
        yarn.origCtx = parseFloat(editYarnOrigCtx);
      }
      if (editYarnExtFactor !== '' && parseFloat(editYarnExtFactor) !== -1.0) {
        yarn.extFactor = parseFloat(editYarnExtFactor);
      }
      if (
        editYarnAttnFactor !== '' &&
        parseFloat(editYarnAttnFactor) !== -1.0
      ) {
        yarn.attnFactor = parseFloat(editYarnAttnFactor);
      }
      if (editYarnBetaSlow !== '' && parseFloat(editYarnBetaSlow) !== -1.0) {
        yarn.betaSlow = parseFloat(editYarnBetaSlow);
      }
      if (editYarnBetaFast !== '' && parseFloat(editYarnBetaFast) !== -1.0) {
        yarn.betaFast = parseFloat(editYarnBetaFast);
      }
      return Object.keys(yarn).length > 0 ? yarn : undefined;
    };

    const buildRepeatPenalty = (): Profile['repeatPenalty'] => {
      if (!editRpEnabled && !editDryEnabled) return { enabled: false };
      const rp: NonNullable<Profile['repeatPenalty']> = {};
      if (editRpEnabled) {
        if (editRpLastTokens !== '')
          rp.lastTokens = parseInt(editRpLastTokens, 10);
        if (editRpPenalty !== '') rp.penalty = parseFloat(editRpPenalty);
        if (editRpFrequencyPenalty !== '')
          rp.frequencyPenalty = parseFloat(editRpFrequencyPenalty);
        if (editRpPresencePenalty !== '')
          rp.presencePenalty = parseFloat(editRpPresencePenalty);
      }
      if (editDryEnabled) {
        const dry: NonNullable<NonNullable<Profile['repeatPenalty']>['dry']> = {
          enabled: true,
        };
        if (editDryMultiplier !== '')
          dry.multiplier = parseFloat(editDryMultiplier);
        if (editDryBase !== '') dry.base = parseFloat(editDryBase);
        if (editDryAllowedLength !== '')
          dry.allowedLength = parseInt(editDryAllowedLength, 10);
        if (editDryPenaltyLastN !== '')
          dry.penaltyLastN = parseInt(editDryPenaltyLastN, 10);
        if (editDrySequenceBreakers.trim()) {
          const raw = editDrySequenceBreakers.trim();
          if (raw.toLowerCase() === 'none') {
            dry.sequenceBreakers = [];
          } else {
            dry.sequenceBreakers = raw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }
        rp.dry = dry;
      }
      return Object.keys(rp).length > 0 ? rp : undefined;
    };

    const buildAdvancedSamplers = (): Partial<Profile> => {
      const s: Partial<Profile> = {};
      if (editIgnoreEos) s.ignoreEos = true;
      const typicalP = parseFloat(editTypicalP);
      if (!isNaN(typicalP) && typicalP !== 1.0) s.typicalP = typicalP;
      const topNSigma = parseFloat(editTopNSigma);
      if (!isNaN(topNSigma) && topNSigma !== -1.0) s.topNSigma = topNSigma;
      const xtcProbability = parseFloat(editXtcProbability);
      const xtcThreshold = parseFloat(editXtcThreshold);
      if (
        !isNaN(xtcProbability) &&
        xtcProbability !== 0 &&
        !isNaN(xtcThreshold) &&
        xtcThreshold !== 0.1
      ) {
        s.xtc = { probability: xtcProbability, threshold: xtcThreshold };
      }
      return s;
    };

    const now = Date.now();
    const updatedProfile: Profile = {
      ...profile,
      id: profile?.id ?? now.toString(),
      name: editName.trim(),
      model: editModelFilename ? modelRelativePath : '',
      projector: projectorRelativePath || undefined,
      modelAuthor: editModelAuthor,
      modelFolder: editModelFolder,
      modelFilename: editModelFilename,
      projectorFilename: editProjectorFilename || undefined,
      mmprojOffload: editMmprojOffload,
      ...(parseInt(editImageMinTokens, 10) > 0
        ? { imageMinTokens: parseInt(editImageMinTokens, 10) }
        : {}),
      ...(parseInt(editImageMaxTokens, 10) > 0
        ? { imageMaxTokens: parseInt(editImageMaxTokens, 10) }
        : {}),
      ...(parseInt(editMtmdBatchMaxTokens, 10) > 0
        ? { mtmdBatchMaxTokens: parseInt(editMtmdBatchMaxTokens, 10) }
        : {}),
      systemPrompt: editSystemPrompt,
      temperature: parseFloat(editTemperature),
      topK: parseInt(editTopK, 10),
      topP: parseFloat(editTopP),
      minP: parseFloat(editMinP),
      seed: parseInt(editSeed, 10),
      tools: editTools.filter((t) => getAvailableToolNames().includes(t)),
      repeatPenalty: buildRepeatPenalty(),
      ...buildAdvancedSamplers(),
      kvOffload: editKvOffload,
      flashAttn: editFlashAttn,
      cacheTypeK: editCacheTypeK,
      cacheTypeV: editCacheTypeV,
      rope: buildRopeScaling(),
      yarn: buildYarnScaling(),
      mmap: editMmap,
      mlock: editMlock,
      repack: editRepack,
      gpuLayersAuto: editGpuLayersAuto,
      ...(modelMeta
        ? {
            maxForModel: modelRelativePath,
            maxLayers: modelMeta.maxLayers,
            maxContext: modelMeta.maxContext,
          }
        : {}),
      estimation: lastEstimate ?? undefined,
      ...(editAutoOptimizer ? { autoOptimizer: editAutoOptimizer } : {}),
      ...(editLayers !== undefined && editContextSize !== undefined
        ? {
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
      parallel: parseInt(editParallel, 10),
      host: editHost || undefined,
      port: parseInt(editPort, 10) || undefined,
      corsOrigins: editCorsOrigins || undefined,
      corsMethods: editCorsMethods || undefined,
      corsHeaders: editCorsHeaders || undefined,
      corsCredentials: editCorsCredentials,
      customFlags: (() => {
        const f = editCustomFlags.map((s) => s.trim()).filter(Boolean);
        return f.length > 0 ? f : undefined;
      })(),
      useCustomLaunch: editUseCustomLaunch ? true : undefined,
      customLaunchCommand:
        editUseCustomLaunch && editCustomLaunchCommand.trim()
          ? editCustomLaunchCommand
          : undefined,
      order:
        profile?.order ??
        (profiles.length === 0
          ? 0
          : Math.min(...profiles.map((p) => p.order ?? p.createdAt ?? 0)) - 1),
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

  const renderPage = () => {
    if (isSearching) {
      return (
        <SearchResultsPage
          query={trimmedSearchQuery}
          results={searchResults}
          onSelect={handleSearchSelect}
          onClear={clearSearch}
        />
      );
    }
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
            editAutoOptimizer={editAutoOptimizer}
            editLayers={editLayers}
            editContextSize={editContextSize}
            modelMaxLayers={modelMeta?.maxLayers ?? 200}
            modelMaxContext={modelMeta?.maxContext ?? 131072}
            editParallel={editParallel}
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
            openCategoryId={pendingToolCategoryId}
            onOpenCategoryConsumed={() => setPendingToolCategoryId(null)}
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
            onNavigate={navigateTo}
          />
        );
      case 'advanced-samplers':
        return (
          <AdvancedSamplersPage
            editIgnoreEos={editIgnoreEos}
            setEditIgnoreEos={setEditIgnoreEos}
            editSeed={editSeed}
            setEditSeed={setEditSeed}
            editTypicalP={editTypicalP}
            setEditTypicalP={setEditTypicalP}
            editTopNSigma={editTopNSigma}
            setEditTopNSigma={setEditTopNSigma}
            editXtcProbability={editXtcProbability}
            setEditXtcProbability={setEditXtcProbability}
            editXtcThreshold={editXtcThreshold}
            setEditXtcThreshold={setEditXtcThreshold}
          />
        );
      case 'performance':
        return (
          <PerformancePage
            editAutoOptimizer={editAutoOptimizer}
            editLayers={editLayers}
            editContextSize={editContextSize}
            editGpuLayersAuto={editGpuLayersAuto}
            optimizerRunning={optimizerRunning}
            modelMaxLayers={modelMeta?.maxLayers ?? 200}
            modelMaxContext={modelMeta?.maxContext ?? 131072}
            onSetAutoOptimizer={setEditAutoOptimizer}
            onSetGpuLayersAuto={setEditGpuLayersAuto}
            onSetLayers={setEditLayers}
            onSetContextSize={setEditContextSize}
            onRunOptimizer={handleRunOptimizer}
            onEstimateMemory={handleEstimateMemory}
            initialEstimate={profile?.estimation ?? lastEstimate}
            onNavigate={navigateTo}
            editSpecType={editSpecType}
            editDraftModelFilename={editDraftModelFilename}
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
      case 'server-settings':
        return (
          <ServerSettingsPage
            editHost={editHost}
            setEditHost={setEditHost}
            editPort={editPort}
            setEditPort={setEditPort}
            editParallel={editParallel}
            setEditParallel={setEditParallel}
            onNavigate={navigateTo}
            launchArgs={launchArgs}
            launchArgsLoading={launchArgsLoading}
            hasModel={!!editModelFilename}
            condensed={launchArgsCondensed}
            onToggleCondensed={setLaunchArgsCondensed}
            editUseCustomLaunch={editUseCustomLaunch}
            setEditUseCustomLaunch={setEditUseCustomLaunch}
            editCustomLaunchCommand={editCustomLaunchCommand}
            setEditCustomLaunchCommand={setEditCustomLaunchCommand}
            customFlagsCount={editCustomFlags.filter((s) => s.trim()).length}
            modelFilename={editModelFilename}
          />
        );
      case 'cors-settings':
        return (
          <CorsSettingsPage
            editCorsOrigins={editCorsOrigins}
            setEditCorsOrigins={setEditCorsOrigins}
            editCorsMethods={editCorsMethods}
            setEditCorsMethods={setEditCorsMethods}
            editCorsHeaders={editCorsHeaders}
            setEditCorsHeaders={setEditCorsHeaders}
            editCorsCredentials={editCorsCredentials}
            setEditCorsCredentials={setEditCorsCredentials}
          />
        );
      case 'custom-flags':
        return (
          <CustomFlagsPage
            editCustomFlags={editCustomFlags}
            setEditCustomFlags={setEditCustomFlags}
          />
        );
      case 'cache-options':
        return (
          <CacheOptionsPage
            editKvOffload={editKvOffload}
            editFlashAttn={editFlashAttn}
            editCacheTypeK={editCacheTypeK}
            editCacheTypeV={editCacheTypeV}
            onSetKvOffload={setEditKvOffload}
            onSetFlashAttn={setEditFlashAttn}
            onSetCacheTypeK={setEditCacheTypeK}
            onSetCacheTypeV={setEditCacheTypeV}
            onEstimateMemory={handleEstimateMemory}
            onNavigate={navigateTo}
          />
        );
      case 'memory-options':
        return (
          <MemoryOptionsPage
            editMmap={editMmap}
            editMlock={editMlock}
            editRepack={editRepack}
            onSetMmap={setEditMmap}
            onSetMlock={setEditMlock}
            onSetRepack={setEditRepack}
          />
        );
      case 'rope-scaling':
        return (
          <RopeScalingPage
            editRopeScaling={editRopeScaling}
            onSetRopeScaling={setEditRopeScaling}
            editRopeScale={editRopeScale}
            onSetRopeScale={setEditRopeScale}
            editRopeFreqBase={editRopeFreqBase}
            onSetRopeFreqBase={setEditRopeFreqBase}
            editRopeFreqScale={editRopeFreqScale}
            onSetRopeFreqScale={setEditRopeFreqScale}
            editYarnOrigCtx={editYarnOrigCtx}
            onSetYarnOrigCtx={setEditYarnOrigCtx}
            editYarnExtFactor={editYarnExtFactor}
            onSetYarnExtFactor={setEditYarnExtFactor}
            editYarnAttnFactor={editYarnAttnFactor}
            onSetYarnAttnFactor={setEditYarnAttnFactor}
            editYarnBetaSlow={editYarnBetaSlow}
            onSetYarnBetaSlow={setEditYarnBetaSlow}
            editYarnBetaFast={editYarnBetaFast}
            onSetYarnBetaFast={setEditYarnBetaFast}
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
            editDryEnabled={editDryEnabled}
            setEditDryEnabled={setEditDryEnabled}
            editDryMultiplier={editDryMultiplier}
            setEditDryMultiplier={setEditDryMultiplier}
            editDryBase={editDryBase}
            setEditDryBase={setEditDryBase}
            editDryAllowedLength={editDryAllowedLength}
            setEditDryAllowedLength={setEditDryAllowedLength}
            editDryPenaltyLastN={editDryPenaltyLastN}
            setEditDryPenaltyLastN={setEditDryPenaltyLastN}
            editDrySequenceBreakers={editDrySequenceBreakers}
            setEditDrySequenceBreakers={setEditDrySequenceBreakers}
          />
        );
      case 'projector':
        return (
          <ProjectorPage
            selectedProjectorDisplay={selectedProjectorDisplay}
            onOpenProjectorModal={() => setShowProjectorModal(true)}
            editProjector={editProjectorFilename}
            onNavigate={navigateTo}
            editMmprojOffload={editMmprojOffload}
            setEditMmprojOffload={setEditMmprojOffload}
            editImageMinTokens={editImageMinTokens}
            setEditImageMinTokens={setEditImageMinTokens}
            editImageMaxTokens={editImageMaxTokens}
            setEditImageMaxTokens={setEditImageMaxTokens}
            editMtmdBatchMaxTokens={editMtmdBatchMaxTokens}
            setEditMtmdBatchMaxTokens={setEditMtmdBatchMaxTokens}
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
            {isSearching ? (
              <button
                type="button"
                className="epm-back-btn"
                onClick={clearSearch}
                aria-label="Back to settings"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            ) : (
              currentPage !== 'main' && (
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
              )
            )}
            <h2>{isNewProfile ? 'New Profile' : 'Edit Profile'}</h2>
          </div>
          <div className="epm-search-wrap" role="search">
            <Search size={15} className="epm-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              className="epm-search-input"
              placeholder="Search settings…  (Ctrl+K)"
              aria-label="Search settings"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  clearSearch();
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="epm-search-clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
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
          {isSearching ? (
            <>
              <span
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <button
                  type="button"
                  className="epm-breadcrumb__item epm-breadcrumb__item--clickable"
                  onClick={clearSearch}
                >
                  {(pageBeforeSearch &&
                    BREADCRUMB_MAP[pageBeforeSearch]?.label) ||
                    'Profile'}
                </button>
              </span>
              <span
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span className="epm-breadcrumb__sep">›</span>
                <button
                  type="button"
                  className="epm-breadcrumb__item epm-breadcrumb__item--current"
                  disabled
                >
                  Search: &ldquo;{trimmedSearchQuery}&rdquo;
                </button>
              </span>
            </>
          ) : (
            breadcrumb.map((crumb, idx) => (
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
            ))
          )}
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
            disabled={!editName.trim()}
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

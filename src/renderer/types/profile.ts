import type { SettingsBag } from '../../shared/extensionSettings';

export type CacheType =
  | 'f32'
  | 'f16'
  | 'bf16'
  | 'q8_0'
  | 'q4_0'
  | 'q4_1'
  | 'iq4_nl'
  | 'q5_0'
  | 'q5_1';

export interface ContextShiftSettings {
  enabled: boolean;
  tokensRemainingUntilShift: number;
  tokensToShift: number;
  preserveAttachments: boolean;
  summarizationEnabled: boolean;
  summarizationMessage: string;
  summarizationThinkingBudget: number;
  midChatShiftEnabled: boolean;
  /** @deprecated Removed; kept for reading old profiles. */
  maxUserMessages?: number;
  /** @deprecated Renamed to tokensToShift. */
  minTokensToClear?: number;
}

/**
 * What the measured columns are made of, so the memory bar can draw each part
 * separately: the layer types a placement can offload, the expert cache, and
 * the projector. Bytes, not flags — a part is absent when it is zero.
 */
export interface MemoryBreakdown {
  vram: {
    /** GPU-resident layer bytes no spill lever can move. */
    layers: number;
    /** Experts --cpu-moe/--n-cpu-moe left on the GPU. */
    experts: number;
    /** Dense FFN --n-cpu-ffn left on the GPU. */
    ffn: number;
    /** The output slot's device copy. */
    output: number;
    /** Expert cache (--moe-cache-mib), carved out of the KV column. */
    cache: number;
    mmprojWeights: number;
    mmprojEncoder: number;
  };
  ram: {
    /** Whole layers -ngl left in system RAM. */
    layers: number;
    /** Experts of GPU layers moved to system RAM. */
    experts: number;
    /** Dense FFN of GPU layers moved to system RAM. */
    ffn: number;
    /** token_embd and every other always-host tensor. */
    embedding: number;
    /** The --lazy-mode tables (per-layer embeddings): billed to the host column
     *  by llama.cpp, but streamed from the file instead of held in RAM, so the
     *  bar draws them hatched and the RAM total does not count them. */
    lazy: number;
    mmprojWeights: number;
    mmprojEncoder: number;
  };
  counts: {
    gpuLayers: number;
    totalLayers: number;
    expertLayersSpilled: number;
    ffnLayersSpilled: number;
    cacheMib: number;
  };
}

export interface MemoryEstimate {
  modelVramUsage: number;
  contextVramUsage: number;
  computeOverheadVram: number;
  modelRamUsage: number;
  contextRamUsage: number;
  computeOverheadRam: number;
  fileBufferRam: number;
  // Sub-segments of the columns above. Absent when the model's GGUF table could
  // not be read, and in estimates stored by an older build.
  breakdown?: MemoryBreakdown | null;
}

export const DEFAULT_CONTEXT_SHIFT: ContextShiftSettings = {
  enabled: false,
  tokensRemainingUntilShift: 4096,
  tokensToShift: 8192,
  preserveAttachments: true,
  summarizationEnabled: false,
  summarizationMessage:
    'Summarize the conversation so far in a few concise sentences, preserving key decisions, facts, and open threads.',
  summarizationThinkingBudget: 4096,
  midChatShiftEnabled: false,
};

export interface Profile {
  id: string;
  name: string;
  /**
   * Lucide icon name drawn from the shared icon registry (see
   * components/workflows/IconPicker.tsx). Absent or unknown names fall back to
   * the default profile icon, so profiles exported by older builds still render.
   */
  icon?: string;
  model: string;
  projector?: string;
  modelAuthor: string;
  modelFolder: string;
  modelFilename: string;
  projectorFilename?: string;
  mmprojOffload?: boolean;
  imageMinTokens?: number;
  imageMaxTokens?: number;
  mtmdBatchMaxTokens?: number;
  systemPrompt: string;
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  seed?: number;
  typicalP?: number;
  topNSigma?: number;
  ignoreEos?: boolean;
  xtc?: {
    probability: number;
    threshold: number;
  };
  repeatPenalty?: {
    enabled?: boolean;
    lastTokens?: number;
    penalty?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    dry?: {
      enabled?: boolean;
      multiplier?: number;
      base?: number;
      allowedLength?: number;
      penaltyLastN?: number;
      sequenceBreakers?: string[];
    };
  };
  tools?: string[];
  /**
   * Per-profile overrides of extension settings, keyed by extension id. Each
   * extension declares its own fields; only keys it marks perProfile survive,
   * and credentials stay in the global defaults layer — so exporting a profile
   * can never carry a secret.
   */
  toolSettings?: Record<string, SettingsBag>;
  layers?: number;
  gpuLayersAuto?: boolean;
  // Fitted tensor placement from the auto-optimizer (-ts/-ot). Only valid
  // together with the layers/contextSize values they were solved for; the
  // main process nulls them for custom (user-pinned) configs.
  tensorSplit?: string | null;
  tensorOverrides?: string | null;
  contextShift?: ContextShiftSettings;
  contextSize?: number;
  // 'synapse': pick context, the optimizer picks layers. 'llama' is a
  // developer-only escape hatch: no Synapse solve at all, llama.cpp's own
  // fitter decides layers at startup while Synapse still pins --ctx-size.
  // Anything else stored (legacy longest-context/most-gpu) falls through to
  // synapse.
  autoOptimizer?: 'synapse' | 'custom' | 'llama';
  kvOffload?: boolean;
  flashAttn?: 'on' | 'off' | 'auto';
  cacheTypeK?: CacheType;
  cacheTypeV?: CacheType;
  rope?: {
    scaling?: 'none' | 'linear' | 'yarn';
    scale?: number;
    freqBase?: number;
    freqScale?: number;
  };
  yarn?: {
    origCtx?: number;
    extFactor?: number;
    attnFactor?: number;
    betaSlow?: number;
    betaFast?: number;
  };
  mmap?: boolean;
  mlock?: boolean;
  repack?: boolean;
  allocatedVRAM?: number;
  allocatedRAM?: number;
  maxLayers?: number;
  maxContext?: number;
  maxForModel?: string;
  estimation?: MemoryEstimate;
  videoSettings?: {
    fps?: number;
    maxFrames?: number;
    quality?: number;
    maxWidth?: number;
    unlimitedMaxFrames?: boolean;
  };
  specType?: string[];
  draftModelAuthor?: string;
  draftModelFolder?: string;
  draftModelFilename?: string;
  specDraftNMax?: number;
  specDraftNMin?: number;
  specDraftPSplit?: number;
  specDraftPMin?: number;
  cpuMoe?: boolean;
  nCpuMoe?: number;
  /**
   * --n-cpu-ffn: keep the dense FFN of the first N layers in host RAM. The
   * optimizer's lever for dense models; a user value is a starting point, and
   * an auto profile overwrites it.
   */
  nCpuFfn?: number;
  /**
   * --moe-cache-mib: device-resident expert cache, in MiB. llama.cpp caps it at
   * the expert bytes actually spilled to the host, so the optimizer sizes it
   * from the spill it chose rather than treating it as a free knob.
   */
  moeCacheMib?: number;
  /** --moe-cache-cpu-share: 0..1 of the cache allowed to live in host RAM. */
  moeCacheCpuShare?: number;
  /** --lazy-mode: on-demand reading of tensors the arch marks lazily. */
  lazyMode?: 'on' | 'off' | 'auto';
  /**
   * What the auto-optimizer decided. Written by the optimizer only, and read
   * back by buildLlamaServerArgs when the -ngl being launched is the one it
   * solved: spill, cache and -ngl are one placement, so they launch as a unit.
   * The user's own fields above stay untouched — they are the caps the solve ran
   * under, and overwriting them would ratchet the profile every launch.
   */
  optimizerPlan?: {
    kind: 'dense' | 'moe';
    ngl: number;
    cpuMoe?: boolean;
    nCpuMoe?: number;
    nCpuFfn?: number;
    moeCacheMib?: number;
    /** Blocks of the file the device holds, and how many it has: -ngl counts
     *  the output tensor (and any draft layers), so it is not a block count.
     *  Only the UI reads these, to say the plan in words. */
    gpuLayers?: number;
    totalLayers?: number;
    /** Largest context this placement holds at the budgets it was solved for. */
    maxCtx?: number;
    /** What capped maxCtx: 'vram' | 'ram' | 'train' | 'none'. */
    clampedBy?: string;
    /** True when nothing fit the device budgets and this is the least-bad plan.
     *  Host memory is not part of it: a --cpu-moe plan may need more system RAM
     *  than the machine has, and that is allowed. */
    forced?: boolean;
    /** Bytes of this placement that exceed the system-memory budget and will be
     *  served from the page file. */
    hostOverflowBytes?: number;
    /** Bytes --lazy-mode reads from the file instead of holding in RAM. They are
     *  in neither the RAM total nor hostOverflowBytes; the plan says so out loud
     *  because the memory bar draws them hatched. */
    streamedHostBytes?: number;
    label?: string;
  } | null;
  host?: string;
  port?: number;
  parallel?: number;
  corsOrigins?: string;
  corsMethods?: string;
  corsHeaders?: string;
  corsCredentials?: boolean;
  /**
   * llama.cpp v1.0.0 (#32115) rejects http(s) media URLs that resolve to a
   * local/private address. Synapse forwards attachment URLs as given, so this
   * stays on by default and a profile opts out to harden its server.
   */
  mediaAllowPrivateUrls?: boolean;
  /**
   * llama.cpp v1.0.0 (#32113) disables server tools/MCP on a non-loopback bind
   * with no API key. Set to allow that anyway on a trusted network; only has an
   * effect when Host is not loopback and no local API key is stored.
   */
  allowUnauthenticatedTools?: boolean;
  /**
   * How the local llama-server API key is provided: false/undefined lets
   * Synapse generate one, true shows a field to type your own. UI only — the
   * key itself lives in the encrypted secret store, never in the profile.
   */
  localApiKeyManual?: boolean;
  thinkingTokens?: number;
  customFlags?: string[];
  useCustomLaunch?: boolean;
  customLaunchCommand?: string;
  /**
   * Connect to an external v1-compatible server instead of launching a
   * local llama-server. The API key, if any, is NOT stored here — it
   * lives in the main-process encrypted secret store (see secretStore.ts),
   * addressed by profile id, so profiles/localStorage/exports never carry it.
   */
  useExternalServer?: boolean;
  externalServerUrl?: string;
  /**
   * Model id sent as `model` in /v1/chat/completions for external servers.
   * Required by OpenAI-style endpoints; llama.cpp servers ignore it.
   */
  externalModelName?: string;
  order: number;
  createdAt: number;
}

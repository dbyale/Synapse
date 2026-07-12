// ── Profile Settings Tooltips ──

export const PROFILE_NAME_TOOLTIP = 'A friendly name to identify this profile.';

export const MODEL_TOOLTIP = 'The local GGUF model file this profile will use. Select a model that best fits your hardware and quality needs.';

export const PROJECTOR_TOOLTIP = 'Optional multimodal projector for vision-language models (e.g., LLaVA). Required only when using a model that includes vision capabilities.';

// ── Advanced Generation Parameters ──

export const TEMPERATURE_TOOLTIP = [
  'Controls the randomness of the model\'s output.',
  'Lower values (e.g., 0.1) make output more deterministic and focused.',
  'Higher values (e.g., 1.5) increase creativity and variety.',
  'Range: 0–2. Default: 0.8.',
];

export const TOP_K_TOOLTIP = [
  'Limits token sampling to the K most likely candidates.',
  'A value of 40 means only the top 40 tokens are considered at each step.',
  'Set to 0 to disable and rely on Top P instead.',
  'Default: 40.',
];

export const TOP_P_TOOLTIP = [
  'Nucleus sampling — considers only tokens whose cumulative probability reaches P.',
  'A value of 0.9 means the model considers enough tokens to cover 90% of probability mass.',
  'Range: 0–1. Default: 0.95.',
];

export const MIN_P_TOOLTIP = [
  'Tokens with a probability below this threshold relative to the most likely token are excluded.',
  'Helps filter out very unlikely tokens while keeping the pool dynamic.',
  'Range: 0–1. Default: 0.05.',
];

export const SEED_TOOLTIP = [
  'Random seed for reproducible generation.',
  'Using the same seed, model, and parameters produces identical output.',
  'Set to -1 for fully random output each time.',
  'Default: -1 (random).',
];

// ── Repeat Penalty ──

export const REPEAT_PENALTY_TOOLTIP = [
  'Discourages the model from repeating recent tokens.',
  'When enabled, the model receives a penalty for tokens that have already appeared in the recent context.',
];

export const LAST_TOKENS_TOOLTIP = [
  'Number of recent tokens scanned for repetition.',
  'A larger range catches longer repetitive patterns.',
  'Default: 64 tokens.',
];

export const REPEAT_PENALTY_VALUE_TOOLTIP = [
  'Strength of the repetition penalty applied to tokens that have already appeared.',
  '1.0 means no penalty. Values above 1.0 increasingly discourage repetition.',
  'Default: 1.00 (no penalty).',
];

export const FREQUENCY_PENALTY_TOOLTIP = [
  'Penalizes tokens proportionally to how often they appear in the recent context.',
  'Frequently repeated tokens receive a stronger penalty.',
  'Range: 0–1. Default: 0.00.',
];

export const PRESENCE_PENALTY_TOOLTIP = [
  'Penalizes tokens that have appeared at all in the recent context, regardless of frequency.',
  'Encourages the model to talk about new topics.',
  'Range: 0–1. Default: 0.00.',
];

// ── Performance / Optimizer ──

export const OPTIMIZATION_MODE_TOOLTIP = [
  'Longest Context: automatically optimizes for the largest possible context window.',
  'Most GPU: automatically offloads as many layers as possible to the GPU for maximum speed.',
  'Custom: allows manual control over GPU layers and context size.',
];

export const LONGEST_CONTEXT_TOOLTIP = 'Runs the auto-optimizer to find settings that maximize the context window size while staying within hardware limits.';

export const MOST_GPU_TOOLTIP = 'Runs the auto-optimizer to offload as many layers as possible to the GPU, prioritizing inference speed.';

export const CUSTOM_TOOLTIP = 'Switch to manual mode to independently adjust GPU layers and context size.';

export const GPU_LAYERS_TOOLTIP = [
  'Number of transformer layers offloaded to the GPU (NGL).',
  'More GPU layers increases generation speed but consumes more VRAM.',
  'Setting this too high may cause out-of-memory errors.',
];

export const CONTEXT_SIZE_TOOLTIP = [
  'Maximum number of tokens the model can reference for generating each response.',
  'Larger context allows the model to remember more of the conversation but uses significantly more memory.',
  'Increases both VRAM and RAM usage proportionally.',
];

export const KV_CACHE_OFFLOAD_TOOLTIP = [
  'Whether to store the KV cache on the GPU or in system RAM.',
  'GPU KV cache: faster generation, higher VRAM usage.',
  'System RAM KV cache: saves VRAM but can slow down generation.',
];

export const GPU_LAYERS_AUTO_TOOLTIP = [
  'Lets llama-server decide how many layers to offload to the GPU based on available VRAM at startup.',
  'This option may be helpful for systems that frequently change GPUs.',
  'For the best results on most systems, use "Longest Context" or "Most GPU" modes for quick decisions.',
];

export const K_CACHE_TYPE_TOOLTIP = [
  'Data type for the key cache — stores attention key vectors during generation.',
  'Higher precision (f32 → f16 → bf16): better quality in rare / complex token predictions, higher VRAM usage (up to 2× vs Q4_0).',
  'Lower precision (q8_0 → q4_0 → q4_1 → iq4_nl → q5_0 → q5_1): 2–4× memory reduction with minor perplexity increase (~0.1–0.5 PPL).',
  'Use f16 for quality-sensitive tasks. Use q8_0 for balanced quality/memory. Use q4_0/q4_1 for memory-constrained scenarios.',
];

export const V_CACHE_TYPE_TOOLTIP = [
  'Data type for the value cache — stores attention value vectors during generation.',
  'Value cache is more sensitive to quantization than key cache; lower precision can noticeably affect output quality.',
  'Higher precision (f32 → f16 → bf16): recommended for value cache to maintain generation quality.',
  'Lower precision (q8_0 → q4_0 → q4_1 → iq4_nl → q5_0 → q5_1): frees VRAM at the cost of higher quality degradation than quantizing the key cache.',
  'Consider keeping V Cache at f16 and only quantizing K Cache if memory is tight.',
];

export const MMAP_TOOLTIP = [
  'Memory-maps the model file so the operating system pages it into memory on demand.',
  'Lowers peak RAM usage since only actively used parts need to be loaded.',
  'Disabling this loads the entire model into RAM upfront, which can reduce disk I/O during inference.',
];

export const MLOCK_TOOLTIP = [
  'Locks the model in RAM to prevent the operating system from swapping it to disk.',
  'Ensures consistent performance by avoiding disk I/O delays.',
  'Uses more system RAM and may affect other running applications.',
];

// ── Memory Estimation ──

export const MODEL_WEIGHTS_TOOLTIP = 'Memory consumed by the model\'s weight tensors. This is the largest component and scales with model size and quantization.';

export const KV_CACHE_MEM_TOOLTIP = 'Memory used to store past key and value tensors for the attention mechanism. Scales with context size, batch size, and model depth.';

export const COMPUTE_OVERHEAD_TOOLTIP = 'Scratch memory reserved for intermediate computations during inference, including temporary buffers and attention scoring matrices.';

export const FILE_BUFFER_TOOLTIP = 'Memory reserved for file I/O buffering when loading model weights. Primarily used when MMAP is disabled.';

export const VRAM_LABEL_TOOLTIP = 'Video Memory (GPU) — used when layers are offloaded to the GPU. Running out of VRAM forces CPU fallback and slows inference.';

export const RAM_LABEL_TOOLTIP = 'System Memory (RAM) — used for model layers kept on the CPU, KV cache, and general computation.';

// ── Settings Page ──

export const MODELS_DIR_TOOLTIP = 'Directory where model files are stored and downloaded. Models are organized by author and name within this directory.';

export const MEMORY_ALLOCATOR_TOOLTIP = [
  'Controls how much RAM and VRAM Synapse is allowed to reserve for the inference engine.',
  'Setting this too high may cause system instability or out-of-memory errors.',
  'Setting this too low limits the model size and context length you can use.',
];

export const MAX_LABEL_TOOLTIP = 'Recommended ceiling for Synapse allocation. This accounts for other running processes and a safety buffer. Exceeding this may cause system instability.';

// ── Draft Model (Speculative Decoding) ──

export const DRAFT_MODEL_TOOLTIP = [
  'Speculative decoding uses a smaller "draft" model to generate candidate tokens that the main model verifies in parallel.',
  'This can significantly speed up generation when the draft model is much faster while maintaining output quality.',
];

export const SPEC_TYPE_TOOLTIP = [
  'The speculative decoding strategy to use. Multiple types can be combined.',
  'draft-simple: Uses an external draft model (GGUF file).',
  'draft-mtp: Uses the main model\'s internal MTP (Multi-Token Prediction) heads — no external model needed.',
  'draft-eagle3: Uses the model\'s EAGLE3-style draft heads — no external model needed.',
  'ngram-simple / ngram-map-k / ngram-map-k4v / ngram-mod / ngram-cache: N-gram based draft strategies that extract candidates from the prompt context — no external model needed.',
  'Set to "none" to disable speculative decoding.',
];

export const DRAFT_N_MAX_TOOLTIP = [
  'Maximum number of tokens the draft model generates per speculative step (--spec-draft-n-max).',
  'Higher values give more opportunity for speedup but increase verification overhead.',
  'Range: 1–16. Default: 3.',
];

export const DRAFT_N_MIN_TOOLTIP = [
  'Minimum number of draft tokens per step (--spec-draft-n-min).',
  'Lower values adapt better to uncertain contexts but reduce draft ceiling.',
  'Range: 0–16. Default: 0.',
];

export const DRAFT_P_SPLIT_TOOLTIP = [
  'Probability of splitting to a new draft when the original candidate is rejected (--draft-p-split).',
  'Higher values produce more new candidates, improving chances of acceptance.',
  'Range: 0.0–1.0. Default: 0.10.',
];

export const DRAFT_P_MIN_TOOLTIP = [
  'Minimum probability for a greedy draft token to be accepted (--draft-p-min).',
  'Higher values make acceptance stricter, potentially reducing speedup but improving quality.',
  'Range: 0.0–1.0. Default: 0.00.',
];

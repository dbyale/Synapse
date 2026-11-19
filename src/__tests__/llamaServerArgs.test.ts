import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildLlamaServerArgs,
  resolveServerEndpoint,
  clampDrySequenceBreakers,
  MAX_DRY_SEQUENCE_BREAKERS,
  DEFAULT_SERVER_PORT,
} from '../main/chat';
import { setSecret, deleteSecret } from '../main/secretStore';
import {
  externalServerSecretScope,
  LOCAL_API_KEY_SECRET_KEY,
  isLoopbackHost,
  normalizeCorsOrigins,
} from '../shared/externalServer';
import {
  appendCommonFitArgs,
  loadModeFor,
  parseFittedArgs,
  parseFitPrint,
  parseListDevices,
} from '../main/estimator';

// The argument surface llama-server is launched with is a contract with the
// pinned llama.cpp build, and the optimizer measures against the same surface
// (appendCommonFitArgs). Both are exercised here: the first group pins the
// contract (nothing that the pinned build rejects, and the placement triple
// travels together), the second group pins server/estimator parity so a
// profile can never be measured under one set of flags and launched under
// another. jest hoists the electron mock above the imports.
jest.mock('electron', () => {
  const osm = require('os');
  const fsp = require('fs');
  const pth = require('path');
  const dir = fsp.mkdtempSync(pth.join(osm.tmpdir(), 'synapse-args-'));
  return {
    app: {
      getPath: () => dir,
      getAppPath: () => pth.join(__dirname, '../..'),
      getName: () => 'Synapse',
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (buf: Buffer) => buf.toString(),
    },
  };
});

// Flags whose presence or value changes the memory a model needs. The fit
// measurement and the server launch must agree on every one of them, so the
// parity test compares exactly this slice of both arg vectors.
const MEMORY_FLAGS = [
  '--cache-type-k',
  '--cache-type-v',
  '--flash-attn',
  '--no-kv-offload',
  '--parallel',
  '--cpu-moe',
  '--n-cpu-moe',
  '--n-cpu-ffn',
  '--moe-cache-mib',
  '--moe-cache-cpu-share',
  '--lazy-mode',
  '--load-mode',
  '--no-repack',
  '--rope-scaling',
  '--rope-scale',
  '--rope-freq-base',
  '--rope-freq-scale',
  '--yarn-orig-ctx',
  '--yarn-ext-factor',
  '--yarn-attn-factor',
  '--yarn-beta-slow',
  '--yarn-beta-fast',
  '--mmproj',
  '--no-mmproj-offload',
  '--image-min-tokens',
  '--image-max-tokens',
  '--mtmd-batch-max-tokens',
];

// Flags the pinned llama.cpp build does not accept. Each was either renamed or
// deleted upstream; emitting one makes llama-server exit at startup on an
// unrecognized argument, which shows up in Synapse as a backend that simply
// never comes online.
const REJECTED_FLAGS = [
  // llama.cpp folded mmap/mlock into the single -lm/--load-mode enum.
  '--no-mmap',
  '--mlock',
  // Speculative decoding was renamed to --spec-*; this pair is gone, not
  // aliased.
  '--draft-max',
  '--draft-min',
  '--draft-n',
  '--draft-n-min',
];

function flagValues(args: string[]): Map<string, string | boolean> {
  const out = new Map<string, string | boolean>();
  let i = 0;
  while (i < args.length) {
    const token = args[i];
    const next = args[i + 1];
    // A leading '-' is normally the next flag, except for negative numbers
    // (--n-gpu-layers -1 is the full-offload sentinel).
    const hasValue =
      next !== undefined && (!next.startsWith('-') || /^-\d/.test(next));
    if (token.startsWith('--') && hasValue) {
      out.set(token, next);
      i += 2;
    } else {
      if (token.startsWith('--')) out.set(token, true);
      i += 1;
    }
  }
  return out;
}

function fullProfile(): any {
  // One profile that exercises every memory-relevant branch at once, so the
  // parity comparison covers the whole surface rather than a single flag.
  return {
    cacheTypeK: 'q8_0',
    cacheTypeV: 'q4_0',
    flashAttn: 'on',
    kvOffload: false,
    parallel: 4,
    cpuMoe: false,
    nCpuMoe: 3,
    nCpuFfn: 6,
    moeCacheMib: 512,
    moeCacheCpuShare: 0.25,
    lazyMode: 'on',
    mmap: true,
    mlock: true,
    repack: false,
    rope: {
      scaling: 'yarn',
      scale: 2,
      freqBase: 10000000,
      freqScale: 0.5,
    },
    yarn: {
      origCtx: 4096,
      extFactor: 1.5,
      attnFactor: 1.2,
      betaSlow: 32,
      betaFast: 1,
    },
    mmprojOffload: false,
    imageMinTokens: 64,
    imageMaxTokens: 1024,
    mtmdBatchMaxTokens: 512,
  };
}

function fitFlags(
  profile: any,
  projectorPath?: string,
  mode?: string,
): string[] {
  // Every flag advertised as supported: the probe itself is covered by the
  // real backend, here we want the mapping, not the skip logic.
  const supported = new Set(MEMORY_FLAGS);
  const args: string[] = [];
  appendCommonFitArgs(args, supported, profile, projectorPath, mode as any);
  return args;
}

describe('buildLlamaServerArgs against the pinned llama.cpp flag surface', () => {
  it('emits no flag the pinned build rejects', () => {
    const profile = {
      ...fullProfile(),
      // mmap off and mlock on are the two settings that used to produce the
      // dead flags above.
      mmap: false,
      mlock: true,
      specType: ['draft-simple'],
      specDraftPSplit: 0.5,
      specDraftPMin: 0.25,
      customFlags: [],
    };
    const args = buildLlamaServerArgs(profile, {
      modelPath: '/models/test.gguf',
      ngl: 20,
      ctx: 8192,
    } as any);
    const emitted = flagValues(args);
    const offenders = REJECTED_FLAGS.filter((flag) => emitted.has(flag));
    expect(offenders).toEqual([]);
  });

  it('maps mmap/mlock onto --load-mode instead of --no-mmap/--mlock', () => {
    const withMlock = buildLlamaServerArgs(
      { mlock: true } as any,
      {
        modelPath: '/models/test.gguf',
        ngl: 9,
        ctx: 4096,
      } as any,
    );
    expect(flagValues(withMlock).get('--load-mode')).toBe('mmap+mlock');

    const withoutMmap = buildLlamaServerArgs(
      { mmap: false } as any,
      {
        modelPath: '/models/test.gguf',
        ngl: 9,
        ctx: 4096,
      } as any,
    );
    expect(flagValues(withoutMmap).get('--load-mode')).toBe('none');

    // Default (mmap on, mlock off) leaves the server default ('auto') alone.
    const defaults = buildLlamaServerArgs(
      {} as any,
      {
        modelPath: '/models/test.gguf',
        ngl: 9,
        ctx: 4096,
      } as any,
    );
    expect(flagValues(defaults).has('--load-mode')).toBe(false);
  });

  it('writes canonical --spec-draft-p-* names', () => {
    const args = buildLlamaServerArgs(
      {
        specType: ['draft-simple'],
        specDraftNMax: 8,
        specDraftNMin: 2,
        specDraftPSplit: 0.75,
        specDraftPMin: 0.5,
      } as any,
      { modelPath: '/models/test.gguf', ngl: 5, ctx: 2048 } as any,
    );
    const emitted = flagValues(args);
    expect(emitted.get('--spec-type')).toBe('draft-simple');
    expect(emitted.get('--spec-draft-n-max')).toBe('8');
    expect(emitted.get('--spec-draft-n-min')).toBe('2');
    expect(emitted.get('--spec-draft-p-split')).toBe('0.75');
    expect(emitted.get('--spec-draft-p-min')).toBe('0.50');
  });

  it('keeps the (ngl, --tensor-split, --override-tensor) triple together', () => {
    const args = buildLlamaServerArgs(
      {} as any,
      {
        modelPath: '/models/test.gguf',
        ngl: 33,
        ctx: 8192,
        tensorSplit: '1,2',
        tensorOverrides: 'blk.10.ffn_down.exps=CPU',
      } as any,
    );
    const emitted = flagValues(args);
    expect(emitted.get('--n-gpu-layers')).toBe('33');
    expect(emitted.get('--tensor-split')).toBe('1,2');
    expect(emitted.get('--override-tensor')).toBe('blk.10.ffn_down.exps=CPU');
  });

  it('passes the full-offload sentinel through as -1', () => {
    const args = buildLlamaServerArgs(
      {} as any,
      {
        modelPath: '/models/test.gguf',
        ngl: -1,
        ctx: 8192,
      } as any,
    );
    expect(flagValues(args).get('--n-gpu-layers')).toBe('-1');
  });

  it('omits the placement triple when the server fits layers itself', () => {
    // -ts/-ot are invalid under auto: a pinned override makes llama.cpp's own
    // fit throw the moment it needs to adjust.
    const args = buildLlamaServerArgs(
      { autoOptimizer: 'custom', gpuLayersAuto: true } as any,
      {
        modelPath: '/models/test.gguf',
        ngl: 33,
        ctx: 8192,
        tensorSplit: '1,2',
        tensorOverrides: 'blk.10.ffn_down.exps=CPU',
      } as any,
    );
    const emitted = flagValues(args);
    expect(emitted.get('--n-gpu-layers')).toBe('auto');
    expect(emitted.has('--tensor-split')).toBe(false);
    expect(emitted.has('--override-tensor')).toBe(false);
  });

  it('llama default mode hands the whole placement to the server', () => {
    // Developer-only mode: no Synapse solve, so nothing Synapse solved may be
    // pinned — not the triple, and not the spill/cache knobs that travel with
    // a plan. ctx stays pinned: it is the user's choice, not a placement.
    const profile = {
      autoOptimizer: 'llama',
      optimizerPlan: { kind: 'moe', ngl: 33, nCpuMoe: 17, moeCacheMib: 397 },
    };
    const emitted = flagValues(
      buildLlamaServerArgs(
        profile as any,
        {
          modelPath: '/models/test.gguf',
          ngl: null,
          ctx: 8192,
          tensorSplit: '1,2',
          tensorOverrides: 'blk.10.ffn_down.exps=CPU',
        } as any,
      ),
    );
    expect(emitted.get('--n-gpu-layers')).toBe('auto');
    expect(emitted.get('--ctx-size')).toBe('8192');
    expect(emitted.has('--tensor-split')).toBe(false);
    expect(emitted.has('--override-tensor')).toBe(false);
    expect(emitted.has('--n-cpu-moe')).toBe(false);
    expect(emitted.has('--moe-cache-mib')).toBe(false);
  });

  it('always pins host and port explicitly', () => {
    const args = buildLlamaServerArgs(
      {} as any,
      {
        modelPath: '/models/test.gguf',
        ngl: 1,
        ctx: 512,
      } as any,
    );
    const emitted = flagValues(args);
    expect(emitted.get('--host')).toBe('127.0.0.1');
    // llama.cpp v0.7.0 (ggml#30159) moved the server default port to 9931.
    expect(emitted.get('--port')).toBe(String(DEFAULT_SERVER_PORT));
    expect(DEFAULT_SERVER_PORT).toBe(9931);
  });
});

describe('optimizerPlan is the launch carrier for spill/cache knobs', () => {
  // The profile's own cpuMoe/nCpuMoe/nCpuFfn/moeCacheMib are the caps the last
  // solve ran under; the plan holds what the solve actually chose. Launching
  // the plan's -ngl must launch the plan's placement, and nothing else may
  // make those knobs stick across launches. The plan below carries more knobs
  // than the current MoE rule ever writes on purpose: the launcher forwards
  // whatever a plan says, including shapes the optimizer no longer produces.
  const profile = {
    cpuMoe: false,
    nCpuMoe: 0,
    nCpuFfn: 0,
    moeCacheMib: 0,
    moeCacheCpuShare: 0.25,
    optimizerPlan: {
      kind: 'moe',
      ngl: 42,
      cpuMoe: true,
      nCpuMoe: 40,
      nCpuFfn: 4,
      moeCacheMib: 397,
    },
  };

  it('launches the plan placement when the -ngl matches', () => {
    const emitted = flagValues(
      buildLlamaServerArgs(
        profile as any,
        {
          modelPath: '/models/test.gguf',
          ngl: 42,
          ctx: 14000,
        } as any,
      ),
    );
    expect(emitted.get('--cpu-moe')).toBe(true);
    expect(emitted.get('--n-cpu-ffn')).toBe('4');
    expect(emitted.get('--moe-cache-mib')).toBe('397');
    // The share is a user preference, not part of the solved placement.
    expect(emitted.get('--moe-cache-cpu-share')).toBe('0.25');
  });

  it('launches --cpu-moe and its pool as one placement', () => {
    // The optimizer's MoE rule: experts that do not all fit all go to the host
    // and the freed VRAM becomes the pool. Both halves have to launch together
    // — --cpu-moe with no pool is the slowest configuration llama.cpp measures
    // — and --n-cpu-moe must not accompany --cpu-moe even though the plan
    // carries the layer count it subsumes.
    const emitted = flagValues(
      buildLlamaServerArgs(
        profile as any,
        {
          modelPath: '/models/test.gguf',
          ngl: 42,
          ctx: 8192,
        } as any,
      ),
    );
    expect(emitted.get('--cpu-moe')).toBe(true);
    expect(emitted.has('--n-cpu-moe')).toBe(false);
    expect(emitted.get('--moe-cache-mib')).toBe('397');
  });

  it('launches a partial spill verbatim when something else wrote the plan', () => {
    // The optimizer no longer produces this shape: on a MoE it either pins every
    // expert or moves all of them under --cpu-moe. A plan holding --n-cpu-moe
    // therefore came from somewhere else, and the launcher's job is to pass it
    // through exactly as written — including leaving the pool off when the plan
    // does not ask for one.
    const emitted = flagValues(
      buildLlamaServerArgs(
        {
          ...profile,
          optimizerPlan: { kind: 'moe', ngl: 42, nCpuMoe: 17, nCpuFfn: 4 },
        } as any,
        { modelPath: '/models/test.gguf', ngl: 42, ctx: 8192 } as any,
      ),
    );
    expect(emitted.has('--cpu-moe')).toBe(false);
    expect(emitted.get('--n-cpu-moe')).toBe('17');
    expect(emitted.has('--moe-cache-mib')).toBe(false);
    // No cache means no miss to route, so the share stays home too.
    expect(emitted.has('--moe-cache-cpu-share')).toBe(false);
  });

  it('ignores a plan solved for a different -ngl', () => {
    const emitted = flagValues(
      buildLlamaServerArgs(
        profile as any,
        {
          modelPath: '/models/test.gguf',
          ngl: 30,
          ctx: 8192,
        } as any,
      ),
    );
    expect(emitted.has('--n-cpu-moe')).toBe(false);
    expect(emitted.has('--n-cpu-ffn')).toBe(false);
    expect(emitted.has('--moe-cache-mib')).toBe(false);
    // Manual pins on the profile itself still launch.
    const manual = flagValues(
      buildLlamaServerArgs(
        { ...profile, nCpuMoe: 5 } as any,
        { modelPath: '/models/test.gguf', ngl: 30, ctx: 8192 } as any,
      ),
    );
    expect(manual.get('--n-cpu-moe')).toBe('5');
  });

  it('emits the cache CPU share only next to a cache', () => {
    const noCache = flagValues(
      buildLlamaServerArgs(
        { moeCacheCpuShare: 0.5 } as any,
        { modelPath: '/models/test.gguf', ngl: 9, ctx: 4096 } as any,
      ),
    );
    expect(noCache.has('--moe-cache-cpu-share')).toBe(false);
  });

  it('leaves lazy-mode alone for auto on both sides', () => {
    // auto is llama.cpp's own default; emitting it would be noise on the
    // server and a phantom difference in the probe.
    (['auto', undefined] as const).forEach((lazyMode) => {
      const server = flagValues(
        buildLlamaServerArgs(
          { lazyMode } as any,
          { modelPath: '/models/test.gguf', ngl: 9, ctx: 4096 } as any,
        ),
      );
      const fit = flagValues(fitFlags({ lazyMode }));
      expect(server.has('--lazy-mode')).toBe(false);
      expect(fit.has('--lazy-mode')).toBe(false);
    });
    const on = flagValues(
      buildLlamaServerArgs(
        { lazyMode: 'on' } as any,
        { modelPath: '/models/test.gguf', ngl: 9, ctx: 4096 } as any,
      ),
    );
    expect(on.get('--lazy-mode')).toBe('on');
  });
});

describe('v1.0.0 server hardening (--cors-origins, media, tools)', () => {
  const flagsFor = (profile: any): Map<string, string | boolean> =>
    flagValues(
      buildLlamaServerArgs(profile, {
        modelPath: '/models/test.gguf',
        ngl: 9,
        ctx: 4096,
      } as any),
    );

  it('accepts the origins llama.cpp can actually match', () => {
    expect(normalizeCorsOrigins('*')).toBe('*');
    // 'localhost' is a documented special value (same-origin only), not a host.
    expect(normalizeCorsOrigins('localhost')).toBe('localhost');
    expect(normalizeCorsOrigins('https://app.example.com')).toBe(
      'https://app.example.com',
    );
    expect(
      normalizeCorsOrigins(' http://127.0.0.1:3000 , https://synapse.dev '),
    ).toBe('http://127.0.0.1:3000,https://synapse.dev');
  });

  it('drops an origin list that could only ever match nothing', () => {
    // A bare host or a typo passes llama.cpp's parser and then matches no
    // Origin header, which reads as a rule that does nothing. Better to omit.
    expect(normalizeCorsOrigins('192.168.1.5')).toBeNull();
    expect(normalizeCorsOrigins('localhost:3000')).toBeNull();
    expect(normalizeCorsOrigins('https://app.example.com, bogus')).toBeNull();
    expect(normalizeCorsOrigins('')).toBeNull();
    expect(normalizeCorsOrigins(undefined)).toBeNull();
  });

  it('passes the shipped default and skips the server default of *', () => {
    // settings.ts defaults profiles to 'localhost'; the app's own requests come
    // from the main process and are not subject to CORS at all.
    expect(flagsFor({ corsOrigins: 'localhost' }).get('--cors-origins')).toBe(
      'localhost',
    );
    expect(flagsFor({ corsOrigins: '*' }).has('--cors-origins')).toBe(false);
    expect(flagsFor({ corsOrigins: 'nonsense' }).has('--cors-origins')).toBe(
      false,
    );
  });

  it('accepts media URLs from this network unless the profile opts out', () => {
    // llama.cpp #32115 rejects private/loopback media URLs. Synapse forwards
    // attachment URLs unchanged, so the flag is on for anything that does not
    // explicitly ask for the hardened behaviour.
    expect(flagsFor({}).get('--media-allow-private-urls')).toBe(true);
    expect(
      flagsFor({ mediaAllowPrivateUrls: undefined }).get(
        '--media-allow-private-urls',
      ),
    ).toBe(true);
    expect(
      flagsFor({ mediaAllowPrivateUrls: false }).has(
        '--media-allow-private-urls',
      ),
    ).toBe(false);
  });

  it('recognises which binds are reachable from another machine', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.53')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('')).toBe(true);
    // Wildcards and LAN addresses are exactly the case llama.cpp locks down.
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });

  it('never opens tools on a LAN bind unless the profile asks', () => {
    expect(
      flagsFor({ host: '0.0.0.0' }).has('--allow-unauthenticated-tools'),
    ).toBe(false);
    expect(
      flagsFor({ host: '0.0.0.0', allowUnauthenticatedTools: true }).get(
        '--allow-unauthenticated-tools',
      ),
    ).toBe(true);
    // Loopback needs nothing; llama.cpp keeps tools available there anyway.
    expect(
      flagsFor({ host: '127.0.0.1', allowUnauthenticatedTools: true }).has(
        '--allow-unauthenticated-tools',
      ),
    ).toBe(false);
  });

  it('keeps a stored server key out of the command line', () => {
    // llama.cpp reads LLAMA_API_KEY from the environment; a command line is
    // readable by every process on the machine, so --api-key is never emitted.
    const profileId = 'args-test-keyed-profile';
    setSecret(
      externalServerSecretScope(profileId),
      LOCAL_API_KEY_SECRET_KEY,
      'secret-value',
    );

    const emitted = flagsFor({
      id: profileId,
      host: '0.0.0.0',
      allowUnauthenticatedTools: true,
    });
    expect(emitted.has('--api-key')).toBe(false);
    // With a key configured llama.cpp already allows tools, so the opt-in is
    // redundant and would only expose the server to the whole LAN.
    expect(emitted.has('--allow-unauthenticated-tools')).toBe(false);
    deleteSecret(
      externalServerSecretScope(profileId),
      LOCAL_API_KEY_SECRET_KEY,
    );
  });

  it('launches with the key captured at load time, not whatever the store holds now', () => {
    // A real launch resolves the key before building the command and hands it
    // in, so saving a new key mid-session cannot make the tools flag disagree
    // with the credential the running server was actually started with.
    const profile = {
      id: 'args-test-captured-key-profile',
      host: '0.0.0.0',
      allowUnauthenticatedTools: true,
    };
    const config = {
      modelPath: '/models/test.gguf',
      ngl: 9,
      ctx: 4096,
    } as any;

    // Nothing stored yet, but this launch says a key is in use: the opt-in for
    // unauthenticated tools has to stay off.
    expect(
      flagValues(
        buildLlamaServerArgs(profile, { ...config, hasApiKey: true }),
      ).has('--allow-unauthenticated-tools'),
    ).toBe(false);

    // A key is stored, but this launch says the server starts without one, so
    // the opt-in applies to the process that is really being spawned.
    const scope = externalServerSecretScope(profile.id);
    setSecret(scope, LOCAL_API_KEY_SECRET_KEY, 'secret-value');
    try {
      expect(
        flagValues(
          buildLlamaServerArgs(profile, { ...config, hasApiKey: false }),
        ).get('--allow-unauthenticated-tools'),
      ).toBe(true);
    } finally {
      deleteSecret(scope, LOCAL_API_KEY_SECRET_KEY);
    }
  });
});

describe('server/estimator parity for memory-relevant flags', () => {
  it('agrees on every memory flag with no projector', () => {
    const profile = fullProfile();
    const server = flagValues(
      buildLlamaServerArgs(profile, {
        modelPath: '/models/test.gguf',
        ngl: 12,
        ctx: 4096,
      } as any),
    );
    const fit = flagValues(fitFlags(profile));

    const mismatches = MEMORY_FLAGS.filter(
      (flag) => server.get(flag) !== fit.get(flag),
    );
    expect(mismatches).toEqual([]);
  });

  it('agrees on the projector block when a projector file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-mmproj-'));
    const projectorPath = path.join(dir, 'mmproj.gguf');
    fs.writeFileSync(projectorPath, 'mmproj');
    const profile = fullProfile();

    const server = flagValues(
      buildLlamaServerArgs(profile, {
        modelPath: '/models/test.gguf',
        ngl: 12,
        ctx: 4096,
        projectorPath,
      } as any),
    );
    const fit = flagValues(fitFlags(profile, projectorPath));
    expect(fit.has('--mmproj')).toBe(true);
    expect(server.get('--mmproj')).toBe(fit.get('--mmproj'));
    expect(server.get('--image-max-tokens')).toBe(
      fit.get('--image-max-tokens'),
    );
    expect(server.get('--mtmd-batch-max-tokens')).toBe(
      fit.get('--mtmd-batch-max-tokens'),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes --parallel explicitly on both sides', () => {
    // Parallel slots change n_seq_max and therefore KV sizing; an omitted
    // flag on either side silently desynchronises the estimate.
    const server = flagValues(
      buildLlamaServerArgs(
        { parallel: -1 } as any,
        {
          modelPath: '/models/test.gguf',
          ngl: 4,
          ctx: 1024,
        } as any,
      ),
    );
    const fit = flagValues(fitFlags({ parallel: -1 }));
    expect(server.get('--parallel')).toBe('1');
    expect(fit.get('--parallel')).toBe('1');
  });

  it('strips every placement pin in solve mode', () => {
    // llama.cpp aborts a --fit run when tensor_buft_overrides are already set
    // by the user, so the solve probe must arrive pin-free or the optimizer
    // never gets an upstream answer.
    const profile = fullProfile();
    const solve = flagValues(fitFlags(profile, undefined, 'solve'));
    const pins = [
      '--cpu-moe',
      '--n-cpu-moe',
      '--n-cpu-ffn',
      '--moe-cache-mib',
      '--moe-cache-cpu-share',
    ];
    const offenders = pins.filter((flag) => solve.has(flag));
    expect(offenders).toEqual([]);
    // Memory-mode flags are not placement overrides: they still describe the
    // run being solved and must survive.
    expect(solve.get('--load-mode')).toBe('mmap+mlock');
    expect(solve.get('--lazy-mode')).toBe('on');
  });
});

describe('--load-mode resolution', () => {
  // How weights are loaded is one llama.cpp enum, while a profile stores two
  // booleans. loadModeFor is the single mapping, used by both the optimizer
  // probe and the server launch, so a profile can never be measured under one
  // mode and run under another.
  const cases: [any, string | null][] = [
    [{}, null], // leave llama.cpp's own default (auto) alone
    [{ mmap: true }, null],
    [{ mlock: false }, null],
    [{ mlock: true }, 'mmap+mlock'],
    [{ mmap: false }, 'none'],
    [{ mmap: true, mlock: true }, 'mmap+mlock'],
    // No mmap but the weights still pinned in RAM. 'none' would drop the
    // pinning the user asked for; 'mmap+mlock' would re-add the mmap they
    // turned off.
    [{ mmap: false, mlock: true }, 'mlock'],
  ];

  cases.forEach(([profile, expected]) => {
    const label = JSON.stringify(profile);
    it(`maps ${label} to ${expected ?? 'the server default'}`, () => {
      expect(loadModeFor(profile.mmap, profile.mlock)).toBe(expected);

      const server = flagValues(
        buildLlamaServerArgs(profile, {
          modelPath: '/models/test.gguf',
          ngl: 9,
          ctx: 4096,
        } as any),
      );
      const fit = flagValues(fitFlags(profile));
      expect(server.get('--load-mode')).toBe(expected ?? undefined);
      expect(fit.get('--load-mode')).toBe(expected ?? undefined);
    });
  });
});

describe('resolveServerEndpoint', () => {
  it('falls back to the llama.cpp default port for a manual command without --port', () => {
    const { host, port } = resolveServerEndpoint({
      useCustomLaunch: true,
      customLaunchCommand: 'llama-server --model /models/test.gguf',
    } as any);
    expect(host).toBe('127.0.0.1');
    expect(port).toBe(9931);
  });

  it('reads host and port out of a manual command', () => {
    const { host, port } = resolveServerEndpoint({
      useCustomLaunch: true,
      customLaunchCommand:
        'llama-server --model "/models/test.gguf" --host 0.0.0.0 --port=1234',
    } as any);
    expect(host).toBe('0.0.0.0');
    expect(port).toBe(1234);
  });

  it('uses the profile endpoint in non-manual mode', () => {
    const { host, port } = resolveServerEndpoint({
      host: '127.0.0.1',
      port: 11111,
    } as any);
    expect(host).toBe('127.0.0.1');
    expect(port).toBe(11111);
  });
});

describe('fit output parsers', () => {
  // Shapes copied from a real llama-fit-params run (llama.cpp v0.7.0 / b11669).
  // Both outputs are generated by common/fit.cpp, and the whole optimizer reads
  // them, so a format change upstream has to fail here rather than at fit time.
  it('parses fitted arguments, including the full-offload sentinel', () => {
    expect(parseFittedArgs('-c 8192 -ngl -1')).toEqual({
      ctx: 8192,
      ngl: -1,
      tensorSplit: undefined,
      overrides: undefined,
    });
    expect(
      parseFittedArgs(
        '-c 4096 -ngl 27 -ts 1,2 -ot "blk.5.ffn_down.exps=CPU,blk.6.ffn_down.exps=CPU"',
      ),
    ).toEqual({
      ctx: 4096,
      ngl: 27,
      tensorSplit: '1,2',
      overrides: 'blk.5.ffn_down.exps=CPU,blk.6.ffn_down.exps=CPU',
    });
  });

  it('parses the --fit-print device table', () => {
    const result = parseFitPrint('Vulkan1 1840 306 513 \nHost 497 0 28 \n');
    expect(result.devices).toEqual([
      {
        name: 'Vulkan1',
        model: 1840 * 1024 * 1024,
        context: 306 * 1024 * 1024,
        compute: 513 * 1024 * 1024,
      },
    ]);
    expect(result.host.model).toBe(497 * 1024 * 1024);
  });

  it('parses --list-devices lines whose description contains parentheses', () => {
    // Observed line: the device description itself carries "(32GB)", so the
    // memory pair has to be read off the end of the line, not the first '('.
    const devices = parseListDevices(
      'Available devices:\n' +
        '  Vulkan0: Intel(R) Arc(TM) 140T GPU (32GB) (37025 MiB, 37025 MiB free)\n' +
        '  Vulkan1: NVIDIA GeForce RTX 5090 Laptop GPU (24137 MiB, 23369 MiB free)\n',
    );
    expect(devices).toEqual([
      { name: 'Vulkan0', total: 37025 * 1024 * 1024 },
      { name: 'Vulkan1', total: 24137 * 1024 * 1024 },
    ]);
  });
});

describe('the pinned llama.cpp backend', () => {
  it('pins a nightly tag, never a semver tag', () => {
    // llama.cpp's v0.x.y tags carry only nightly-tag.txt; every downloadable
    // bundle lives on a bXXXXX nightly. Pinning a semver tag makes every
    // download URL 404.
    // eslint-disable-next-line global-require
    const pkg = require('../../package.json');
    expect(pkg.binaryVersions.llama).toMatch(/^b\d+$/);
  });
});

describe('clampDrySequenceBreakers', () => {
  it('leaves a breaker list at or under the llama.cpp cap untouched', () => {
    const list = Array.from({ length: MAX_DRY_SEQUENCE_BREAKERS }, (_, i) =>
      String(i),
    );
    expect(clampDrySequenceBreakers(list)).toBe(list);
    expect(clampDrySequenceBreakers(['\n'])).toEqual(['\n']);
    expect(clampDrySequenceBreakers(undefined)).toBeUndefined();
  });

  it('trims an over-cap list to the cap', () => {
    // llama.cpp v0.8.0 LLAMA_DRY_MAX_SEQ_BREAKERS: each breaker costs
    // O(n_vocab) at sampler init, so the server rejects the request past it.
    const list = Array.from(
      { length: MAX_DRY_SEQUENCE_BREAKERS + 12 },
      (_, i) => String(i),
    );
    const clamped = clampDrySequenceBreakers(list);
    expect(clamped).toHaveLength(MAX_DRY_SEQUENCE_BREAKERS);
    expect(clamped?.[0]).toBe('0');
  });
});

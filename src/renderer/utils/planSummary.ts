// What the optimizer decided, in words.
//
// The plan object is the launch carrier (chat.ts reads the same fields to build
// the flags), so this is not a second opinion about placement — it is the same
// solved placement read out. Anything listed here is a fact about the flags the
// server will start with.
import type { Profile } from '../types/profile';

export type OptimizerPlan = NonNullable<Profile['optimizerPlan']>;

const GiB = 1024 ** 3;

const gib = (bytes: number): string => `${(bytes / GiB).toFixed(1)} GiB`;

/** The cache flag is MiB-granular; a pool of 18,668 MiB is easier to read as
 *  GiB, and a 16 MiB one is not. */
const cacheSize = (mib: number): string =>
  mib >= 1024 ? `${(mib / 1024).toFixed(2)} GiB` : `${mib} MiB`;

const CLAMP_LABELS: Record<string, string> = {
  vram: 'GPU memory',
  ram: 'system memory',
  host: 'system memory',
  model: "the model's own maximum context",
};

/**
 * One line per thing the plan decides, in the order the flags matter:
 * layers on the GPU, where the experts live, the expert cache, the dense FFN
 * spill, then the context ceiling and the two conditions worth warning about
 * (nothing fit; system memory pages to disk).
 *
 * `gpuLayers`/`totalLayers` are only present on plans solved by the current
 * optimizer; without them the layer line falls back to the raw -ngl.
 */
export function planSummaryLines(plan: OptimizerPlan): string[] {
  const lines: string[] = [];

  if (plan.ngl <= 0) {
    lines.push('GPU layers: none — the whole model runs in system memory.');
  } else if (plan.totalLayers !== undefined) {
    lines.push(
      `GPU layers: ${plan.gpuLayers ?? 0} of ${plan.totalLayers} blocks ` +
        `(-ngl ${plan.ngl}, which also counts the output tensor).`,
    );
  } else {
    lines.push(`GPU layers: -ngl ${plan.ngl}.`);
  }

  if (plan.kind === 'moe') {
    if (plan.cpuMoe === true) {
      lines.push(
        `Expert weights: every layer's experts in system RAM (--cpu-moe${
          plan.nCpuMoe ? `, ${plan.nCpuMoe} layers` : ''
        }).`,
      );
    } else if ((plan.nCpuMoe ?? 0) > 0) {
      lines.push(
        `Expert weights: the first ${plan.nCpuMoe} layers in system RAM ` +
          '(--n-cpu-moe, set by you, not chosen by the optimizer).',
      );
    } else {
      lines.push('Expert weights: on the GPU.');
    }

    const cache = plan.moeCacheMib ?? 0;
    if (cache > 0) {
      lines.push(
        `Expert cache: ${cacheSize(cache)} of GPU memory, holding the experts ` +
          'a token activates so they are not re-read from system RAM.',
      );
    } else if (plan.cpuMoe === true) {
      lines.push(
        'Expert cache: none — the GPU has no room left for one, so every ' +
          'activated expert is read from system RAM.',
      );
    } else {
      lines.push(
        'Expert cache: not used, because no experts are in system RAM.',
      );
    }
  }

  if ((plan.nCpuFfn ?? 0) > 0) {
    lines.push(
      `Dense FFN weights: the first ${plan.nCpuFfn} layers in system RAM ` +
        '(--n-cpu-ffn, set by you, not chosen by the optimizer).',
    );
  } else {
    lines.push('Dense FFN weights: on the GPU.');
  }

  if (plan.maxCtx) {
    const by = plan.clampedBy ? CLAMP_LABELS[plan.clampedBy] : undefined;
    lines.push(
      `Largest context this holds: ${plan.maxCtx.toLocaleString()} tokens${
        by ? ` (limited by ${by})` : ''
      }.`,
    );
  }

  if (plan.forced) {
    lines.push(
      'Nothing fit the GPU memory: this is the option that overflows it the ' +
        'least.',
    );
  }

  if ((plan.hostOverflowBytes ?? 0) > 0) {
    lines.push(
      `System memory: ${gib(
        plan.hostOverflowBytes!,
      )} over budget, served from the page file. It runs, just slower.`,
    );
  }

  if ((plan.streamedHostBytes ?? 0) > 0) {
    lines.push(
      `Streamed weights: ${gib(
        plan.streamedHostBytes!,
      )} read from the file on demand instead of held in system memory ` +
        '(--lazy-mode).',
    );
  }

  return lines;
}

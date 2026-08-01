import type { ExtensionToolDef } from '../types';
import {
  getPythonEnvironmentInfo,
  runPython,
  runPythonWithImages,
  ensurePackage,
} from '../../main/functions/pythonRunner';
import manifest from './manifest.json';

// Optional graph-layout dependency (drawn through matplotlib).
// Installed lazily and cached for the session; the diagram tool still
// works for non-graph diagrams even if this installation fails.
let networkxReady = false;
let networkxCheckInProgress: Promise<boolean> | null = null;

async function ensureNetworkxPackage(): Promise<void> {
  if (networkxReady) return;
  if (networkxCheckInProgress) {
    await networkxCheckInProgress;
    return;
  }
  networkxCheckInProgress = (async () => {
    const result = await ensurePackage('networkx');
    if (result.success) networkxReady = true;
    return result.success;
  })();
  await networkxCheckInProgress;
}

function trimForModel(s: string | null | undefined, max: number): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `... [truncated]\n${trimmed.slice(-max)}`;
}

export const tools: Record<string, ExtensionToolDef> = {
  python_environment_info: {
    meta: {
      name: 'python_environment_info',
      label: 'Python Environment Info',
      description: 'Check whether Python is installed and available.',
      icon: 'Code',
    },
    params: { type: 'object', properties: {} },
    async handler() {
      return getPythonEnvironmentInfo();
    },
  },
  run_python: {
    meta: {
      name: 'run_python',
      label: 'Run Python',
      description: 'Execute a Python snippet in a sandboxed environment.',
      descriptionForModel:
        'Execute a short, self-contained Python snippet and return its printed output. ' +
        '\n' +
        'PURPOSE — use this tool ONLY to:\n' +
        '  • Perform or verify a numeric calculation (e.g. compound interest, statistics, unit conversions)\n' +
        '  • Run or validate a single algorithm on inline data (e.g. sorting, searching, matrix ops)\n' +
        '  • Confirm a mathematical or logical result you have reasoned about\n' +
        '  • Produce a quick data transformation or summary on a small inline dataset\n' +
        '\n' +
        'NEVER use this tool to:\n' +
        '  • Write or deliver a full program to the user — use write_file for that\n' +
        '  • Prototype application code, classes, or multi-function modules\n' +
        '  • Execute code on behalf of the user as a general coding environment\n' +
        '  • Do anything that cannot be expressed in under ~30 lines of logic\n' +
        '\n' +
        'OUTPUT HANDLING — CRITICAL:\n' +
        '  The user cannot see the code you write or the raw stdout it produces.\n' +
        '  You must ALWAYS:\n' +
        '  • Read the stdout result yourself\n' +
        "  • Interpret what it means in the context of the user's question\n" +
        '  • Re-present the answer to the user in plain language as part of your reply\n' +
        '  Never say "the output was X" as your final answer — explain what X means.\n' +
        '  Never show the code to the user unless they explicitly ask to see it.\n' +
        '\n' +
        'WORKFLOW — always follow this pattern:\n' +
        '  1. Reason through the problem yourself first\n' +
        '  2. Write the minimal snippet that verifies or computes the answer\n' +
        '  3. Use print() for every value you want to read back — nothing else is captured\n' +
        '  4. Read the stdout result and use it to compose a clear, human-readable reply\n' +
        '\n' +
        'AVAILABLE LIBRARIES:\n' +
        '  Scientific: numpy, pandas, scipy, scikit-learn, statsmodels, sympy\n' +
        '  Plotting:   matplotlib (print figure data or summaries; no display)\n' +
        '  Image:      Pillow\n' +
        '  HTTP:       requests, httpx\n' +
        '  Stdlib:     math, random, statistics, decimal, datetime, json, re,\n' +
        '              collections, itertools, functools, heapq, and more\n' +
        '\n' +
        'RESTRICTIONS — these will raise a sandbox error:\n' +
        '  Blocked modules: os, sys, subprocess, socket, pathlib, shutil,\n' +
        '                   threading, multiprocessing, asyncio, ctypes, pickle,\n' +
        '                   importlib, builtins\n' +
        '  Blocked built-ins: open(), exec(), eval(), compile(), input(), breakpoint()\n' +
        '\n' +
        'LIMITS: 15-second timeout. stdout/stderr capped at 100 KB.',
      icon: 'Terminal',
    },
    params: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'A short Python snippet (ideally under 30 lines) that computes or verifies something and prints the result. ' +
            'Must be entirely self-contained — all data is defined inline, no file I/O, no user input. ' +
            'Every value you want to read back must be passed to print(). ' +
            'Remember: the user will never see this code or its raw output — you are responsible for ' +
            'reading the result and translating it into a clear answer in your reply. ' +
            'Do not write class hierarchies, multi-function modules, or application scaffolding here; ' +
            'use write_file for code that is meant to be saved and run by the user.',
        },
      },
      required: ['code'],
    },
    async handler(params: { code: string }) {
      const result = await runPython(params.code);
      if (!result.success) {
        return {
          success: false,
          error: result.error ?? 'Unknown error',
          stdout: result.stdout || null,
          stderr: result.stderr || null,
          timed_out: result.timedOut,
          execution_time_ms: result.executionTimeMs,
          run_id: result.runId,
        };
      }
      return {
        success: true,
        stdout: result.stdout || '(no output)',
        stderr: result.stderr || null,
        timed_out: false,
        execution_time_ms: result.executionTimeMs,
        run_id: result.runId,
      };
    },
  },
  create_diagram: {
    meta: {
      name: 'create_diagram',
      label: 'Create Diagram',
      description:
        'Draw any diagram or infographic with matplotlib and display it as an image.',
      descriptionForHuman:
        'Renders a diagram as an image. Requires a vision model (with projector) for the model to see it.',
      descriptionForModel:
        'Draw ANY kind of diagram or infographic with matplotlib and return it as a rendered image. The image is shown to the user AND you can see it yourself through the vision projector to verify quality.\n' +
        '\n' +
        'SUPPORTED DIAGRAM KINDS (any of these, or anything similar):\n' +
        '  • Flowcharts / process pipelines / decision trees / state machines\n' +
        '  • Infographics: posters, cards, stat tiles, comparison panels, timelines\n' +
        '  • Organizational charts, hierarchy trees, mind maps\n' +
        '  • ER diagrams, class-diagram-style boxes, architecture/network diagrams\n' +
        '  • Precise technical drawings at exact coordinates (panels, grids, layouts)\n' +
        '  • Charts: bar, line, pie, Sankey, radar, gauge, custom composites\n' +
        '  • Network/graph diagrams (networkx is auto-installed; draw via matplotlib)\n' +
        '\n' +
        'OUTPUT MECHANISM — CRITICAL:\n' +
        '  • Your code runs in a sandbox; the working directory is captured afterwards.\n' +
        "  • You MUST save the final figure: plt.savefig('diagram.png') or fig.savefig('diagram.png').\n" +
        '  • Do NOT call plt.show() — there is no display (the backend is Agg).\n' +
        '  • If you save several files, only the first (alphabetically) is returned — save exactly one, named diagram.png.\n' +
        '  • The user cannot see your code or raw stdout — interpret and describe the diagram in your reply.\n' +
        '\n' +
        'RECOMMENDED TEMPLATE:\n' +
        '  import matplotlib.pyplot as plt\n' +
        '  from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle\n' +
        '  fig, ax = plt.subplots(figsize=(10, 6))\n' +
        "  ax.axis('off')\n" +
        '  ax.set_xlim(0, 10); ax.set_ylim(0, 6)\n' +
        '  # boxes:   ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.1", fc=..., ec=...))\n' +
        '  # arrows:  ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=dict(arrowstyle="-|>", color=..., lw=2))\n' +
        "  # text:    ax.text(x, y, 'label', ha='center', va='center', fontsize=10, fontweight='bold')\n" +
        "  fig.savefig('diagram.png', dpi=150, bbox_inches='tight', facecolor='white')\n" +
        '\n' +
        'PRECISION DRAWING GUIDANCE (important for anything technical):\n' +
        '  • matplotlib places everything EXACTLY where your coordinates say — compute them deliberately.\n' +
        '  • Use a generous coordinate range and fixed xlim/ylim so nothing is clipped.\n' +
        '  • Lines: ax.plot([x1,x2],[y1,y2], color=..., lw=...); polylines for custom shapes.\n' +
        '  • Edge labels: ax.text at the midpoint of the edge, with bbox=dict(boxstyle="round", fc="white") for readability.\n' +
        '  • For graph layouts: import networkx as nx; pos = nx.spring_layout(G); nx.draw(G, pos, ax=ax, with_labels=True).\n' +
        '  • Set fig.patch.set_facecolor("white") or pass facecolor="white" to savefig so the image is not transparent.\n' +
        '\n' +
        'COMMON PITFALLS:\n' +
        '  • No image returned = you forgot savefig, or saved to an absolute path outside the sandbox dir.\n' +
        '  • Overlapping text: size boxes to their labels, use bbox on text, keep fontsize modest.\n' +
        '  • If the run errors, read stderr, fix the code, and retry — you may iterate.\n' +
        '\n' +
        'AVAILABLE LIBRARIES:\n' +
        '  matplotlib (pyplot, patches, figure, axes), numpy, pandas, scipy, networkx, PIL, math, random,\n' +
        '  statistics, json, re, collections, itertools, functools, datetime, and more.\n' +
        '\n' +
        'RESTRICTIONS — these will raise a sandbox error:\n' +
        '  Blocked modules: os, sys, subprocess, socket, pathlib, shutil,\n' +
        '                   threading, multiprocessing, asyncio, ctypes, pickle,\n' +
        '                   importlib, builtins\n' +
        '  Blocked built-ins: open(), exec(), eval(), compile(), input(), breakpoint()\n' +
        '  LIMITS: 15-second timeout. stdout/stderr capped at 100 KB. ' +
        'Images capped at 8 MB each (5 files max, only the first is returned).',
      icon: 'Image',
      displayType: 'projector',
      tags: ['diagram'],
    },
    params: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'A self-contained Python snippet (ideally under 50 lines) that draws a diagram with matplotlib ' +
            "and saves it to the working directory, e.g. fig.savefig('diagram.png'). " +
            'No file I/O, no user input, no plt.show(). Every coordinate is your responsibility — place ' +
            'elements exactly where you want them.',
        },
        alt_text: {
          type: 'string',
          description:
            'Optional short description of the diagram (used as the image alt text and summary).',
        },
      },
      required: ['code'],
    },
    async handler(params: { code: string; alt_text?: string }) {
      await ensureNetworkxPackage();
      const result = await runPythonWithImages(params.code);
      if (!result.success) {
        const stderrTail = trimForModel(result.stderr, 4000);
        return {
          _response: `Error creating diagram: ${result.error ?? 'Unknown error'}${
            stderrTail ? `\nstderr:\n${stderrTail}` : ''
          }`,
        };
      }
      if (result.images.length === 0) {
        const stdoutTail = trimForModel(result.stdout, 4000);
        return {
          _response:
            "Error: the code ran successfully but no image was produced. You must save the figure to the sandbox working directory, e.g. fig.savefig('diagram.png') (relative path only). Do not call plt.show()." +
            `${stdoutTail ? `\nstdout:\n${stdoutTail}` : ''}`,
        };
      }
      const primary = result.images[0];
      const extra =
        result.images.length > 1
          ? ` (${result.images.length - 1} additional image file(s) ignored — save only diagram.png)`
          : '';
      return {
        _response: `Created diagram: ${primary.filename} (${Math.round(primary.sizeBytes / 1024)} KB)${extra}`,
        _image: {
          url: primary.dataUrl,
          altText: params.alt_text ?? 'Diagram created with matplotlib',
        },
      };
    },
  },
};

export { manifest };

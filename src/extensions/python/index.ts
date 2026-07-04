import type { ExtensionToolDef } from '../types';
import { getPythonEnvironmentInfo, runPython } from '../../main/functions/pythonRunner';
import manifest from './manifest.json';

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
      return await getPythonEnvironmentInfo();
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
};

export { manifest };

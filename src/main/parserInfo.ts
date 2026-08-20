/* eslint-disable import/prefer-default-export */
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getModelsDirectory } from './settings';
import type { BackendDownload, ParserInfo } from '../renderer/preload.d';

function getBinaryVersions(): { parser: string } {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
    );
    return packageJson.binaryVersions || { parser: 'v0.25.0' };
  } catch {
    return { parser: 'v0.25.0' };
  }
}

const PARSER_VERSION = getBinaryVersions().parser;
const PARSER_BASE = `https://github.com/gpustack/gguf-parser-go/releases/download/${PARSER_VERSION}`;

type ParserTarget = {
  id: string;
  label: string;
  file: string;
  runtime: 'x64' | 'arm64' | 'metal';
};

// Mirrors .erb/scripts/setup-binaries.ts PARSER_TARGETS so filenames match the
// binaries the runtime expects under assets/bin/utils.
const PARSER_TARGETS: ParserTarget[] = [
  {
    id: 'win-x64',
    label: 'GGUF Parser (x64)',
    file: 'gguf-parser-windows-amd64.exe',
    runtime: 'x64',
  },
  {
    id: 'win-arm64',
    label: 'GGUF Parser (arm64)',
    file: 'gguf-parser-windows-arm64.exe',
    runtime: 'arm64',
  },
  {
    id: 'mac-x64',
    label: 'GGUF Parser (x64)',
    file: 'gguf-parser-darwin-amd64',
    runtime: 'metal',
  },
  {
    id: 'mac-arm64',
    label: 'GGUF Parser (arm64)',
    file: 'gguf-parser-darwin-arm64',
    runtime: 'metal',
  },
  {
    id: 'linux-x64',
    label: 'GGUF Parser (x64)',
    file: 'gguf-parser-linux-amd64',
    runtime: 'x64',
  },
  {
    id: 'linux-arm64',
    label: 'GGUF Parser (arm64)',
    file: 'gguf-parser-linux-arm64',
    runtime: 'arm64',
  },
];

function buildDownload(target: ParserTarget): BackendDownload {
  return {
    id: target.id,
    label: target.label,
    icon: 'parser',
    url: `${PARSER_BASE}/${target.file}`,
    folder: target.file,
    files: [target.file],
    recommended: false,
  };
}

function matchesPlatform(id: string, platform: string): boolean {
  if (platform === 'win32') return id.startsWith('win-');
  if (platform === 'darwin') return id.startsWith('mac-');
  return id.startsWith('linux-');
}

export function getParserInfo(): ParserInfo {
  const { platform, arch } = process;
  const systemRuntime = platform === 'darwin' ? 'metal' : arch;

  const OS_PREFIX: Record<string, string> = {
    win32: 'win',
    darwin: 'mac',
    linux: 'linux',
  };
  const prefix = OS_PREFIX[platform] ?? 'linux';
  const archLabel = arch === 'arm64' ? 'arm64' : 'x64';
  const matchId = `${prefix}-${archLabel}`;

  const recommended: BackendDownload[] = PARSER_TARGETS.filter(
    (t) => t.id === matchId,
  ).map((t) => ({ ...buildDownload(t), recommended: true }));

  // Every other build is listed under "All Builds", tagged when it cannot run
  // natively on this system (wrong OS or wrong architecture). Apple Silicon
  // runs the x64 build via Rosetta, so it stays untagged.
  const others: BackendDownload[] = PARSER_TARGETS.filter(
    (t) => t.id !== matchId,
  ).map((t) => {
    const download = buildDownload(t);
    if (!matchesPlatform(t.id, platform) || t.runtime !== systemRuntime) {
      download.tags = ['wrong-arch'];
    }
    return download;
  });

  return {
    platform,
    arch,
    defaultDownloadDir: path.join(path.dirname(getModelsDirectory()), 'parser'),
    recommended,
    optional: [
      {
        id: 'custom',
        label: 'Custom Binary',
        sublabel: 'Point to your own GGUF Parser build',
        icon: 'custom',
        url: '',
        folder: '',
        files: [],
        recommended: false,
      },
    ],
    others,
  };
}

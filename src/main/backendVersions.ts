/* global __LLAMA_VERSION__ */
/* eslint-disable import/prefer-default-export */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { BackendUpdateState } from '../renderer/preload.d';

// The llama.cpp build this Synapse release is built against. It is a nightly
// tag (bXXXXX), never a v0.x.y semver tag: the semver tags carry only
// nightly-tag.txt, all downloadable bundles live on the nightlies.
//
// Everything that talks about "which llama.cpp am I supposed to have" resolves
// through here, so an installed backend can be compared against this build
// without ever asking GitHub what the latest release is.

// Written next to the binaries of every Synapse-installed backend. Settings
// can be reset and backend folders are movable, so the folder itself carries
// its own provenance.
export const BACKEND_MARKER_FILE = 'synapse-backend.json';

export interface BackendMarker {
  id: string;
  label: string;
  llamaVersion: string;
  synapseVersion?: string;
  installedAt: string;
  /**
   * Release target/folder this build was downloaded as. Recorded because the
   * folder name alone cannot prove an install is ours, and a target that
   * upstream later renamed (CUDA 13.4 -> 13.5) has to be recognised as
   * something Synapse put there rather than a custom build.
   */
  target?: string;
  /** Archives this install came from, main bundle first (cudart included). */
  assets?: string[];
}

// Only used when package.json cannot be read (a packaged app always ships one).
// Keep in step with binaryVersions.llama — this string builds the download
// URLs, so a stale value points at a backend we no longer support.
const FALLBACK_LLAMA_VERSION = 'b12359';

function readPinnedLlamaVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
    );
    const pinned = packageJson.binaryVersions?.llama;
    return typeof pinned === 'string' && pinned
      ? pinned
      : FALLBACK_LLAMA_VERSION;
  } catch {
    return FALLBACK_LLAMA_VERSION;
  }
}

// Prefer the build-time value injected by webpack's DefinePlugin (see
// .erb/configs/binaryVersions.ts): a packaged app's app.getAppPath() resolves
// the release package.json, which carries no binaryVersions — a runtime-only
// read would silently fall back to a stale tag after any pin bump. The
// typeof guard keeps this compiling under jest and ts-node, where the
// DefinePlugin global does not exist and the package.json read is the right
// source (it resolves the root package.json there).
const PINNED_LLAMA_VERSION =
  typeof __LLAMA_VERSION__ !== 'undefined'
    ? __LLAMA_VERSION__
    : readPinnedLlamaVersion();

export function getLlamaVersion(): string {
  return PINNED_LLAMA_VERSION;
}

export function getSynapseVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return '';
  }
}

// Nightly tags are monotonically increasing build numbers, so "newer" is a
// numeric comparison of the digits after the leading letter. Anything that
// does not parse (a custom build, a renamed tag) compares equal, which keeps
// the caller out of the business of inventing an ordering it cannot prove.
export function compareLlamaTags(a: string, b: string): number {
  const num = (tag: string): number | null => {
    const m = /^[A-Za-z]*(-\d+|\d+)$/.exec(tag.trim());
    if (!m) return null;
    const digits = parseInt(m[0].replace(/\D/g, ''), 10);
    return Number.isNaN(digits) ? null : digits;
  };
  const left = num(a);
  const right = num(b);
  if (left === null || right === null || left === right) return 0;
  return left < right ? -1 : 1;
}

// `BackendUpdateState` is the renderer's own type (preload.d): the state is
// computed here and read straight off the IPC payload, so declaring it twice
// would only create a way for the two to drift.
export function classifyInstalled(
  installedVersion: string | null | undefined,
  pinnedVersion: string = getLlamaVersion(),
): BackendUpdateState {
  if (!installedVersion) return 'unknown';
  if (installedVersion === pinnedVersion) return 'current';
  const order = compareLlamaTags(installedVersion, pinnedVersion);
  if (order < 0) return 'update-available';
  if (order > 0) return 'newer';
  return 'unknown';
}

export function writeBackendMarker(
  backendDir: string,
  marker: BackendMarker,
): void {
  try {
    fs.mkdirSync(backendDir, { recursive: true });
    fs.writeFileSync(
      path.join(backendDir, BACKEND_MARKER_FILE),
      JSON.stringify(marker, null, 2),
      'utf8',
    );
  } catch (error) {
    // Provenance is a convenience, never a reason to fail an install that
    // already succeeded.
    console.warn(
      '[backend] could not write',
      BACKEND_MARKER_FILE,
      'in',
      backendDir,
      error instanceof Error ? error.message : error,
    );
  }
}

export function readBackendMarker(backendDir: string): BackendMarker | null {
  try {
    const raw = fs.readFileSync(
      path.join(backendDir, BACKEND_MARKER_FILE),
      'utf8',
    );
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.llamaVersion !== 'string'
    ) {
      return null;
    }
    return {
      id: typeof parsed.id === 'string' ? parsed.id : '',
      label: typeof parsed.label === 'string' ? parsed.label : '',
      llamaVersion: parsed.llamaVersion,
      synapseVersion:
        typeof parsed.synapseVersion === 'string'
          ? parsed.synapseVersion
          : undefined,
      installedAt:
        typeof parsed.installedAt === 'string' ? parsed.installedAt : '',
      // Markers written before target/assets existed stay readable: the folder
      // name is the target, and the assets are unknown.
      target: typeof parsed.target === 'string' ? parsed.target : undefined,
      assets: Array.isArray(parsed.assets)
        ? parsed.assets.filter(
            (a: unknown): a is string => typeof a === 'string',
          )
        : undefined,
    };
  } catch {
    // No marker (pre-versioning install, hand-copied build, dev assets/bin).
    return null;
  }
}

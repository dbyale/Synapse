import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { LLAMA_VERSION } from '../configs/binaryVersions';

const ASSETS_BIN = path.join(__dirname, '../../assets/bin');

// NOTICE: Some versions like CUDA may vary depending on the targeted build
// The pin is a llama.cpp NIGHTLY tag (bXXXXX), not a semver tag: the v0.x.y
// tags carry no binaries — the mapping lives in a nightly-tag.txt file attached
// to the semver *release* (not its tree). For reference, v0.6.0 -> b11429,
// v0.7.0 -> b11669, v0.8.0 -> b11960, v0.9.0 -> b12110, v1.0.0 -> b12359.
// v1.0.0 also renamed the CUDA targets: 13.4 -> 13.5, so the folder names below
// changed with it.
const TARGETS: [string, string][] = [
  [`llama-${LLAMA_VERSION}-bin-macos-arm64.tar.gz`, 'macos-arm64'],
  [`llama-${LLAMA_VERSION}-bin-macos-x64.tar.gz`, 'macos-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cuda-13.5-x64.zip`, 'win-cuda-13.5-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-vulkan-x64.zip`, 'win-vulkan-x64'],
  [
    `llama-${LLAMA_VERSION}-bin-win-opencl-adreno-arm64.zip`,
    'win-opencl-adreno-arm64',
  ],
  [`llama-${LLAMA_VERSION}-bin-ubuntu-vulkan-x64.tar.gz`, 'ubuntu-vulkan-x64'],
  [
    `llama-${LLAMA_VERSION}-bin-ubuntu-vulkan-arm64.tar.gz`,
    'ubuntu-vulkan-arm64',
  ],
];

const CUDA_RUNTIMES: [string, string][] = [
  [`cudart-llama-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`cudart-llama-bin-win-cuda-13.5-x64.zip`, 'win-cuda-13.5-x64'],
];

// Binaries kept from each llama.cpp release bundle: the server, the
// llama-fit-params estimator and llama-gguf-split (all must match the
// server's build/backend). Kept as a list so the bundle can be verified after
// extraction — an upstream rename would otherwise land as a half-empty backend
// folder and only fail much later, when the server refuses to start.
const REQUIRED_BINS = ['llama-server', 'llama-fit-params', 'llama-gguf-split'];

const keepEntry = (name: string) =>
  REQUIRED_BINS.some((bin) => name.includes(bin)) ||
  name.endsWith('.dll') ||
  name.endsWith('.dylib');

async function downloadAndExtract(url: string, targetFolder: string) {
  const targetDir = path.join(ASSETS_BIN, targetFolder);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  console.log(`Downloading: ${path.basename(url)}...`);
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to download ${url}: ${response.statusText}`);

  const buffer = await response.buffer();

  if (url.endsWith('.zip')) {
    const zip = new AdmZip(buffer);
    zip.getEntries().forEach((entry: AdmZip.IZipEntry) => {
      if (keepEntry(entry.entryName)) {
        zip.extractEntryTo(entry, targetDir, false, true);
      }
    });
  } else if (url.endsWith('.tar.gz')) {
    const tempTar = path.join(ASSETS_BIN, `temp-${targetFolder}.tar.gz`);
    fs.writeFileSync(tempTar, buffer);
    await tar.x({
      file: tempTar,
      cwd: targetDir,
      strip: 1,
      filter: (p: string) => keepEntry(p),
    });
    fs.unlinkSync(tempTar);
  } else {
    throw new Error(`Unsupported binary bundle URL: ${url}`);
  }

  // Windows bundles carry .exe names; macOS/Linux tarballs do not.
  const exe = url.endsWith('.zip') ? '.exe' : '';
  const missing = REQUIRED_BINS.filter(
    (bin) => !fs.existsSync(path.join(targetDir, `${bin}${exe}`)),
  );
  if (missing.length > 0) {
    throw new Error(
      `${path.basename(url)} is missing: ${missing.join(', ')}. ` +
        `The llama.cpp ${LLAMA_VERSION} bundle layout changed, or this asset ` +
        `is not a full backend build.`,
    );
  }

  // Set executable permissions for Unix
  if (process.platform !== 'win32') {
    for (const bin of REQUIRED_BINS) {
      const binPath = path.join(targetDir, bin);
      if (fs.existsSync(binPath)) fs.chmodSync(binPath, '755');
    }
  }
}

async function run() {
  const llamaBase = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}`;

  console.log('--- Starting Binary Setup ---');

  fs.rmSync(ASSETS_BIN, { recursive: true, force: true });
  fs.mkdirSync(ASSETS_BIN, { recursive: true });

  // 1. Download Llama Backends
  for (const [file, folder] of TARGETS) {
    await downloadAndExtract(`${llamaBase}/${file}`, folder);
  }

  // 2. Download CUDA Runtimes
  for (const [file, folder] of CUDA_RUNTIMES) {
    await downloadAndExtract(`${llamaBase}/${file}`, folder);
  }

  console.log('--- All binaries set up successfully ---');
}

run().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

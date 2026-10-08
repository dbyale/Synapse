import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

const ASSETS_BIN = path.join(__dirname, '../../assets/bin');

const JSON_PATH = path.join(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

// NOTICE: Some versions like CUDA may vary depending on the targeted build
const LLAMA_VERSION = packageJson.binaryVersions.llama;

const TARGETS: [string, string][] = [
  [`llama-${LLAMA_VERSION}-bin-macos-arm64.tar.gz`, 'macos-arm64'],
  [`llama-${LLAMA_VERSION}-bin-macos-x64.tar.gz`, 'macos-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cuda-13.4-x64.zip`, 'win-cuda-13.4-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-vulkan-x64.zip`, 'win-vulkan-x64'],
  [
    `llama-${LLAMA_VERSION}-bin-win-opencl-adreno-arm64.zip`,
    'win-adreno-arm64',
  ],
  [`llama-${LLAMA_VERSION}-bin-ubuntu-vulkan-x64.tar.gz`, 'ubuntu-vulkan-x64'],
  [
    `llama-${LLAMA_VERSION}-bin-ubuntu-vulkan-arm64.tar.gz`,
    'ubuntu-vulkan-arm64',
  ],
];

const CUDA_RUNTIMES: [string, string][] = [
  [`cudart-llama-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`cudart-llama-bin-win-cuda-13.4-x64.zip`, 'win-cuda-13.4-x64'],
];

// Binaries kept from each llama.cpp release bundle: the server plus the
// llama-fit-params estimator (which must match the server's build/backend).
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
      if (
        entry.entryName.includes('llama-server') ||
        entry.entryName.includes('llama-fit-params') ||
        entry.entryName.endsWith('.dll')
      ) {
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
      filter: (p: string) =>
        p.includes('llama-server') ||
        p.includes('llama-fit-params') ||
        p.endsWith('.dylib'),
    });
    fs.unlinkSync(tempTar);
  } else {
    throw new Error(`Unsupported binary bundle URL: ${url}`);
  }

  // Set executable permissions for Unix
  if (process.platform !== 'win32') {
    for (const bin of ['llama-server', 'llama-fit-params']) {
      const binPath = path.join(targetDir, bin);
      if (fs.existsSync(binPath)) fs.chmodSync(binPath, '755');
    }
  }
}

async function run() {
  const llamaBase = `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_VERSION}`;

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

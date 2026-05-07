import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

const LLAMA_VERSION = 'b9049';
const ASSETS_BIN = path.join(__dirname, '../../assets/bin');

// Mapping: [Release FileName, Target Folder Name]
const TARGETS: [string, string][] = [
  // macOS
  [`llama-${LLAMA_VERSION}-bin-macos-arm64.tar.gz`, 'macos-arm64'],
  [`llama-${LLAMA_VERSION}-bin-macos-x64.tar.gz`, 'macos-x64'],

  // Windows
  [`llama-${LLAMA_VERSION}-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cuda-13.1-x64.zip`, 'win-cuda-13.1-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-vulkan-x64.zip`, 'win-vulkan-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cpu-x64.zip`, 'win-cpu-x64'],

  // Linux
  [`llama-${LLAMA_VERSION}-bin-ubuntu-x64.tar.gz`, 'ubuntu-x64'],
  [`llama-${LLAMA_VERSION}-bin-ubuntu-vulkan-x64.tar.gz`, 'ubuntu-vulkan-x64'],
];

const CUDA_RUNTIMES: [string, string][] = [
  [`cudart-llama-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`cudart-llama-bin-win-cuda-13.1-x64.zip`, 'win-cuda-13.1-x64'],
];

async function downloadAndExtract(url: string, targetFolder: string) {
  const targetDir = path.join(ASSETS_BIN, targetFolder);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  console.log(`Downloading: ${path.basename(url)}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);

  const buffer = await response.buffer();
  const isZip = url.endsWith('.zip');

  if (isZip) {
    const zip = new AdmZip(buffer);
    // Explicitly typing the entry to fix TS7006
    zip.getEntries().forEach((entry: AdmZip.IZipEntry) => {
      if (
        entry.entryName.includes('llama-server') ||
        entry.entryName.includes('gguf-parser') ||
        entry.entryName.endsWith('.dll')
      ) {
        zip.extractEntryTo(entry, targetDir, false, true);
      }
    });
  } else {
    const tempTar = path.join(ASSETS_BIN, `temp-${targetFolder}.tar.gz`);
    fs.writeFileSync(tempTar, buffer);

    await tar.x({
      file: tempTar,
      cwd: targetDir,
      // Explicitly typing the path string
      filter: (p: string) => p.includes('llama-server') || p.includes('gguf-parser'),
    });

    fs.unlinkSync(tempTar);
  }
}

async function run() {
  const llamaBaseUrl = `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_VERSION}`;

  console.log('--- Starting Llama Binary Setup ---');

  // 1. Download Main Backends
  for (const [file, folder] of TARGETS) {
    await downloadAndExtract(`${llamaBaseUrl}/${file}`, folder);
  }

  // 2. Merge CUDA DLLs
  for (const [file, folder] of CUDA_RUNTIMES) {
    await downloadAndExtract(`${llamaBaseUrl}/${file}`, folder);
  }

  console.log('--- All backends set up in assets/bin ---');
}

run().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

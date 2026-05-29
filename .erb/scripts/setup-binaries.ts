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
const PARSER_VERSION = packageJson.binaryVersions.parser;

const TARGETS: [string, string][] = [
  [`llama-${LLAMA_VERSION}-bin-macos-arm64.tar.gz`, 'macos-arm64'],
  [`llama-${LLAMA_VERSION}-bin-macos-x64.tar.gz`, 'macos-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cuda-13.3-x64.zip`, 'win-cuda-13.3-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-vulkan-x64.zip`, 'win-vulkan-x64'],
  [`llama-${LLAMA_VERSION}-bin-win-cpu-x64.zip`, 'win-cpu-x64'],
  [`llama-${LLAMA_VERSION}-bin-ubuntu-x64.tar.gz`, 'ubuntu-x64'],
  [`llama-${LLAMA_VERSION}-bin-ubuntu-vulkan-x64.tar.gz`, 'ubuntu-vulkan-x64'],
];

const CUDA_RUNTIMES: [string, string][] = [
  [`cudart-llama-bin-win-cuda-12.4-x64.zip`, 'win-cuda-12.4-x64'],
  [`cudart-llama-bin-win-cuda-13.3-x64.zip`, 'win-cuda-13.3-x64'],
];

async function downloadAndExtract(url: string, targetFolder: string) {
  const targetDir = path.join(ASSETS_BIN, targetFolder);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  console.log(`Downloading: ${path.basename(url)}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);

  const buffer = await response.buffer();

  if (url.endsWith('.zip')) {
    const zip = new AdmZip(buffer);
    zip.getEntries().forEach((entry: AdmZip.IZipEntry) => {
      if (entry.entryName.includes('llama-server') || entry.entryName.endsWith('.dll')) {
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
      filter: (p: string) => p.includes('llama-server') || p.endsWith('.dylib'),
    });
    fs.unlinkSync(tempTar);
  } else {
    // Handling raw binary files from gguf-parser releases (no extension)
    const isWin = url.includes('windows') || url.endsWith('.exe');
    const fileName = isWin ? 'gguf-parser.exe' : 'gguf-parser';
    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, buffer);
  }

  // Set executable permissions for Unix
  if (process.platform !== 'win32') {
    const binPath = path.join(targetDir, 'llama-server');
    const parserPath = path.join(targetDir, 'gguf-parser');
    if (fs.existsSync(binPath)) fs.chmodSync(binPath, '755');
    if (fs.existsSync(parserPath)) fs.chmodSync(parserPath, '755');
  }
}

async function run() {
  const llamaBase = `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_VERSION}`;
  const parserBase = `https://github.com/gpustack/gguf-parser-go/releases/download/${PARSER_VERSION}`;

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

  // 3. Download Parser (Detect OS and Arch for v0.24.0 naming convention)
  let parserFile = '';
  if (process.platform === 'win32') {
    parserFile = 'gguf-parser-windows-amd64.exe';
  } else if (process.platform === 'darwin') {
    parserFile = process.arch === 'arm64' ? 'gguf-parser-darwin-arm64' : 'gguf-parser-darwin-amd64';
  } else {
    parserFile = 'gguf-parser-linux-amd64';
  }

  // Save parser in a central 'utils' folder
  await downloadAndExtract(`${parserBase}/${parserFile}`, 'utils');

  console.log('--- All binaries set up successfully ---');
}

run().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

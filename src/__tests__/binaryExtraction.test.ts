/** @jest-environment node */

// Archive extraction is main-process code (Node, not the DOM): yauzl needs the
// Node timers, so this suite runs in the node test environment.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

import {
  commitStagedBackend,
  extractZip,
  requiresLlamaBundle,
  sweepBackendScratch,
  zipPayloadBytes,
} from '../main/binaryDownloads';

// binaryDownloads pulls in electron app paths and the settings store; both are
// replaced so the archive helpers can run against a temp directory.
jest.mock('electron', () => {
  const fsp = require('fs');
  const osm = require('os');
  const pth = require('path');
  const dir = fsp.mkdtempSync(pth.join(osm.tmpdir(), 'synapse-zip-app-'));
  return {
    app: {
      getPath: () => dir,
      getAppPath: () => pth.join(__dirname, '../..'),
      getName: () => 'Synapse',
      getVersion: () => '1.0.0-test',
      isPackaged: false,
    },
  };
});

const mockSettings: any = {
  modelsDirectory: '',
  backendDirectory: '',
  customBinaryPaths: [],
  backendDownloads: [],
  selectedBackend: 'Default',
};

jest.mock('../main/settings', () => ({
  loadSettings: () => mockSettings,
  saveSettings: () => undefined,
  getModelsDirectory: () => mockSettings.modelsDirectory,
}));

// A STORE-method zip, written by hand so the archive has no third-party
// dependency and every byte of its payload is known up front.
// `unsizedCentralDirectory` reproduces a streamed archive: sizes are deferred to
// data descriptors, so the central directory leaves them at 0.
function buildZip(
  entries: { name: string; data: Buffer }[],
  options: { unsizedCentralDirectory?: boolean } = {},
): Buffer {
  const unsized = options.unsizedCentralDirectory === true;
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  entries.forEach(({ name, data }) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data); // already an unsigned 32-bit value

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(unsized ? 0x08 : 0, 6); // flags: bit 3 = deferred sizes
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(unsized ? 0x08 : 0, 8); // flags
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(unsized ? 0 : data.length, 20);
    central.writeUInt32LE(unsized ? 0 : data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeFixtureZip(root: string, name: string): string {
  const zipPath = path.join(root, name);
  fs.writeFileSync(
    zipPath,
    buildZip([
      // Large enough to span several read chunks, which is what makes the
      // progress counter move within one file instead of per file.
      { name: 'bin/llama-server.exe', data: Buffer.alloc(3 * 1024 * 1024, 7) },
      { name: 'bin/llama-fit-params.exe', data: Buffer.alloc(1024 * 1024, 9) },
      // Not part of a llama backend bundle: must stay out of both the size
      // count and the extracted folder.
      { name: 'docs/README.md', data: Buffer.from('not part of the bundle') },
    ]),
  );
  return zipPath;
}

const keepBinaries = (name: string) => name.endsWith('.exe');

describe('backend archive unpacking progress', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-zip-'));
  });

  it('sizes exactly the payload the extraction writes', async () => {
    const zipPath = writeFixtureZip(root, 'bundle.zip');
    const destDir = path.join(root, 'win-cuda-13.4-x64');
    fs.mkdirSync(destDir, { recursive: true });

    const sized = await zipPayloadBytes(zipPath, keepBinaries);
    let counted = 0;
    await extractZip(zipPath, destDir, keepBinaries, 'test', (bytes) => {
      counted += bytes;
    });

    expect(sized).toBe(3 * 1024 * 1024 + 1024 * 1024);
    // The whole point of sizing first: the bar lands on 100% and never
    // overshoots, and it does not stall on the largest file.
    expect(counted).toBe(sized);
    expect(fs.readdirSync(destDir).sort()).toEqual([
      'llama-fit-params.exe',
      'llama-server.exe',
    ]);
  });

  it('leaves filtered-out entries on disk in the archive, not in the backend', async () => {
    const zipPath = writeFixtureZip(root, 'bundle.zip');
    const destDir = path.join(root, 'win-vulkan-x64');
    fs.mkdirSync(destDir, { recursive: true });

    await extractZip(zipPath, destDir, keepBinaries, 'test');

    expect(fs.existsSync(path.join(destDir, 'README.md'))).toBe(false);
    expect(fs.existsSync(path.join(destDir, 'llama-server.exe'))).toBe(true);
  });

  it('falls back to indeterminate progress when the archive cannot be sized', async () => {
    const broken = path.join(root, 'broken.zip');
    fs.writeFileSync(broken, 'this is not a zip');

    expect(await zipPayloadBytes(broken, () => true)).toBe(0);
    expect(
      await zipPayloadBytes(path.join(root, 'never-created.zip'), () => true),
    ).toBe(0);
  });

  it('extracts an archive whose payload was never sized', async () => {
    // Progress must not be load-bearing: an install with no byte callbacks
    // still has to produce a usable backend folder.
    const zipPath = writeFixtureZip(root, 'bundle.zip');
    const destDir = path.join(root, 'win-cpu-x64');
    fs.mkdirSync(destDir, { recursive: true });

    await expect(
      extractZip(zipPath, destDir, keepBinaries, 'test'),
    ).resolves.toBeUndefined();
    expect(fs.readdirSync(destDir)).toHaveLength(2);
  });

  it('reports an unsized payload as indeterminate rather than as zero bytes', async () => {
    // A streamed zip defers sizes to data descriptors, leaving the central
    // directory at 0. Summing those would report a real total of 0 and pin the
    // bar at 0% until the last entry lands.
    const zipPath = path.join(root, 'streamed.zip');
    fs.writeFileSync(
      zipPath,
      buildZip(
        [
          { name: 'bin/llama-server.exe', data: Buffer.alloc(64 * 1024, 3) },
          {
            name: 'bin/llama-fit-params.exe',
            data: Buffer.alloc(64 * 1024, 5),
          },
        ],
        { unsizedCentralDirectory: true },
      ),
    );

    expect(await zipPayloadBytes(zipPath, keepBinaries)).toBe(0);
  });
});

describe('llama bundle invariant', () => {
  it('applies to llama.cpp backend installs', () => {
    expect(requiresLlamaBundle('backend', { extractAll: false })).toBe(true);
    expect(requiresLlamaBundle('backend', {})).toBe(true);
  });

  it('does not apply to the python runtime or other full-archive installs', () => {
    // The runtime is not a llama.cpp build: it has no llama-server in it, and
    // failing a runtime that extracted perfectly is worse than the check.
    expect(requiresLlamaBundle('python', { extractAll: true })).toBe(false);
    expect(requiresLlamaBundle('backend', { extractAll: true })).toBe(false);
  });
});

describe('install swap', () => {
  const folder = 'win-cuda-13.4-x64';

  let root: string;

  /** The live folder, or the staging folder, holding one marker file. */
  function makeDir(dir: string, marker: string): string {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, marker), marker);
    return dir;
  }

  function live(): string {
    return path.join(root, folder);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-swap-'));
  });

  it('moves a first install into place', () => {
    const stage = makeDir(path.join(root, `.${folder}.install-tmp`), 'new');

    commitStagedBackend(root, folder, stage);

    expect(fs.readdirSync(live())).toEqual(['new']);
    expect(fs.existsSync(stage)).toBe(false);
  });

  it('replaces the previous build without leaving a backup behind', () => {
    makeDir(live(), 'old');
    const stage = makeDir(path.join(root, `.${folder}.install-tmp`), 'new');

    commitStagedBackend(root, folder, stage);

    expect(fs.readdirSync(live())).toEqual(['new']);
    expect(fs.readdirSync(root)).toEqual([folder]);
  });

  it('restores a build left in the backup by an interrupted swap', () => {
    // Crashed between the two renames: nothing live, the working build parked
    // in .install-old. The next install has to find it rather than treat the
    // backend as absent.
    makeDir(path.join(root, `.${folder}.install-old`), 'old');
    const stage = makeDir(path.join(root, `.${folder}.install-tmp`), 'new');

    commitStagedBackend(root, folder, stage);

    expect(fs.readdirSync(live())).toEqual(['new']);
    expect(fs.readdirSync(root)).toEqual([folder]);
  });

  it('keeps the working build when the new one cannot be moved in', () => {
    // Simulates the failed second rename: the old build is back in place and
    // the user still has a backend, which is the whole point of staging.
    makeDir(live(), 'old');
    const stage = makeDir(path.join(root, `.${folder}.install-tmp`), 'new');
    const { renameSync } = fs;
    let renames = 0;
    (fs as any).renameSync = (...args: unknown[]) => {
      renames += 1;
      if (renames === 2)
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return renameSync(...(args as [string, string]));
    };

    try {
      expect(() => commitStagedBackend(root, folder, stage)).toThrow(
        `${folder} is in use — stop the running model and try again.`,
      );
      expect(fs.readdirSync(live())).toEqual(['old']);
    } finally {
      (fs as any).renameSync = renameSync;
    }
  });
});

describe('backend scratch sweep', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-sweep-'));
  });

  function touch(name: string): string {
    const full = path.join(root, name);
    if (name.endsWith('.part')) {
      fs.writeFileSync(full, 'partial');
    } else {
      fs.mkdirSync(full, { recursive: true });
      fs.writeFileSync(path.join(full, 'file'), 'x');
    }
    return full;
  }

  it('removes staging folders and partial archives, keeps real installs', () => {
    touch('.win-cuda-13.5-x64.install-tmp');
    touch('.download-win-cuda-13.5-x64.part');
    touch('.cudart-llama-bin-win-cuda-13.5-x64.zip.part');
    const live = touch('win-cuda-13.5-x64');
    const other = touch('some-user-folder');

    const removed = sweepBackendScratch(root);

    expect(removed).toHaveLength(3);
    expect(fs.readdirSync(root).sort()).toEqual(
      ['some-user-folder', 'win-cuda-13.5-x64'].sort(),
    );
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('reclaims the previous build only when a live build exists', () => {
    // Normal case: the swap finished, the backup is dead weight.
    touch('win-vulkan-x64');
    touch('.win-vulkan-x64.install-old');

    expect(sweepBackendScratch(root)).toHaveLength(1);
    expect(fs.readdirSync(root)).toEqual(['win-vulkan-x64']);
  });

  it('restores the held-aside build when nothing is live', () => {
    // A swap that died between the two renames leaves the only working backend
    // in .install-old. Deleting that would destroy an install the user still
    // has, so the sweep moves it back instead.
    const backup = touch('.win-vulkan-x64.install-old');

    expect(sweepBackendScratch(root)).toHaveLength(0);
    expect(fs.existsSync(backup)).toBe(false);
    expect(fs.readdirSync(root)).toEqual(['win-vulkan-x64']);
    expect(fs.readdirSync(path.join(root, 'win-vulkan-x64'))).toEqual(['file']);
  });

  it('says nothing about a directory it cannot read', () => {
    expect(sweepBackendScratch(path.join(root, 'does-not-exist'))).toEqual([]);
  });
});

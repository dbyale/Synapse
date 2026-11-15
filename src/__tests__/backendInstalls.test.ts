import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  BACKEND_MARKER_FILE,
  classifyInstalled,
  compareLlamaTags,
  getLlamaVersion,
  readBackendMarker,
  writeBackendMarker,
} from '../main/backendVersions';
import { getInstalledBackends } from '../main/backendInventory';
import {
  getFitParamsBinName,
  getServerBinName,
  getSplitBinName,
  resolveBackend,
  resolveFitBinary,
  resolveSplitBinary,
} from '../main/backendPaths';
import { uninstallInstalledBackend } from '../main/binaryDownloads';

// Backend provenance and inventory live in the main process and talk to the
// filesystem plus app paths. Both are replaced here: the app path mock points
// at the real package.json (so the pinned llama.cpp version is whatever this
// checkout pins) and the settings mock keeps the download records in memory,
// which is exactly what the reconciliation rules operate on.
jest.mock('electron', () => {
  const fsp = require('fs');
  const osm = require('os');
  const pth = require('path');
  const dir = fsp.mkdtempSync(pth.join(osm.tmpdir(), 'synapse-backend-app-'));
  return {
    app: {
      getPath: () => dir,
      getAppPath: () => pth.join(__dirname, '../..'),
      getName: () => 'Synapse',
      getVersion: () => '1.0.0-test',
      isPackaged: false,
    },
    // binaryDownloads broadcasts backends:changed through every window; the
    // suite has none, and the broadcast must never be what fails an install.
    BrowserWindow: { getAllWindows: () => [] },
  };
});

let mockSettings: any = {
  modelsDirectory: '',
  backendDirectory: '',
  customBinaryPaths: [],
  backendDownloads: [],
  selectedBackend: 'Default',
};
let mockSaved: any[] = [];

jest.mock('../main/settings', () => ({
  loadSettings: () => mockSettings,
  saveSettings: (settings: any) => {
    mockSaved.push({
      ...settings,
      backendDownloads: [...settings.backendDownloads],
    });
  },
  getModelsDirectory: () => mockSettings.modelsDirectory,
}));

const PINNED = getLlamaVersion();

function makeBackend(
  root: string,
  folder: string,
  options: {
    server?: boolean;
    fitParams?: boolean;
    split?: boolean;
    marker?: { llamaVersion: string; id?: string; label?: string };
  } = {},
): string {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  if (options.server !== false) {
    fs.writeFileSync(path.join(dir, getServerBinName()), '');
  }
  if (options.fitParams) {
    fs.writeFileSync(path.join(dir, getFitParamsBinName()), '');
  }
  if (options.split) {
    fs.writeFileSync(path.join(dir, getSplitBinName()), '');
  }
  if (options.marker) {
    writeBackendMarker(dir, {
      id: options.marker.id ?? folder,
      label: options.marker.label ?? folder,
      llamaVersion: options.marker.llamaVersion,
      installedAt: '2026-01-01T00:00:00.000Z',
    });
  }
  return dir;
}

describe('llama.cpp version provenance', () => {
  it('orders nightly build tags numerically', () => {
    expect(compareLlamaTags('b11429', 'b11669')).toBe(-1);
    expect(compareLlamaTags('b12110', 'b11960')).toBe(1);
    expect(compareLlamaTags('b11669', 'b11669')).toBe(0);
  });

  it('refuses to invent an ordering it cannot prove', () => {
    expect(compareLlamaTags('custom-build', 'b11669')).toBe(0);
    expect(compareLlamaTags('', 'b11669')).toBe(0);
    // Semver tags carry no binaries, so a build spelled that way cannot be
    // placed on the nightly timeline — equal here, unknown in the UI.
    expect(compareLlamaTags('v0.7.0', 'v0.8.0')).toBe(0);
  });

  it('classifies an install against the pinned build', () => {
    expect(classifyInstalled('b11669', 'b11669')).toBe('current');
    expect(classifyInstalled('b11429', 'b11669')).toBe('update-available');
    expect(classifyInstalled('b12110', 'b11669')).toBe('newer');
    // Pre-versioning installs and hand-copied builds have no provenance.
    expect(classifyInstalled(null, 'b11669')).toBe('unknown');
    expect(classifyInstalled('', 'b11669')).toBe('unknown');
    expect(classifyInstalled('self-built', 'b11669')).toBe('unknown');
  });

  it('round-trips the marker written next to a backend', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-marker-'));
    const dir = path.join(root, 'win-cuda-13.4-x64');
    writeBackendMarker(dir, {
      id: 'win-cuda-13.4-x64',
      label: 'NVIDIA CUDA 13.4 (x64)',
      llamaVersion: PINNED,
      synapseVersion: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(fs.existsSync(path.join(dir, BACKEND_MARKER_FILE))).toBe(true);
    expect(readBackendMarker(dir)).toMatchObject({
      id: 'win-cuda-13.4-x64',
      llamaVersion: PINNED,
      installedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('treats a missing or corrupt marker as no provenance', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-marker-'));
    expect(readBackendMarker(path.join(root, 'never-created'))).toBeNull();

    const dir = path.join(root, 'win-vulkan-x64');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, BACKEND_MARKER_FILE), '{ not json');
    expect(readBackendMarker(dir)).toBeNull();

    fs.writeFileSync(path.join(dir, BACKEND_MARKER_FILE), '{"id":"x"}');
    expect(readBackendMarker(dir)).toBeNull();
  });
});

describe('installed backend inventory', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-backends-'));
    mockSaved = [];
    mockSettings = {
      modelsDirectory: root,
      backendDirectory: root,
      customBinaryPaths: [],
      backendDownloads: [],
      selectedBackend: 'Default',
    };
  });

  it('reads installs from disk and records them', () => {
    makeBackend(root, 'win-cuda-13.4-x64', {
      fitParams: true,
      split: true,
      marker: { llamaVersion: PINNED, label: 'NVIDIA CUDA 13.4 (x64)' },
    });

    const result = getInstalledBackends();
    expect(result.pinnedLlamaVersion).toBe(PINNED);
    expect(result.backends).toHaveLength(1);

    const [cuda] = result.backends;
    expect(cuda).toMatchObject({
      folder: 'win-cuda-13.4-x64',
      label: 'NVIDIA CUDA 13.4 (x64)',
      llamaVersion: PINNED,
      updateState: 'current',
      hasServer: true,
      hasFitParams: true,
      hasSplit: true,
      synapseInstalled: true,
      exists: true,
      tracked: false,
    });

    // The next read sees the healed record, so the settings cache catches up.
    expect(mockSettings.backendDownloads).toEqual([
      expect.objectContaining({
        folder: 'win-cuda-13.4-x64',
        version: PINNED,
      }),
    ]);
    expect(getInstalledBackends().backends[0].tracked).toBe(true);
  });

  it('lists an unversioned install as unknown instead of current', () => {
    makeBackend(root, 'win-vulkan-x64');

    const [vulkan] = getInstalledBackends().backends;
    expect(vulkan.llamaVersion).toBeNull();
    expect(vulkan.updateState).toBe('unknown');
    expect(vulkan.synapseInstalled).toBe(false);
    expect(vulkan.label).toBeTruthy();
  });

  it('reports an older build as updatable', () => {
    makeBackend(root, 'win-cuda-12.4-x64', {
      marker: { llamaVersion: 'b11429' },
    });

    const [older] = getInstalledBackends().backends;
    expect(older.updateState).toBe('update-available');
    expect(older.llamaVersion).toBe('b11429');
  });

  it('keeps a stale record visible and drops it after reconciling', () => {
    mockSettings.backendDownloads = [
      {
        id: 'win-openvino-x64',
        label: 'OpenVINO (x64)',
        folder: 'win-openvino-x64',
        version: PINNED,
      },
    ];
    mockSettings.selectedBackend = 'win-openvino-x64';

    const result = getInstalledBackends();
    const [orphan] = result.backends;
    // A folder that is gone has to be listed, otherwise the record can never be
    // cleared from the UI.
    expect(orphan).toMatchObject({
      folder: 'win-openvino-x64',
      exists: false,
      hasServer: false,
      tracked: true,
    });

    expect(mockSettings.backendDownloads).toHaveLength(0);
    // And it must stop steering backend resolution.
    expect(mockSettings.selectedBackend).toBe('Default');
    expect(getInstalledBackends().backends).toHaveLength(0);
  });

  it('keeps a partial install removable', () => {
    fs.mkdirSync(path.join(root, 'win-cpu-x64'), { recursive: true });
    mockSettings.backendDownloads = [
      {
        id: 'win-cpu-x64',
        label: 'CPU (x64)',
        folder: 'win-cpu-x64',
        version: PINNED,
      },
    ];

    const [partial] = getInstalledBackends().backends;
    expect(partial).toMatchObject({
      exists: true,
      hasServer: false,
      tracked: true,
    });
    // Only a missing folder is dead; an interrupted download stays recorded so
    // the user can see it and clear it.
    expect(mockSettings.backendDownloads).toHaveLength(1);
  });

  it('lets the folder marker override the cached record version', () => {
    makeBackend(root, 'win-cuda-13.4-x64', {
      marker: { llamaVersion: 'b11960' },
    });
    mockSettings.backendDownloads = [
      {
        id: 'win-cuda-13.4-x64',
        label: 'NVIDIA CUDA 13.4 (x64)',
        folder: 'win-cuda-13.4-x64',
        version: 'b11429',
      },
    ];

    const [cuda] = getInstalledBackends().backends;
    expect(cuda.llamaVersion).toBe('b11960');
    expect(mockSettings.backendDownloads[0].version).toBe('b11960');
  });

  it('ignores folders that are not backends', () => {
    fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
    fs.mkdirSync(path.join(root, '.partial'), { recursive: true });

    expect(getInstalledBackends().backends).toHaveLength(0);
  });

  it('marks the selected backend as in use', () => {
    makeBackend(root, 'win-cuda-13.4-x64', {
      marker: { llamaVersion: PINNED, id: 'win-cuda-13.4-x64' },
    });
    mockSettings.selectedBackend = 'win-cuda-13.4-x64';

    const [cuda] = getInstalledBackends().backends;
    expect(cuda.selected).toBe(true);
  });

  it('leaves an offered target alone', () => {
    makeBackend(root, 'win-cuda-13.5-x64', {
      marker: { llamaVersion: PINNED },
    });

    const [cuda] = getInstalledBackends().backends;
    expect(cuda.updateState).toBe('current');
  });
});

describe('backend uninstall', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-uninstall-'));
    mockSaved = [];
    mockSettings = {
      modelsDirectory: root,
      backendDirectory: root,
      customBinaryPaths: [],
      backendDownloads: [],
      selectedBackend: 'Default',
    };
  });

  it('deletes the folder, prunes the record and releases the selection', () => {
    makeBackend(root, 'win-cuda-13.4-x64', {
      marker: { llamaVersion: PINNED },
    });
    mockSettings.backendDownloads = [
      {
        id: 'win-cuda-13.4-x64',
        label: 'NVIDIA CUDA 13.4 (x64)',
        folder: 'win-cuda-13.4-x64',
        version: PINNED,
      },
    ];
    mockSettings.selectedBackend = 'win-cuda-13.4-x64';

    const result = uninstallInstalledBackend('win-cuda-13.4-x64', root);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'win-cuda-13.4-x64'))).toBe(false);
    expect(mockSettings.backendDownloads).toHaveLength(0);
    expect(mockSettings.selectedBackend).toBe('Default');
    expect(getInstalledBackends().backends).toHaveLength(0);
  });

  it('removes a leftover this build never recorded', () => {
    // The reported bug: a backend on disk that settings.backendDownloads knows
    // nothing about. It is listed, and uninstalling it has to work.
    makeBackend(root, 'win-cuda-12.4-x64', {
      marker: { llamaVersion: 'b11429' },
    });

    expect(getInstalledBackends().backends).toHaveLength(1);
    const result = uninstallInstalledBackend('win-cuda-12.4-x64', root);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'win-cuda-12.4-x64'))).toBe(false);
  });

  it('clears a record whose folder is already gone', () => {
    mockSettings.backendDownloads = [
      {
        id: 'win-vulkan-x64',
        label: 'Vulkan (x64)',
        folder: 'win-vulkan-x64',
        version: PINNED,
      },
    ];

    const result = uninstallInstalledBackend('win-vulkan-x64', root);
    expect(result.success).toBe(true);
    expect(mockSettings.backendDownloads).toHaveLength(0);
  });

  it('refuses folder names that point outside the backend directory', () => {
    ['..', '../elsewhere', 'nested/backend', 'nested\\backend', ''].forEach(
      (folder) => {
        const result = uninstallInstalledBackend(folder, root);
        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid folder name');
      },
    );
  });
});

describe('resolving the Default backend', () => {
  // 'Default' means Synapse chooses, and the choice follows the accelerator
  // preference (CUDA, then OpenCL/Adreno, then Vulkan) rather than the order the
  // installs happen to be recorded in.
  let root: string;

  function settingsWith(selectedBackend: string, ...folders: string[]): any {
    return {
      modelsDirectory: root,
      backendDirectory: root,
      customBinaryPaths: [],
      selectedBackend,
      backendDownloads: folders.map((folder) => ({
        id: folder,
        label: folder,
        folder,
        version: PINNED,
      })),
    };
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-resolve-'));
  });

  it('prefers CUDA over Vulkan regardless of record order', async () => {
    makeBackend(root, 'win-vulkan-x64');
    makeBackend(root, 'win-cuda-13.5-x64');

    const resolved = await resolveBackend(
      settingsWith('Default', 'win-vulkan-x64', 'win-cuda-13.5-x64'),
    );
    expect(resolved.backendFolder).toBe('win-cuda-13.5-x64');
  });

  it('honours an explicit selection', async () => {
    makeBackend(root, 'win-vulkan-x64');
    makeBackend(root, 'win-cuda-13.5-x64');

    const resolved = await resolveBackend(
      settingsWith('win-vulkan-x64', 'win-vulkan-x64', 'win-cuda-13.5-x64'),
    );
    expect(resolved.backendFolder).toBe('win-vulkan-x64');
  });

  it('keeps the server, fit and split binaries on one folder', async () => {
    makeBackend(root, 'win-vulkan-x64', { fitParams: true, split: true });
    makeBackend(root, 'win-cuda-13.5-x64', { fitParams: true, split: true });
    const settings = settingsWith(
      'Default',
      'win-vulkan-x64',
      'win-cuda-13.5-x64',
    );

    expect((await resolveFitBinary(settings)).backendFolder).toBe(
      'win-cuda-13.5-x64',
    );
    expect((await resolveSplitBinary(settings)).backendFolder).toBe(
      'win-cuda-13.5-x64',
    );
  });
});

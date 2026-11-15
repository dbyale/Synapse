import fs from 'fs';
import path from 'path';

import {
  getOfferedAssets,
  getOfferedTargets,
  isOfferedTarget,
} from '../main/backendInfo';
import { getLlamaVersion } from '../main/backendVersions';

// llama.cpp renames release targets when it bumps a toolkit (CUDA 13.4 -> 13.5
// at v1.0.0) and Synapse's target list is hardcoded, so both directions of
// drift are possible: Synapse offering a target whose archive is gone (a user's
// download 404s, and their installed folder can no longer be updated), or the
// list lagging behind a rename it should have followed.
//
// The ground truth is a snapshot of the pinned nightly's published assets,
// checked in as fixtures/llama-assets.<pin>.json and regenerated with
//   npx ts-node .erb/scripts/llama-assets.ts
// The snapshot is named after the pin on purpose: bumping binaryVersions.llama
// without regenerating it fails here, which is the point.
// No electron app paths are needed, but backendInfo imports settings/store code
// that does, so the module still needs the usual app mock.
jest.mock('electron', () => {
  const osm = require('os');
  const fsp = require('fs');
  const pth = require('path');
  const dir = fsp.mkdtempSync(pth.join(osm.tmpdir(), 'synapse-assets-app-'));
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

interface AssetSnapshot {
  tag: string;
  assets: string[];
}

const PIN = getLlamaVersion();

function loadSnapshot(): AssetSnapshot {
  const file = path.join(__dirname, 'fixtures', `llama-assets.${PIN}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No asset snapshot for llama.cpp ${PIN}. Regenerate it after changing ` +
        `package.json binaryVersions.llama: npx ts-node .erb/scripts/llama-assets.ts`,
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as AssetSnapshot;
}

const snapshot = loadSnapshot();
const published = new Set(snapshot.assets);

describe(`llama.cpp ${PIN} asset snapshot`, () => {
  it('describes the pinned nightly', () => {
    expect(snapshot.tag).toBe(PIN);
    expect(snapshot.assets.length).toBeGreaterThan(0);
    // A semver tag carries no binaries; a snapshot full of nightly-tag.txt means
    // the wrong release was captured.
    expect(snapshot.assets.some((name) => name.startsWith('llama-'))).toBe(
      true,
    );
  });

  it('contains every archive Synapse builds a URL for', () => {
    // The check that matters: each offered target resolves to an asset that the
    // pinned release really publishes. win-cuda-13.4-x64 is exactly what this
    // test would have caught before a single user hit a 404.
    const missing = getOfferedAssets().filter((name) => !published.has(name));
    expect(missing).toEqual([]);
  });

  it('is what the dev asset script downloads', () => {
    // .erb/scripts/setup-binaries.ts keeps a second, hand-maintained copy of the
    // target list for assets/bin. It drifts (it once unpacked the Adreno bundle
    // into a folder named win-adreno-arm64), so its asset names and folders have
    // to agree with the picker's targets.
    const script = fs.readFileSync(
      path.join(__dirname, '../../.erb/scripts/setup-binaries.ts'),
      'utf8',
    );
    const targets = new Set<string>();
    const bundle =
      /`llama-\$\{LLAMA_VERSION\}-bin-([a-z0-9.-]+)\.(?:zip|tar\.gz)`/g;
    const runtime = /`cudart-llama-bin-([a-z0-9.-]+)\.zip`/g;
    [...script.matchAll(bundle), ...script.matchAll(runtime)].forEach((m) =>
      targets.add(m[1]),
    );

    expect(targets.size).toBeGreaterThan(0);
    const unknown = [...targets].filter((target) => !isOfferedTarget(target));
    expect(unknown).toEqual([]);
  });
});

describe('offered targets cover the release families Synapse ships', () => {
  it('still ships every target its own list claims', () => {
    // Every offered target must appear in the pinned release as a bundle. Same
    // fact as above, stated per target so a failure names the folder that needs
    // renaming rather than a filename.
    const bundles = new Map<string, string>();
    snapshot.assets.forEach((name) => {
      const m = name.match(/^llama-.+-bin-(.+)\.(?:zip|tar\.gz)$/);
      if (m) bundles.set(m[1], name);
    });

    const gone = getOfferedTargets().filter((target) => !bundles.has(target));
    expect(gone).toEqual([]);
  });
});

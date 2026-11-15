/* eslint-disable import/prefer-default-export */
import pkg from '../../package.json';

// Single source of truth for pinned binary versions. This module is imported
// by the webpack configs (compiled into the main bundle via DefinePlugin) and
// by .erb/scripts/setup-binaries.ts, so the runtime download URLs and the
// bundled assets can never resolve to different llama.cpp releases.
const llama = pkg.binaryVersions?.llama;

if (!llama) {
  throw new Error('package.json is missing binaryVersions.llama');
}

export const LLAMA_VERSION: string = llama;

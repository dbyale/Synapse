import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { ExtensionToolDef } from '../types';
import { runPython, ensurePackage } from '../../main/functions/pythonRunner';
import manifest from './manifest.json';

const SETTINGS_FILE = path.join(
  app.getPath('userData'),
  'extension-settings',
  'ddg_search.json',
);

export interface DDGSSettings {
  defaultRegion: string;
  defaultSafesearch: string;
  defaultTimelimit: string;
  defaultMaxResults: number;
  defaultBackend: string;
  proxy: string;
  timeout: number;
  verify: boolean;
  extractFormat: string;
  maxFetchLength: number;
  blockedDomains: string[];
  allowedDomains: string[];
  imageSize: string;
  imageColor: string;
  imageType: string;
  imageLayout: string;
  imageLicense: string;
  videoResolution: string;
  videoDuration: string;
  videoLicense: string;
}

export const DDGS_DEFAULTS: DDGSSettings = {
  defaultRegion: 'us-en',
  defaultSafesearch: 'moderate',
  defaultTimelimit: '',
  defaultMaxResults: 10,
  defaultBackend: 'auto',
  proxy: '',
  timeout: 10,
  verify: true,
  extractFormat: 'text_markdown',
  maxFetchLength: 5000,
  blockedDomains: [],
  allowedDomains: [],
  imageSize: '',
  imageColor: '',
  imageType: '',
  imageLayout: '',
  imageLicense: '',
  videoResolution: '',
  videoDuration: '',
  videoLicense: '',
};

function loadSettings(): DDGSSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...DDGS_DEFAULTS,
        ...parsed,
        blockedDomains: Array.isArray(parsed.blockedDomains)
          ? parsed.blockedDomains
          : [...DDGS_DEFAULTS.blockedDomains],
        allowedDomains: Array.isArray(parsed.allowedDomains)
          ? parsed.allowedDomains
          : [...DDGS_DEFAULTS.allowedDomains],
        defaultMaxResults:
          typeof parsed.defaultMaxResults === 'number'
            ? Math.min(Math.max(Math.round(parsed.defaultMaxResults), 1), 50)
            : DDGS_DEFAULTS.defaultMaxResults,
        maxFetchLength:
          typeof parsed.maxFetchLength === 'number'
            ? Math.min(Math.max(Math.round(parsed.maxFetchLength), 500), 50000)
            : DDGS_DEFAULTS.maxFetchLength,
        timeout:
          typeof parsed.timeout === 'number'
            ? Math.min(Math.max(Math.round(parsed.timeout), 1), 120)
            : DDGS_DEFAULTS.timeout,
        verify:
          typeof parsed.verify === 'boolean'
            ? parsed.verify
            : DDGS_DEFAULTS.verify,
      };
    }
  } catch {
    // invalid file
  }
  return {
    ...DDGS_DEFAULTS,
    blockedDomains: [...DDGS_DEFAULTS.blockedDomains],
    allowedDomains: [...DDGS_DEFAULTS.allowedDomains],
  };
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

// Session-scoped store for image search display IDs.
let displayIdCounter = 0;
const displayImageStore = new Map<string, string>();

function nextDisplayId(imageUrl: string): string {
  const id = `display_img_${displayIdCounter++}`;
  displayImageStore.set(id, imageUrl);
  return id;
}

let ddgsReady = false;
let ddgsCheckInProgress: Promise<boolean> | null = null;

async function ensureDdgsPackage(): Promise<string | null> {
  if (ddgsReady) return null;
  if (ddgsCheckInProgress) {
    const result = await ddgsCheckInProgress;
    return result ? null : 'Package installation failed';
  }
  ddgsCheckInProgress = (async () => {
    const result = await ensurePackage('ddgs');
    if (result.success) {
      ddgsReady = true;
      return true;
    }
    return false;
  })();
  const ok = await ddgsCheckInProgress;
  return ok ? null : 'Package installation failed';
}

function escapePyString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function getDDGSConstructor(settings: DDGSSettings): string {
  const args: string[] = [];
  const proxy = settings.proxy?.trim();
  if (proxy) args.push(`proxy='${escapePyString(proxy)}'`);
  const timeout = settings.timeout ?? DDGS_DEFAULTS.timeout;
  args.push(`timeout=${Math.min(Math.max(Math.round(timeout), 1), 120)}`);
  const verify = settings.verify ?? DDGS_DEFAULTS.verify;
  args.push(`verify=${verify ? 'True' : 'False'}`);
  return args.length > 0 ? `DDGS(${args.join(', ')})` : 'DDGS()';
}

function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  let d = domain.toLowerCase().trim();
  d = d
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0];
  if (!d) return false;
  return h === d || h.endsWith(`.${d}`);
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isUrlAllowed(url: string, settings: DDGSSettings): boolean {
  const host = extractHost(url);
  if (!host) return true;
  const allowed = settings.allowedDomains ?? [];
  const blocked = settings.blockedDomains ?? [];
  if (allowed.length > 0) {
    const ok = allowed.some((d) => hostMatchesDomain(host, d));
    if (!ok) return false;
  }
  if (blocked.length > 0) {
    const isBlocked = blocked.some((d) => hostMatchesDomain(host, d));
    if (isBlocked) return false;
  }
  return true;
}

function filterResultsByDomain(
  results: unknown[],
  settings: DDGSSettings,
): unknown[] {
  if (
    (settings.blockedDomains?.length ?? 0) === 0 &&
    (settings.allowedDomains?.length ?? 0) === 0
  )
    return results;
  return results.filter((item) => {
    const rec = item as Record<string, unknown>;
    const candidate =
      rec.href || rec.url || rec.image || rec.thumbnail || rec.content;
    if (!candidate) return true;
    return isUrlAllowed(String(candidate), settings);
  });
}

interface SearchResult {
  success: boolean;
  results: unknown[];
  error?: string;
  total?: number;
}

function buildSearchRunner(
  ddgsConstructor: string,
  ddgsMethod: string,
  positionalArgs: string[],
  keywordArgs: Record<string, string>,
): string {
  const argsList: string[] = [];
  for (const arg of positionalArgs) {
    argsList.push(arg);
  }
  for (const [key, val] of Object.entries(keywordArgs)) {
    argsList.push(`${key}=${val}`);
  }
  const call = `ddgs.${ddgsMethod}(${argsList.join(', ')})`;

  return `from ddgs import DDGS
import json
try:
    results = []
    with ${ddgsConstructor} as ddgs:
        for r in ${call}:
            results.append(r)
    print(json.dumps({"success": True, "results": results, "total": len(results)}, default=str, ensure_ascii=False))
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Missing Python package: {e}. Run: pip install ddgs"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;
}

function buildExtractRunner(
  ddgsConstructor: string,
  quotedUrl: string,
  quotedFmt: string,
): string {
  return `from ddgs import DDGS
import json
try:
    with ${ddgsConstructor} as ddgs:
        result = ddgs.extract(${quotedUrl}, fmt=${quotedFmt})
    print(json.dumps(result, default=str, ensure_ascii=False))
except ImportError as e:
    print(json.dumps({"error": f"Missing Python package: {e}. Run: pip install ddgs"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
}

async function runSearch(
  ddgsMethod: string,
  keywordArgs: Record<string, string>,
): Promise<SearchResult> {
  const settings = loadSettings();
  const pkgErr = await ensureDdgsPackage();
  if (pkgErr) {
    return { success: false, results: [], error: pkgErr };
  }
  const ddgsConstructor = getDDGSConstructor(settings);
  const positionalArgs: string[] = [];
  const code = buildSearchRunner(
    ddgsConstructor,
    ddgsMethod,
    positionalArgs,
    keywordArgs,
  );
  const result = await runPython(code);
  if (!result.success) {
    return {
      success: false,
      results: [],
      error: result.error || result.stderr || 'Unknown error',
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as SearchResult;
    if (parsed.success && Array.isArray(parsed.results)) {
      const filtered = filterResultsByDomain(parsed.results, settings);
      return {
        ...parsed,
        results: filtered,
        total: filtered.length,
      };
    }
    return parsed;
  } catch {
    return {
      success: false,
      results: [],
      error: `Failed to parse search results: ${result.stdout.slice(0, 500)}`,
    };
  }
}

interface ExtractResult {
  url?: string;
  content?: string;
  error?: string;
}

async function runExtract(url: string, fmt?: string): Promise<ExtractResult> {
  const settings = loadSettings();
  const pkgErr = await ensureDdgsPackage();
  if (pkgErr) {
    return { error: pkgErr };
  }
  const effectiveFmt =
    fmt ?? settings.extractFormat ?? DDGS_DEFAULTS.extractFormat;
  const quotedUrl = `'${escapePyString(url)}'`;
  const quotedFmt = `'${escapePyString(effectiveFmt)}'`;
  const ddgsConstructor = getDDGSConstructor(settings);
  const code = buildExtractRunner(ddgsConstructor, quotedUrl, quotedFmt);
  const result = await runPython(code);
  if (!result.success) {
    return { error: result.error || result.stderr || 'Unknown error' };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed.error) return { error: parsed.error };
    return { url: parsed.url, content: parsed.content };
  } catch {
    return {
      error: `Failed to parse extract result: ${result.stdout.slice(0, 500)}`,
    };
  }
}

function siteNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

function buildSourcesFromResults(
  results: unknown[],
): { title: string; url: string }[] {
  return results
    .map((item) => {
      const record = item as Record<string, unknown>;
      const url = record.href || record.url || record.image;
      const title =
        record.title || record.content || record.name || url || 'Untitled';
      return { title: String(title), url: url ? String(url) : '' };
    })
    .filter((s) => s.url.length > 0);
}

function searchResultWithSources(raw: SearchResult): {
  _response: SearchResult;
  _sources: { title: string; url: string }[];
} {
  return {
    _response: raw,
    _sources:
      raw.success && Array.isArray(raw.results)
        ? buildSourcesFromResults(raw.results)
        : [],
  };
}

export const tools: Record<string, ExtensionToolDef> = {
  search_web: {
    meta: {
      name: 'search_web',
      label: 'Web Search',
      description:
        'Search the web using DDGS (Dux Distributed Global Search). Returns title, URL, and snippet for each result.',
      descriptionForModel:
        'Search the web for any topic using DDGS metasearch. Returns a list of results with title, URL, and a brief snippet.\n' +
        'Use this for general-purpose lookups, research, fact-checking, and finding online resources.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional, default from settings) — how many results to return (max 50)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru", "de-de" (default from settings)\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default from settings)\n' +
        '  timelimit (optional) — "d" (past day), "w" (past week), "m" (past month), "y" (past year) (default from settings)',
      icon: 'Search',
      tags: ['sources', 'web_search'],
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        max_results: {
          type: 'integer',
          description:
            'Maximum number of results to return (default: from settings, max: 50).',
        },
        region: {
          type: 'string',
          description:
            'Region code (e.g. us-en, uk-en, ru-ru, de-de). Default: from settings.',
        },
        safesearch: {
          type: 'string',
          description:
            'SafeSearch filter: on, moderate, off. Default: from settings.',
        },
        timelimit: {
          type: 'string',
          description:
            'Time limit: d (day), w (week), m (month), y (year). Optional, default from settings if set.',
        },
      },
      required: ['query'],
    },
    async handler(params: {
      query: string;
      max_results?: number;
      region?: string;
      safesearch?: string;
      timelimit?: string;
    }) {
      const s = loadSettings();
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(
          Math.min(params.max_results ?? s.defaultMaxResults, 50),
        ),
        region: `'${escapePyString(params.region ?? s.defaultRegion)}'`,
        safesearch: `'${escapePyString(params.safesearch ?? s.defaultSafesearch)}'`,
        backend: `'${escapePyString(s.defaultBackend || 'auto')}'`,
      };
      const effectiveTimelimit = params.timelimit ?? s.defaultTimelimit;
      if (effectiveTimelimit)
        keywordArgs.timelimit = `'${escapePyString(effectiveTimelimit)}'`;
      return searchResultWithSources(await runSearch('text', keywordArgs));
    },
  },

  search_news: {
    meta: {
      name: 'search_news',
      label: 'News Search',
      description:
        'Search news articles using DDGS (Dux Distributed Global Search). Returns title, URL, snippet, date, and source.',
      descriptionForModel:
        'Search recent news articles using DDGS metasearch. Returns results with title, URL, snippet, publication date, and source.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional) — how many results to return (max 50) (default from settings)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru" (default from settings)\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default from settings)\n' +
        '  timelimit (optional) — "d" (past day), "w" (past week), "m" (past month) (default from settings)',
      icon: 'Newspaper',
      tags: ['sources', 'web_search'],
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The news search query.' },
        max_results: {
          type: 'integer',
          description:
            'Maximum number of results (default: from settings, max: 50).',
        },
        region: {
          type: 'string',
          description:
            'Region code (e.g. us-en, uk-en, ru-ru). Default: from settings.',
        },
        safesearch: {
          type: 'string',
          description:
            'SafeSearch filter: on, moderate, off. Default: from settings.',
        },
        timelimit: {
          type: 'string',
          description: 'Time limit: d (day), w (week), m (month). Optional.',
        },
      },
      required: ['query'],
    },
    async handler(params: {
      query: string;
      max_results?: number;
      region?: string;
      safesearch?: string;
      timelimit?: string;
    }) {
      const s = loadSettings();
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(
          Math.min(params.max_results ?? s.defaultMaxResults, 50),
        ),
        region: `'${escapePyString(params.region ?? s.defaultRegion)}'`,
        safesearch: `'${escapePyString(params.safesearch ?? s.defaultSafesearch)}'`,
        backend: `'${escapePyString(s.defaultBackend || 'auto')}'`,
      };
      const effectiveTimelimit = params.timelimit ?? s.defaultTimelimit;
      if (effectiveTimelimit)
        keywordArgs.timelimit = `'${escapePyString(effectiveTimelimit)}'`;
      return searchResultWithSources(await runSearch('news', keywordArgs));
    },
  },

  search_images: {
    meta: {
      name: 'search_images',
      label: 'Image Search',
      description:
        'Search images using DDGS (Dux Distributed Global Search). Returns title, URL, thumbnail, and image dimensions.',
      descriptionForModel:
        'Search for images using DDGS metasearch. Returns results with title, image URL, thumbnail URL, width, height, source, and a display_id.\n' +
        'Use display_image_by_id with the returned display_id to view the image through the projector.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional) — how many results to return (max 50) (default from settings)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru" (default from settings)\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default from settings)\n' +
        '  size (optional) — filter: Small, Medium, Large, Wallpaper (default from settings)\n' +
        '  color (optional) — filter by color name or Monochrome (default from settings)\n' +
        '  type_image (optional) — filter: photo, clipart, gif, transparent, line (default from settings)\n' +
        '  layout (optional) — filter: Square, Tall, Wide (default from settings)\n' +
        '  license_image (optional) — filter: any (Creative Commons), Public, Share, ShareCommercially, Modify, ModifyCommercially (default from settings)',
      icon: 'Image',
      tags: ['sources', 'web_search'],
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The image search query.' },
        max_results: {
          type: 'integer',
          description:
            'Maximum number of results (default: from settings, max: 50).',
        },
        region: {
          type: 'string',
          description:
            'Region code (e.g. us-en, uk-en, ru-ru). Default: from settings.',
        },
        safesearch: {
          type: 'string',
          description:
            'SafeSearch filter: on, moderate, off. Default: from settings.',
        },
        size: {
          type: 'string',
          description: 'Image size filter: Small, Medium, Large, Wallpaper.',
        },
        color: {
          type: 'string',
          description: 'Color filter: Monochrome or a specific color name.',
        },
        type_image: {
          type: 'string',
          description: 'Type filter: photo, clipart, gif, transparent, line.',
        },
        layout: {
          type: 'string',
          description: 'Layout filter: Square, Tall, Wide.',
        },
        license_image: {
          type: 'string',
          description:
            'License filter: any, Public, Share, ShareCommercially, Modify, ModifyCommercially.',
        },
      },
      required: ['query'],
    },
    async handler(params: {
      query: string;
      max_results?: number;
      region?: string;
      safesearch?: string;
      size?: string;
      color?: string;
      type_image?: string;
      layout?: string;
      license_image?: string;
    }) {
      const s = loadSettings();
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(
          Math.min(params.max_results ?? s.defaultMaxResults, 50),
        ),
        region: `'${escapePyString(params.region ?? s.defaultRegion)}'`,
        safesearch: `'${escapePyString(params.safesearch ?? s.defaultSafesearch)}'`,
        backend: `'${escapePyString(s.defaultBackend || 'auto')}'`,
      };
      const effSize = params.size ?? s.imageSize;
      if (effSize) keywordArgs.size = `'${escapePyString(effSize)}'`;
      const effColor = params.color ?? s.imageColor;
      if (effColor) keywordArgs.color = `'${escapePyString(effColor)}'`;
      const effType = params.type_image ?? s.imageType;
      if (effType) keywordArgs.type_image = `'${escapePyString(effType)}'`;
      const effLayout = params.layout ?? s.imageLayout;
      if (effLayout) keywordArgs.layout = `'${escapePyString(effLayout)}'`;
      const effLicense = params.license_image ?? s.imageLicense;
      if (effLicense)
        keywordArgs.license_image = `'${escapePyString(effLicense)}'`;
      const effectiveTimelimit = s.defaultTimelimit;
      if (effectiveTimelimit)
        keywordArgs.timelimit = `'${escapePyString(effectiveTimelimit)}'`;
      const raw = await runSearch('images', keywordArgs);
      if (raw.success && Array.isArray(raw.results)) {
        for (const item of raw.results as Array<Record<string, unknown>>) {
          if (item.image) {
            (item as Record<string, unknown>).display_id = nextDisplayId(
              String(item.image),
            );
          }
        }
      }
      return searchResultWithSources(raw);
    },
  },

  search_videos: {
    meta: {
      name: 'search_videos',
      label: 'Video Search',
      description:
        'Search videos using DDGS (Dux Distributed Global Search). Returns title, URL, thumbnail, duration, and upload info.',
      descriptionForModel:
        'Search for videos using DDGS metasearch. Returns results with title, video URL, thumbnail URL, duration, publisher, and upload date.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional) — how many results to return (max 50) (default from settings)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru" (default from settings)\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default from settings)\n' +
        '  duration (optional) — filter: short, medium, long (default from settings)\n' +
        '  resolution (optional) — filter: high, standart (default from settings)\n' +
        '  license_videos (optional) — filter: creativeCommon, youtube (default from settings)\n' +
        '  timelimit (optional) — "d" (past day), "w" (past week), "m" (past month) (default from settings)',
      icon: 'Video',
      tags: ['sources', 'web_search'],
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The video search query.' },
        max_results: {
          type: 'integer',
          description:
            'Maximum number of results (default: from settings, max: 50).',
        },
        region: {
          type: 'string',
          description:
            'Region code (e.g. us-en, uk-en, ru-ru). Default: from settings.',
        },
        safesearch: {
          type: 'string',
          description:
            'SafeSearch filter: on, moderate, off. Default: from settings.',
        },
        duration: {
          type: 'string',
          description: 'Duration filter: short, medium, long.',
        },
        resolution: {
          type: 'string',
          description: 'Resolution filter: high, standart.',
        },
        license_videos: {
          type: 'string',
          description: 'License filter: creativeCommon, youtube.',
        },
        timelimit: {
          type: 'string',
          description: 'Time limit: d (day), w (week), m (month). Optional.',
        },
      },
      required: ['query'],
    },
    async handler(params: {
      query: string;
      max_results?: number;
      region?: string;
      safesearch?: string;
      duration?: string;
      resolution?: string;
      license_videos?: string;
      timelimit?: string;
    }) {
      const s = loadSettings();
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(
          Math.min(params.max_results ?? s.defaultMaxResults, 50),
        ),
        region: `'${escapePyString(params.region ?? s.defaultRegion)}'`,
        safesearch: `'${escapePyString(params.safesearch ?? s.defaultSafesearch)}'`,
        backend: `'${escapePyString(s.defaultBackend || 'auto')}'`,
      };
      const effDuration = params.duration ?? s.videoDuration;
      if (effDuration)
        keywordArgs.duration = `'${escapePyString(effDuration)}'`;
      const effResolution = params.resolution ?? s.videoResolution;
      if (effResolution)
        keywordArgs.resolution = `'${escapePyString(effResolution)}'`;
      const effLicense = params.license_videos ?? s.videoLicense;
      if (effLicense)
        keywordArgs.license_videos = `'${escapePyString(effLicense)}'`;
      const effectiveTimelimit = params.timelimit ?? s.defaultTimelimit;
      if (effectiveTimelimit)
        keywordArgs.timelimit = `'${escapePyString(effectiveTimelimit)}'`;
      return searchResultWithSources(await runSearch('videos', keywordArgs));
    },
  },

  search_books: {
    meta: {
      name: 'search_books',
      label: 'Book Search',
      description:
        "Search for books using DDGS (Dux Distributed Global Search) with Anna's Archive backend. Returns title, author, publisher, URL, and thumbnail.",
      descriptionForModel:
        "Search for books, authors, and literary topics using DDGS metasearch with the dedicated books backend (Anna's Archive).\n" +
        'Returns results with title, author, publisher, info, URL, and thumbnail.\n' +
        'Parameters:\n' +
        '  query (required) — book title, author, topic, or ISBN\n' +
        '  max_results (optional) — how many results to return (max 50) (default from settings)',
      icon: 'BookOpen',
      tags: ['sources', 'web_search'],
    },
    params: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Book title, author, topic, or ISBN to search for.',
        },
        max_results: {
          type: 'integer',
          description:
            'Maximum number of results (default: from settings, max: 50).',
        },
      },
      required: ['query'],
    },
    async handler(params: { query: string; max_results?: number }) {
      const s = loadSettings();
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(
          Math.min(params.max_results ?? s.defaultMaxResults, 50),
        ),
        backend: `'${escapePyString(s.defaultBackend || 'auto')}'`,
      };
      return searchResultWithSources(await runSearch('books', keywordArgs));
    },
  },

  web_fetch: {
    meta: {
      name: 'web_fetch',
      label: 'Web Fetch',
      description:
        'Fetch and extract the content of a webpage as markdown using DDGS.',
      descriptionForModel:
        'Fetch a URL and extract its content as clean markdown. Useful for reading articles, documentation, and web pages.\n' +
        'Parameters:\n' +
        '  url (required) — the URL to fetch\n' +
        '  max_length (optional) — maximum characters to return (default from settings)\n' +
        '  start_index (optional, default 0) — character offset to start from',
      icon: 'Globe',
      tags: ['sources', 'top_source'],
    },
    params: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch and extract content from.',
        },
        max_length: {
          type: 'integer',
          description:
            'Maximum number of characters to return (default: from settings).',
        },
        start_index: {
          type: 'integer',
          description: 'Start content from this character index (default: 0).',
          default: 0,
        },
      },
      required: ['url'],
    },
    async handler(params: {
      url: string;
      max_length?: number;
      start_index?: number;
    }) {
      const s = loadSettings();
      const effectiveMaxLength = params.max_length ?? s.maxFetchLength;
      const { url, start_index = 0 } = params;
      const max_length = effectiveMaxLength;
      if (!isUrlAllowed(url, s)) {
        return `Error: URL "${url}" is blocked by domain filter settings.`;
      }
      const result = await runExtract(url);
      if (result.error) {
        return `Error: ${result.error}`;
      }
      const content = result.content || '';
      const sliced = content.slice(start_index, start_index + max_length);
      return {
        _response: sliced || 'No content found at the specified index.',
        _top_sources: [{ title: siteNameFromUrl(url), url }],
      };
    },
  },
  display_web_image: {
    meta: {
      name: 'display_web_image',
      label: 'Display Web Image',
      description: 'Fetch and display an image from a URL inline in the chat.',
      descriptionForHuman:
        'Requires a vision model (with projector) for image processing.',
      descriptionForModel:
        'Fetches an image from a URL and displays it inline. The model can see the image through the projector.',
      icon: 'Image',
      displayType: 'projector',
      tags: ['sources', 'top_source'],
    },
    params: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the image to display (http or https).',
        },
        alt_text: {
          type: 'string',
          description: 'Optional descriptive text for the image.',
        },
      },
      required: ['url'],
    },
    async handler(params: { url: string; alt_text?: string }) {
      const { url } = params;
      const s = loadSettings();
      if (!isUrlAllowed(url, s)) {
        return {
          _response: `Error: URL "${url}" is blocked by domain filter settings.`,
        };
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return { _response: `Error Invalid URL: ${url}` };
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return {
          _response: `Error Unsupported protocol: ${parsedUrl.protocol}`,
        };
      }
      try {
        const response = await fetch(parsedUrl.toString(), {
          headers: { 'User-Agent': 'Synapse/1.0' },
        });
        if (!response.ok) {
          return {
            _response: `Error HTTP ${response.status}: ${response.statusText}`,
          };
        }
        const contentType = response.headers.get('content-type') ?? '';
        let mimeType: string | null = null;
        if (contentType.includes('image/')) {
          const match = contentType.match(/image\/[a-zA-Z+.-]+/);
          if (match) [mimeType] = match;
        }
        if (!mimeType) {
          const ext = parsedUrl.pathname.split('.').pop()?.toLowerCase();
          if (ext) mimeType = IMAGE_EXTENSIONS[`.${ext}`] ?? null;
        }
        if (!mimeType) mimeType = 'image/png';
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const imageUrl = bufferToDataUrl(buffer, mimeType);
        return {
          _response: `Displayed web image: ${url} (${mimeType})`,
          _image: { url: imageUrl, altText: params.alt_text || url },
          _top_sources: [{ title: `Image: ${siteNameFromUrl(url)}`, url }],
        };
      } catch (err) {
        return {
          _response: `Error Failed to fetch image: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
  display_image_by_id: {
    meta: {
      name: 'display_image_by_id',
      label: 'Display Image By ID',
      description:
        'Display an image from a previous image search using its display ID.',
      descriptionForHuman:
        'Requires a vision model (with projector) for image processing.',
      descriptionForModel:
        'Displays an image from a previous image search result by referencing its display_id. ' +
        'The model can see the image through the projector. Use this after search_images to view specific results.',
      icon: 'Image',
      displayType: 'projector',
      tags: ['sources', 'top_source'],
    },
    params: {
      type: 'object',
      properties: {
        display_id: {
          type: 'string',
          description: 'The display_id from a search_images result.',
        },
      },
      required: ['display_id'],
    },
    async handler(params: { display_id: string }) {
      const imageUrl = displayImageStore.get(params.display_id);
      if (!imageUrl) {
        return {
          _response: `Error Display ID not found: ${params.display_id}`,
        };
      }
      const s = loadSettings();
      if (!isUrlAllowed(imageUrl, s)) {
        return {
          _response: `Error: Image URL is blocked by domain filter settings.`,
        };
      }
      try {
        const response = await fetch(imageUrl, {
          headers: { 'User-Agent': 'Synapse/1.0' },
        });
        if (!response.ok) {
          return {
            _response: `Error HTTP ${response.status}: ${response.statusText}`,
          };
        }
        const contentType = response.headers.get('content-type') ?? '';
        let mimeType: string | null = null;
        if (contentType.includes('image/')) {
          const match = contentType.match(/image\/[a-zA-Z+.-]+/);
          if (match) [mimeType] = match;
        }
        if (!mimeType) {
          const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase();
          if (ext) mimeType = IMAGE_EXTENSIONS[`.${ext}`] ?? null;
        }
        if (!mimeType) mimeType = 'image/png';
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const dataUrl = bufferToDataUrl(buffer, mimeType);
        return {
          _response: `Displayed image: ${params.display_id} (${mimeType})`,
          _image: { url: dataUrl, altText: params.display_id },
          _top_sources: [
            { title: `Image: ${siteNameFromUrl(imageUrl)}`, url: imageUrl },
          ],
        };
      } catch (err) {
        return {
          _response: `Error Failed to fetch image: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
};

export { manifest };

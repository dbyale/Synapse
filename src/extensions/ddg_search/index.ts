import type { ExtensionToolDef } from '../types';
import { runPython, ensurePackage } from '../../main/functions/pythonRunner';
import manifest from './manifest.json';

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
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

interface SearchResult {
  success: boolean;
  results: unknown[];
  error?: string;
  total?: number;
}

function buildSearchRunner(
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
    with DDGS() as ddgs:
        for r in ${call}:
            results.append(r)
    print(json.dumps({"success": True, "results": results, "total": len(results)}, default=str, ensure_ascii=False))
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Missing Python package: {e}. Run: pip install ddgs"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;
}

async function runSearch(
  ddgsMethod: string,
  keywordArgs: Record<string, string>,
): Promise<SearchResult> {
  const pkgErr = await ensureDdgsPackage();
  if (pkgErr) {
    return { success: false, results: [], error: pkgErr };
  }
  const positionalArgs: string[] = [];
  const code = buildSearchRunner(ddgsMethod, positionalArgs, keywordArgs);
  const result = await runPython(code);
  if (!result.success) {
    return { success: false, results: [], error: result.error || result.stderr || 'Unknown error' };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed as SearchResult;
  } catch {
    return { success: false, results: [], error: `Failed to parse search results: ${result.stdout.slice(0, 500)}` };
  }
}

export const tools: Record<string, ExtensionToolDef> = {
  search_web: {
    meta: {
      name: 'search_web',
      label: 'Web Search',
      description: 'Search the web using DDGS (Dux Distributed Global Search). Returns title, URL, and snippet for each result.',
      descriptionForModel:
        'Search the web for any topic using DDGS metasearch. Returns a list of results with title, URL, and a brief snippet.\n' +
        'Use this for general-purpose lookups, research, fact-checking, and finding online resources.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional, default 10) — how many results to return (max 50)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru", "de-de"\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default "moderate")\n' +
        '  timelimit (optional) — "d" (past day), "w" (past week), "m" (past month), "y" (past year)',
      icon: 'Search',
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        max_results: { type: 'integer', description: 'Maximum number of results to return (default: 10, max: 50).', default: 10 },
        region: { type: 'string', description: 'Region code (e.g. us-en, uk-en, ru-ru, de-de). Default: us-en.', default: 'us-en' },
        safesearch: { type: 'string', description: 'SafeSearch filter: on, moderate, off. Default: moderate.', default: 'moderate' },
        timelimit: { type: 'string', description: 'Time limit: d (day), w (week), m (month), y (year). Optional.' },
      },
      required: ['query'],
    },
    async handler(params: { query: string; max_results?: number; region?: string; safesearch?: string; timelimit?: string }) {
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(Math.min(params.max_results ?? 10, 50)),
        region: `'${escapePyString(params.region ?? 'us-en')}'`,
        safesearch: `'${escapePyString(params.safesearch ?? 'moderate')}'`,
      };
      if (params.timelimit) keywordArgs.timelimit = `'${escapePyString(params.timelimit)}'`;
      return await runSearch('text', keywordArgs);
    },
  },

  search_news: {
    meta: {
      name: 'search_news',
      label: 'News Search',
      description: 'Search news articles using DDGS (Dux Distributed Global Search). Returns title, URL, snippet, date, and source.',
      descriptionForModel:
        'Search recent news articles using DDGS metasearch. Returns results with title, URL, snippet, publication date, and source.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional, default 10) — how many results to return (max 50)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru"\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default "moderate")\n' +
        '  timelimit (optional) — "d" (past day), "w" (past week), "m" (past month)',
      icon: 'Newspaper',
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The news search query.' },
        max_results: { type: 'integer', description: 'Maximum number of results (default: 10, max: 50).', default: 10 },
        region: { type: 'string', description: 'Region code (e.g. us-en, uk-en, ru-ru). Default: us-en.', default: 'us-en' },
        safesearch: { type: 'string', description: 'SafeSearch filter: on, moderate, off. Default: moderate.', default: 'moderate' },
        timelimit: { type: 'string', description: 'Time limit: d (day), w (week), m (month). Optional.' },
      },
      required: ['query'],
    },
    async handler(params: { query: string; max_results?: number; region?: string; safesearch?: string; timelimit?: string }) {
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(Math.min(params.max_results ?? 10, 50)),
        region: `'${escapePyString(params.region ?? 'us-en')}'`,
        safesearch: `'${escapePyString(params.safesearch ?? 'moderate')}'`,
      };
      if (params.timelimit) keywordArgs.timelimit = `'${escapePyString(params.timelimit)}'`;
      return await runSearch('news', keywordArgs);
    },
  },

  search_images: {
    meta: {
      name: 'search_images',
      label: 'Image Search',
      description: 'Search images using DDGS (Dux Distributed Global Search). Returns title, URL, thumbnail, and image dimensions.',
      descriptionForModel:
        'Search for images using DDGS metasearch. Returns results with title, image URL, thumbnail URL, width, height, and source.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional, default 10) — how many results to return (max 50)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru"\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default "moderate")\n' +
        '  size (optional) — filter: Small, Medium, Large, Wallpaper\n' +
        '  color (optional) — filter by color name or Monochrome\n' +
        '  type_image (optional) — filter: photo, clipart, gif, transparent, line\n' +
        '  layout (optional) — filter: Square, Tall, Wide\n' +
        '  license_image (optional) — filter: any (Creative Commons), Public, Share, ShareCommercially, Modify, ModifyCommercially',
      icon: 'Image',
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The image search query.' },
        max_results: { type: 'integer', description: 'Maximum number of results (default: 10, max: 50).', default: 10 },
        region: { type: 'string', description: 'Region code (e.g. us-en, uk-en, ru-ru). Default: us-en.', default: 'us-en' },
        safesearch: { type: 'string', description: 'SafeSearch filter: on, moderate, off. Default: moderate.', default: 'moderate' },
        size: { type: 'string', description: 'Image size filter: Small, Medium, Large, Wallpaper.' },
        color: { type: 'string', description: 'Color filter: Monochrome or a specific color name.' },
        type_image: { type: 'string', description: 'Type filter: photo, clipart, gif, transparent, line.' },
        layout: { type: 'string', description: 'Layout filter: Square, Tall, Wide.' },
        license_image: { type: 'string', description: 'License filter: any, Public, Share, ShareCommercially, Modify, ModifyCommercially.' },
      },
      required: ['query'],
    },
    async handler(params: { query: string; max_results?: number; region?: string; safesearch?: string; size?: string; color?: string; type_image?: string; layout?: string; license_image?: string }) {
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(Math.min(params.max_results ?? 10, 50)),
        region: `'${escapePyString(params.region ?? 'us-en')}'`,
        safesearch: `'${escapePyString(params.safesearch ?? 'moderate')}'`,
      };
      if (params.size) keywordArgs.size = `'${escapePyString(params.size)}'`;
      if (params.color) keywordArgs.color = `'${escapePyString(params.color)}'`;
      if (params.type_image) keywordArgs.type_image = `'${escapePyString(params.type_image)}'`;
      if (params.layout) keywordArgs.layout = `'${escapePyString(params.layout)}'`;
      if (params.license_image) keywordArgs.license_image = `'${escapePyString(params.license_image)}'`;
      return await runSearch('images', keywordArgs);
    },
  },

  search_videos: {
    meta: {
      name: 'search_videos',
      label: 'Video Search',
      description: 'Search videos using DDGS (Dux Distributed Global Search). Returns title, URL, thumbnail, duration, and upload info.',
      descriptionForModel:
        'Search for videos using DDGS metasearch. Returns results with title, video URL, thumbnail URL, duration, publisher, and upload date.\n' +
        'Parameters:\n' +
        '  query (required) — what to search for\n' +
        '  max_results (optional, default 10) — how many results to return (max 50)\n' +
        '  region (optional) — region code, e.g. "us-en", "uk-en", "ru-ru"\n' +
        '  safesearch (optional) — "on", "moderate", or "off" (default "moderate")\n' +
        '  duration (optional) — filter: short, medium, long\n' +
        '  resolution (optional) — filter: high, standart\n' +
        '  license_videos (optional) — filter: creativeCommon, youtube\n' +
        '  timelimit (optional) — "d" (past day), "w" (past week), "m" (past month)',
      icon: 'Video',
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The video search query.' },
        max_results: { type: 'integer', description: 'Maximum number of results (default: 10, max: 50).', default: 10 },
        region: { type: 'string', description: 'Region code (e.g. us-en, uk-en, ru-ru). Default: us-en.', default: 'us-en' },
        safesearch: { type: 'string', description: 'SafeSearch filter: on, moderate, off. Default: moderate.', default: 'moderate' },
        duration: { type: 'string', description: 'Duration filter: short, medium, long.' },
        resolution: { type: 'string', description: 'Resolution filter: high, standart.' },
        license_videos: { type: 'string', description: 'License filter: creativeCommon, youtube.' },
        timelimit: { type: 'string', description: 'Time limit: d (day), w (week), m (month). Optional.' },
      },
      required: ['query'],
    },
    async handler(params: { query: string; max_results?: number; region?: string; safesearch?: string; duration?: string; resolution?: string; license_videos?: string; timelimit?: string }) {
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(Math.min(params.max_results ?? 10, 50)),
        region: `'${escapePyString(params.region ?? 'us-en')}'`,
        safesearch: `'${escapePyString(params.safesearch ?? 'moderate')}'`,
      };
      if (params.duration) keywordArgs.duration = `'${escapePyString(params.duration)}'`;
      if (params.resolution) keywordArgs.resolution = `'${escapePyString(params.resolution)}'`;
      if (params.license_videos) keywordArgs.license_videos = `'${escapePyString(params.license_videos)}'`;
      if (params.timelimit) keywordArgs.timelimit = `'${escapePyString(params.timelimit)}'`;
      return await runSearch('videos', keywordArgs);
    },
  },

  search_books: {
    meta: {
      name: 'search_books',
      label: 'Book Search',
      description: 'Search for books using DDGS (Dux Distributed Global Search) with Anna\'s Archive backend. Returns title, author, publisher, URL, and thumbnail.',
      descriptionForModel:
        'Search for books, authors, and literary topics using DDGS metasearch with the dedicated books backend (Anna\'s Archive).\n' +
        'Returns results with title, author, publisher, info, URL, and thumbnail.\n' +
        'Parameters:\n' +
        '  query (required) — book title, author, topic, or ISBN\n' +
        '  max_results (optional, default 10) — how many results to return (max 50)',
      icon: 'BookOpen',
    },
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Book title, author, topic, or ISBN to search for.' },
        max_results: { type: 'integer', description: 'Maximum number of results (default: 10, max: 50).', default: 10 },
      },
      required: ['query'],
    },
    async handler(params: { query: string; max_results?: number }) {
      const keywordArgs: Record<string, string> = {
        query: `'${escapePyString(params.query)}'`,
        max_results: String(Math.min(params.max_results ?? 10, 50)),
      };
      return await runSearch('books', keywordArgs);
    },
  },
};

export { manifest };

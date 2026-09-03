import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import {
  Plus,
  Trash2,
  AlertCircle,
  Settings,
  Shield,
  SlidersHorizontal,
  Globe,
  Image as ImageIcon,
  Video,
} from 'lucide-react';
import './styles/DDGSearchSettings.css';

interface DDGSSettings {
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

const DEFAULTS: DDGSSettings = {
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

const REGIONS = [
  'us-en',
  'uk-en',
  'de-de',
  'fr-fr',
  'ru-ru',
  'es-es',
  'it-it',
  'ja-jp',
  'ko-kr',
  'zh-cn',
  'pt-br',
  'nl-nl',
  'pl-pl',
  'tr-tr',
  'ar-sa',
  'en-au',
  'en-ca',
  'de-at',
  'fr-ca',
  'sv-se',
  'nb-no',
  'da-dk',
  'fi-fi',
  'hu-hu',
  'cs-cz',
];

const SAFESEARCH_OPTIONS = ['on', 'moderate', 'off'] as const;
const TIMELIMIT_OPTIONS = [
  { value: '', label: 'None (any time)' },
  { value: 'd', label: 'Past day (d)' },
  { value: 'w', label: 'Past week (w)' },
  { value: 'm', label: 'Past month (m)' },
  { value: 'y', label: 'Past year (y)' },
];
const BACKENDS = [
  'auto',
  'bing',
  'brave',
  'duckduckgo',
  'google',
  'mojeek',
  'startpage',
  'yandex',
  'yahoo',
  'wikipedia',
];
const EXTRACT_FORMATS = [
  { value: 'text_markdown', label: 'Markdown (recommended)' },
  { value: 'text_plain', label: 'Plain text' },
  { value: 'text_rich', label: 'Rich text' },
  { value: 'text', label: 'Raw HTML' },
  { value: 'content', label: 'Raw bytes' },
];
const IMAGE_SIZE_OPTIONS = ['', 'Small', 'Medium', 'Large', 'Wallpaper'];
const IMAGE_COLOR_OPTIONS = [
  '',
  'Monochrome',
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple',
  'Pink',
  'Brown',
  'Black',
  'Gray',
  'Teal',
  'White',
];
const IMAGE_TYPE_OPTIONS = [
  '',
  'photo',
  'clipart',
  'gif',
  'transparent',
  'line',
];
const IMAGE_LAYOUT_OPTIONS = ['', 'Square', 'Tall', 'Wide'];
const IMAGE_LICENSE_OPTIONS = [
  '',
  'any',
  'Public',
  'Share',
  'ShareCommercially',
  'Modify',
  'ModifyCommercially',
];
const VIDEO_RESOLUTION_OPTIONS = ['', 'high', 'standart'];
const VIDEO_DURATION_OPTIONS = ['', 'short', 'medium', 'long'];
const VIDEO_LICENSE_OPTIONS = ['', 'creativeCommon', 'youtube'];

type Tab = 'general' | 'filtering' | 'advanced';

function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .trim();
  // strip port
  d = d.split(':')[0];
  return d;
}

export default function DDGSearchSettings() {
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<DDGSSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newBlocked, setNewBlocked] = useState('');
  const [newAllowed, setNewAllowed] = useState('');

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  async function load() {
    setLoading(true);
    try {
      const s = await window.electronAPI.extensionsGetSettings('ddg_search');
      setSettings({
        ...DEFAULTS,
        ...s,
        blockedDomains: Array.isArray(s.blockedDomains) ? s.blockedDomains : [],
        allowedDomains: Array.isArray(s.allowedDomains) ? s.allowedDomains : [],
      });
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    return () => {
      const s = settingsRef.current;
      window.electronAPI.extensionsSetSettings('ddg_search', s).catch(() => {});
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // clamp numeric
      const toSave: DDGSSettings = {
        ...settings,
        defaultMaxResults: Math.min(
          Math.max(Math.round(settings.defaultMaxResults), 1),
          50,
        ),
        maxFetchLength: Math.min(
          Math.max(Math.round(settings.maxFetchLength), 500),
          50000,
        ),
        timeout: Math.min(Math.max(Math.round(settings.timeout), 1), 120),
        blockedDomains: settings.blockedDomains
          .map(normalizeDomain)
          .filter(Boolean),
        allowedDomains: settings.allowedDomains
          .map(normalizeDomain)
          .filter(Boolean),
      };
      await window.electronAPI.extensionsSetSettings('ddg_search', toSave);
      setSettings(toSave);
      setMessage('Settings saved successfully');
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function handleAddBlocked() {
    const d = normalizeDomain(newBlocked);
    if (!d) return;
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) {
      setError('Invalid domain format');
      return;
    }
    if (
      settings.blockedDomains.some((x) => x.toLowerCase() === d.toLowerCase())
    ) {
      setNewBlocked('');
      return;
    }
    setSettings({
      ...settings,
      blockedDomains: [...settings.blockedDomains, d],
    });
    setNewBlocked('');
    setError(null);
  }
  function handleRemoveBlocked(domain: string) {
    setSettings({
      ...settings,
      blockedDomains: settings.blockedDomains.filter((d) => d !== domain),
    });
  }
  function handleBlockedKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddBlocked();
    }
  }

  function handleAddAllowed() {
    const d = normalizeDomain(newAllowed);
    if (!d) return;
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) {
      setError('Invalid domain format');
      return;
    }
    if (
      settings.allowedDomains.some((x) => x.toLowerCase() === d.toLowerCase())
    ) {
      setNewAllowed('');
      return;
    }
    setSettings({
      ...settings,
      allowedDomains: [...settings.allowedDomains, d],
    });
    setNewAllowed('');
    setError(null);
  }
  function handleRemoveAllowed(domain: string) {
    setSettings({
      ...settings,
      allowedDomains: settings.allowedDomains.filter((d) => d !== domain),
    });
  }
  function handleAllowedKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAllowed();
    }
  }

  if (loading) {
    return <div className="ddgs-loading">Loading settings...</div>;
  }

  return (
    <div className="ddgs">
      {error && (
        <div className="ddgs-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {message && <div className="ddgs-success">{message}</div>}

      <div className="ddgs-tabs">
        <button
          type="button"
          className={`ddgs-tab${tab === 'general' ? ' ddgs-tab--active' : ''}`}
          onClick={() => setTab('general')}
        >
          <Settings size={14} />
          General
        </button>
        <button
          type="button"
          className={`ddgs-tab${tab === 'filtering' ? ' ddgs-tab--active' : ''}`}
          onClick={() => setTab('filtering')}
        >
          <Shield size={14} />
          Filtering
        </button>
        <button
          type="button"
          className={`ddgs-tab${tab === 'advanced' ? ' ddgs-tab--active' : ''}`}
          onClick={() => setTab('advanced')}
        >
          <SlidersHorizontal size={14} />
          Advanced
        </button>
      </div>

      <div className="ddgs-body">
        {tab === 'general' && (
          <div className="ddgs-tab-content">
            <p className="ddgs-hint">
              Defaults are applied when the model does not specify a value.
              Per-call parameters always override these defaults. All defaults
              match DDGS library defaults (us-en, moderate, 10 results, auto
              backend) for maximum compatibility.
            </p>

            <div className="ddgs-grid2">
              <div className="ddgs-section">
                <label className="ddgs-label" htmlFor="ddgs-region">
                  Default region
                </label>
                <select
                  id="ddgs-region"
                  className="ddgs-input"
                  value={settings.defaultRegion}
                  onChange={(e) =>
                    setSettings({ ...settings, defaultRegion: e.target.value })
                  }
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <p className="ddgs-field-hint">
                  Language/region for web, news, images, videos.
                </p>
              </div>

              <div className="ddgs-section">
                <label className="ddgs-label" htmlFor="ddgs-safesearch">
                  SafeSearch
                </label>
                <select
                  id="ddgs-safesearch"
                  className="ddgs-input"
                  value={settings.defaultSafesearch}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      defaultSafesearch: e.target.value,
                    })
                  }
                >
                  {SAFESEARCH_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <p className="ddgs-field-hint">
                  moderate is DDGS default, friendly for general use.
                </p>
              </div>
            </div>

            <div className="ddgs-grid2">
              <div className="ddgs-section">
                <label className="ddgs-label" htmlFor="ddgs-timelimit">
                  Default timelimit
                </label>
                <select
                  id="ddgs-timelimit"
                  className="ddgs-input"
                  value={settings.defaultTimelimit}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      defaultTimelimit: e.target.value,
                    })
                  }
                >
                  {TIMELIMIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="ddgs-field-hint">
                  Empty = no limit (DDGS default).
                </p>
              </div>

              <div className="ddgs-section">
                <label className="ddgs-label" htmlFor="ddgs-maxresults">
                  Default max results
                </label>
                <input
                  id="ddgs-maxresults"
                  type="number"
                  className="ddgs-number-input"
                  value={settings.defaultMaxResults}
                  min={1}
                  max={50}
                  step={1}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      defaultMaxResults: Number(e.target.value),
                    })
                  }
                />
                <p className="ddgs-field-hint">
                  1–50. DDGS default 10. Higher uses more context.
                </p>
              </div>
            </div>

            <div className="ddgs-divider" />

            <div className="ddgs-section">
              <label className="ddgs-label" htmlFor="ddgs-extractfmt">
                <Globe
                  size={12}
                  style={{ display: 'inline', marginRight: 6 }}
                />
                Extract format (web_fetch)
              </label>
              <select
                id="ddgs-extractfmt"
                className="ddgs-input"
                value={settings.extractFormat}
                onChange={(e) =>
                  setSettings({ ...settings, extractFormat: e.target.value })
                }
              >
                {EXTRACT_FORMATS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="ddgs-field-hint">
                DDGS extract(fmt). Markdown preserves links/headers; plain
                strips markup.
              </p>
            </div>

            <div className="ddgs-section">
              <label className="ddgs-label" htmlFor="ddgs-maxfetch">
                Max fetch length (chars)
              </label>
              <input
                id="ddgs-maxfetch"
                type="number"
                className="ddgs-number-input"
                value={settings.maxFetchLength}
                min={500}
                max={50000}
                step={500}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxFetchLength: Number(e.target.value),
                  })
                }
              />
              <p className="ddgs-field-hint">
                Default max_length for web_fetch when model omits it. DDGS
                default 5000. Analogous to Filesystem maxReadSize.
              </p>
            </div>
          </div>
        )}

        {tab === 'filtering' && (
          <div className="ddgs-tab-content">
            <p className="ddgs-hint">
              Domain filters are applied after DDGS returns results and before
              they are shown to the model. Matching is case-insensitive and
              includes subdomains (e.g., example.com blocks sub.example.com).
            </p>

            <div className="ddgs-section">
              <label className="ddgs-label">Blocked domains</label>
              <p className="ddgs-hint">
                Results from these hosts are removed. Use to exclude low-quality
                or distracting sites.
              </p>
              <div className="ddgs-repo-input-row">
                <input
                  type="text"
                  className="ddgs-input ddgs-input--mono"
                  value={newBlocked}
                  onChange={(e) => setNewBlocked(e.target.value)}
                  onKeyDown={handleBlockedKeyDown}
                  placeholder="example.com"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleAddBlocked}
                  disabled={!newBlocked.trim()}
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
              <div className="ddgs-repo-list">
                {settings.blockedDomains.length === 0 ? (
                  <div className="ddgs-empty">
                    No blocked domains — all hosts allowed (unless allowlist is
                    set).
                  </div>
                ) : (
                  settings.blockedDomains.map((d) => (
                    <div key={d} className="ddgs-repo-row">
                      <span className="ddgs-repo-name">{d}</span>
                      <button
                        type="button"
                        className="ddgs-remove-btn"
                        onClick={() => handleRemoveBlocked(d)}
                        aria-label={`Remove ${d}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="ddgs-section">
              <label className="ddgs-label">Allowed domains (allowlist)</label>
              <p className="ddgs-hint">
                When non-empty, <em>only</em> these domains pass. Leave empty to
                allow all (except blocked).
              </p>
              <div className="ddgs-repo-input-row">
                <input
                  type="text"
                  className="ddgs-input ddgs-input--mono"
                  value={newAllowed}
                  onChange={(e) => setNewAllowed(e.target.value)}
                  onKeyDown={handleAllowedKeyDown}
                  placeholder="wikipedia.org"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleAddAllowed}
                  disabled={!newAllowed.trim()}
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
              <div className="ddgs-repo-list">
                {settings.allowedDomains.length === 0 ? (
                  <div className="ddgs-empty">
                    No restrictions — all domains allowed (except blocked).
                  </div>
                ) : (
                  settings.allowedDomains.map((d) => (
                    <div key={d} className="ddgs-repo-row">
                      <span className="ddgs-repo-name">{d}</span>
                      <button
                        type="button"
                        className="ddgs-remove-btn"
                        onClick={() => handleRemoveAllowed(d)}
                        aria-label={`Remove ${d}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="ddgs-section ddgs-callout">
              <AlertCircle size={12} />
              <span>
                web_fetch and image display are also blocked if the URL host is
                filtered.
              </span>
            </div>
          </div>
        )}

        {tab === 'advanced' && (
          <div className="ddgs-tab-content">
            <div className="ddgs-section">
              <label className="ddgs-label" htmlFor="ddgs-proxy">
                Proxy URL
              </label>
              <input
                id="ddgs-proxy"
                type="text"
                className="ddgs-input ddgs-input--mono"
                value={settings.proxy}
                onChange={(e) =>
                  setSettings({ ...settings, proxy: e.target.value })
                }
                placeholder="http://user:pass@host:3128 or socks5h://127.0.0.1:9150"
              />
              <p className="ddgs-field-hint">
                DDGS(proxy=...). Supports http/https/socks5. Leave empty for
                direct connection (DDGS default).
              </p>
            </div>

            <div className="ddgs-grid2">
              <div className="ddgs-section">
                <label className="ddgs-label" htmlFor="ddgs-timeout">
                  Timeout (seconds)
                </label>
                <input
                  id="ddgs-timeout"
                  type="number"
                  className="ddgs-number-input"
                  value={settings.timeout}
                  min={1}
                  max={120}
                  step={1}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      timeout: Number(e.target.value),
                    })
                  }
                />
                <p className="ddgs-field-hint">
                  DDGS default 5s; 10s is more reliable for slow networks.
                </p>
              </div>
              <div className="ddgs-section">
                <label
                  className="ddgs-label ddgs-checkbox-label"
                  htmlFor="ddgs-verify"
                >
                  <input
                    id="ddgs-verify"
                    type="checkbox"
                    checked={settings.verify}
                    onChange={(e) =>
                      setSettings({ ...settings, verify: e.target.checked })
                    }
                  />
                  Verify SSL
                </label>
                <p className="ddgs-field-hint">
                  DDGS(verify=True). Disable only for corporate MITM proxies.
                </p>
              </div>
            </div>

            <div className="ddgs-section">
              <label className="ddgs-label" htmlFor="ddgs-backend">
                Default backend
              </label>
              <select
                id="ddgs-backend"
                className="ddgs-input"
                value={settings.defaultBackend}
                onChange={(e) =>
                  setSettings({ ...settings, defaultBackend: e.target.value })
                }
              >
                {BACKENDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <p className="ddgs-field-hint">
                auto lets DDGS pick best (bing/brave/duckduckgo/google/...).
                Books uses annas-archive; pinned backend overrides auto for all
                search types.
              </p>
            </div>

            <div className="ddgs-divider" />

            <div className="ddgs-subheader">
              <ImageIcon size={14} />
              <span>Image search defaults</span>
              <span className="ddgs-subhint">
                Applied when model omits the filter; empty = no filter (DDGS
                default).
              </span>
            </div>

            <div className="ddgs-grid2">
              <div className="ddgs-section">
                <label className="ddgs-label">Size</label>
                <select
                  className="ddgs-input"
                  value={settings.imageSize}
                  onChange={(e) =>
                    setSettings({ ...settings, imageSize: e.target.value })
                  }
                >
                  {IMAGE_SIZE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === '' ? 'None (any)' : o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ddgs-section">
                <label className="ddgs-label">Color</label>
                <select
                  className="ddgs-input"
                  value={settings.imageColor}
                  onChange={(e) =>
                    setSettings({ ...settings, imageColor: e.target.value })
                  }
                >
                  {IMAGE_COLOR_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === '' ? 'None (any)' : o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ddgs-section">
                <label className="ddgs-label">Type</label>
                <select
                  className="ddgs-input"
                  value={settings.imageType}
                  onChange={(e) =>
                    setSettings({ ...settings, imageType: e.target.value })
                  }
                >
                  {IMAGE_TYPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === '' ? 'None (any)' : o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ddgs-section">
                <label className="ddgs-label">Layout</label>
                <select
                  className="ddgs-input"
                  value={settings.imageLayout}
                  onChange={(e) =>
                    setSettings({ ...settings, imageLayout: e.target.value })
                  }
                >
                  {IMAGE_LAYOUT_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === '' ? 'None (any)' : o}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="ddgs-section">
              <label className="ddgs-label">License</label>
              <select
                className="ddgs-input"
                value={settings.imageLicense}
                onChange={(e) =>
                  setSettings({ ...settings, imageLicense: e.target.value })
                }
              >
                {IMAGE_LICENSE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o === '' ? 'None (any)' : o}
                  </option>
                ))}
              </select>
            </div>

            <div className="ddgs-divider" />

            <div className="ddgs-subheader">
              <Video size={12} />
              <span>Video search defaults</span>
              <span className="ddgs-subhint">Empty = no filter.</span>
            </div>

            <div className="ddgs-grid2">
              <div className="ddgs-section">
                <label className="ddgs-label">Resolution</label>
                <select
                  className="ddgs-input"
                  value={settings.videoResolution}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      videoResolution: e.target.value,
                    })
                  }
                >
                  {VIDEO_RESOLUTION_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === '' ? 'None (any)' : o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ddgs-section">
                <label className="ddgs-label">Duration</label>
                <select
                  className="ddgs-input"
                  value={settings.videoDuration}
                  onChange={(e) =>
                    setSettings({ ...settings, videoDuration: e.target.value })
                  }
                >
                  {VIDEO_DURATION_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === '' ? 'None (any)' : o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ddgs-section">
                <label className="ddgs-label">License</label>
                <select
                  className="ddgs-input"
                  value={settings.videoLicense}
                  onChange={(e) =>
                    setSettings({ ...settings, videoLicense: e.target.value })
                  }
                >
                  {VIDEO_LICENSE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === '' ? 'None (any)' : o}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="ddgs-actions">
        <button
          type="button"
          className="btn-accent"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

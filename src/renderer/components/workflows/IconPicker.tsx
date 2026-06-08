/**
 * src/renderer/components/workflows/IconPicker.tsx
 *
 * Standalone icon picker rendered via React portal into document.body.
 * Every entry is validated at module-load time so the grid never receives
 * an undefined component.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Plus,
  Check,
  GitBranch,
  Server,
  Bot,
  Play,
  Cpu,
  Database,
  Globe,
  Mail,
  FileText,
  Terminal,
  Code,
  Layers,
  Zap,
  Star,
  Heart,
  Shield,
  Lock,
  Key,
  Cloud,
  Camera,
  Mic,
  Music,
  Video,
  Image,
  Download,
  Upload,
  RefreshCw,
  Settings,
  Sliders,
  Filter,
  BarChart2,
  PieChart,
  TrendingUp,
  Activity,
  Wifi,
  Package,
  Box,
  Inbox,
  Send,
  MessageSquare,
  Bell,
  Flag,
  Bookmark,
  Tag,
  Hash,
  Link,
  Scissors,
  Wrench,
  Hammer,
  Lightbulb,
  Target,
  Map,
  Compass,
  Clock,
  Calendar,
  Archive,
  Folder,
  Paperclip,
  Clipboard,
  Edit,
  Eye,
  EyeOff,
  User,
  Users,
  Home,
  Truck,
  Anchor,
  Hexagon,
  Circle,
  Square,
  Triangle,
  Workflow,
  Network,
  Share2,
  GitFork,
  Boxes,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Registry — every value is validated at module-load time.
// Adding an icon: import it above, add it to RAW, done.
// ---------------------------------------------------------------------------

const RAW: Record<string, LucideIcon | undefined> = {
  GitBranch,
  GitFork,
  Server,
  Bot,
  Play,
  Cpu,
  Database,
  Globe,
  Mail,
  FileText,
  Terminal,
  Code,
  Layers,
  Zap,
  Star,
  Heart,
  Shield,
  Lock,
  Key,
  Cloud,
  Camera,
  Mic,
  Music,
  Video,
  Image,
  Download,
  Upload,
  RefreshCw,
  Settings,
  Sliders,
  Filter,
  BarChart2,
  PieChart,
  TrendingUp,
  Activity,
  Wifi,
  Package,
  Box,
  Inbox,
  Send,
  MessageSquare,
  Bell,
  Flag,
  Bookmark,
  Tag,
  Hash,
  Link,
  Scissors,
  Wrench,
  Hammer,
  Lightbulb,
  Target,
  Map,
  Compass,
  Clock,
  Calendar,
  Archive,
  Folder,
  Paperclip,
  Clipboard,
  Edit,
  Eye,
  EyeOff,
  User,
  Users,
  Home,
  Truck,
  Anchor,
  Hexagon,
  Circle,
  Square,
  Triangle,
  Workflow,
  Network,
  Share2,
  Boxes,
  Sparkles,
  Search,
};

export const ICON_REGISTRY: Record<string, LucideIcon> = {};

for (const key of Object.keys(RAW)) {
  const val = RAW[key];
  if (val) ICON_REGISTRY[key] = val;
}

export const ICON_NAMES: string[] = Object.keys(ICON_REGISTRY).sort();

export function resolveIcon(name: string | undefined): LucideIcon {
  if (name && ICON_REGISTRY[name]) return ICON_REGISTRY[name];
  return GitBranch;
}

// ---------------------------------------------------------------------------
// Colour helpers & presets
// ---------------------------------------------------------------------------

const WHEEL_SIZE = 150;
const WHEEL_RENDER_SCALE = 2;
const WHEEL_BUF = WHEEL_SIZE * WHEEL_RENDER_SCALE;
const COLOR_PRESETS = ['#89b4fa', '#a6e3a1', '#f38ba8', '#cba6f7', '#f9e2af'];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 137, g: 180, b: 250 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const ch = (x: number) =>
    Math.min(255, Math.max(0, Math.round(x)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255)) as [
    number,
    number,
    number,
  ];
}

function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (max !== min) {
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h, s, v };
}

function renderWheel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  brightness: number,
): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(cx, cy) - 2;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const rows = Array.from({ length: h }, (_, y) => y);
  rows.forEach((y) => {
    Array.from({ length: w }, (_, x) => x).forEach((x) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const p = (y * w + x) * 4;

      if (dist > r) {
        d[p] = 0;
        d[p + 1] = 0;
        d[p + 2] = 0;
        d[p + 3] = 0;
        return;
      }

      const hue = ((Math.atan2(dy, dx) / Math.PI) * 180 + 360) % 360;
      const sat = dist / r;
      const [R, G, B] = hsvToRgb(hue, sat, brightness);
      d[p] = R;
      d[p + 1] = G;
      d[p + 2] = B;
      d[p + 3] = 255;
    });
  });
  ctx.putImageData(img, 0, 0);

  // Smooth the circle edge with an anti-aliased mask
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface IconPickerProps {
  current: string;
  currentColor: string;
  onSelect: (name: string) => void;
  onColorSelect: (color: string) => void;
  onClose: () => void;
}

export default function IconPicker({
  current,
  currentColor,
  onSelect,
  onColorSelect,
  onClose,
}: IconPickerProps) {
  const [query, setQuery] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [hexInput, setHexInput] = useState('');

  const initHsv = () =>
    rgbToHsv(
      hexToRgb(currentColor || '#89b4fa').r,
      hexToRgb(currentColor || '#89b4fa').g,
      hexToRgb(currentColor || '#89b4fa').b,
    );

  const [pickerHsv, setPickerHsv] = useState(initHsv);

  const pickerHex = useMemo(() => {
    const [r, g, b] = hsvToRgb(pickerHsv.h, pickerHsv.s, pickerHsv.v);
    return rgbToHex(r, g, b);
  }, [pickerHsv]);

  const pickerRgb = useMemo(() => {
    const [r, g, b] = hsvToRgb(pickerHsv.h, pickerHsv.s, pickerHsv.v);
    return { r, g, b };
  }, [pickerHsv]);

  // Live preview — updates as user interacts, reverts on cancel
  const [liveColor, setLiveColor] = useState(currentColor || '#89b4fa');

  // Sync preview to picker changes while popup is open
  useEffect(() => {
    if (showColorPicker) setLiveColor(pickerHex);
  }, [pickerHex, showColorPicker]);

  const popupRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const brightnessRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  // Keep hexInput in sync with pickerHex when not being typed into
  useEffect(() => {
    setHexInput(pickerHex);
  }, [pickerHex]);

  // Render the colour wheel canvas (at 2x for anti-aliasing)
  useEffect(() => {
    const canvas = wheelRef.current;
    if (!canvas || !showColorPicker) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderWheel(ctx, WHEEL_BUF, WHEEL_BUF, pickerHsv.v);
  }, [pickerHsv.v, showColorPicker]);

  const handleHexInput = (value: string) => {
    const clean = value.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length > 6) return;
    setHexInput(`#${clean}`);
    if (clean.length === 6) {
      const { r, g, b } = hexToRgb(`#${clean}`);
      const { h, s, v } = rgbToHsv(r, g, b);
      setPickerHsv({ h, s, v });
    }
  };

  const handleRgbInput = (channel: 'r' | 'g' | 'b', raw: string) => {
    const num = parseInt(raw, 10);
    if (Number.isNaN(num)) return;
    const clamped = Math.min(255, Math.max(0, num));
    const next = { ...pickerRgb, [channel]: clamped };
    const { h, s, v } = rgbToHsv(next.r, next.g, next.b);
    setPickerHsv({ h, s, v });
  };

  const openColorPicker = () => {
    const { h, s, v } = rgbToHsv(
      hexToRgb(currentColor || '#89b4fa').r,
      hexToRgb(currentColor || '#89b4fa').g,
      hexToRgb(currentColor || '#89b4fa').b,
    );
    setPickerHsv({ h, s, v });
    setShowColorPicker(true);
  };

  const handleWheelMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = wheelRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = WHEEL_BUF / rect.width;
    const scaleY = WHEEL_BUF / rect.height;
    const cx = WHEEL_BUF / 2;
    const cy = WHEEL_BUF / 2;
    const radius = Math.min(cx, cy) - 2;

    const update = (clientX: number, clientY: number) => {
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) return;
      const h = ((Math.atan2(dy, dx) / Math.PI) * 180 + 360) % 360;
      const s = dist / radius;
      setPickerHsv((prev) => ({ ...prev, h, s }));
    };

    update(e.clientX, e.clientY);

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      update(ev.clientX, ev.clientY);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleBrightnessMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const track = brightnessRef.current!;
    const rect = track.getBoundingClientRect();

    const update = (clientX: number) => {
      const x = clientX - rect.left;
      const v = Math.max(0, Math.min(1, x / rect.width));
      setPickerHsv((prev) => ({ ...prev, v }));
    };

    update(e.clientX);

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      update(ev.clientX);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const thumbPos = useMemo(() => {
    const cx = WHEEL_BUF / 2;
    const cy = WHEEL_BUF / 2;
    const radius = Math.min(cx, cy) - 2;
    const angle = pickerHsv.h * (Math.PI / 180);
    const dist = pickerHsv.s * radius;
    return {
      left: (cx + dist * Math.cos(angle)) / WHEEL_RENDER_SCALE,
      top: (cy + dist * Math.sin(angle)) / WHEEL_RENDER_SCALE,
    };
  }, [pickerHsv.h, pickerHsv.s]);

  const brightnessGradient = useMemo(() => {
    const [r, g, b] = hsvToRgb(pickerHsv.h, pickerHsv.s, 1);
    return `linear-gradient(to right, #000, ${rgbToHex(r, g, b)})`;
  }, [pickerHsv.h, pickerHsv.s]);

  useEffect(() => {
    if (showColorPicker && addBtnRef.current) {
      const rect = addBtnRef.current.getBoundingClientRect();
      setPopupStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [showColorPicker]);

  useEffect(() => {
    if (!showColorPicker) return undefined;
    const onDocClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setLiveColor(currentColor || '#89b4fa');
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showColorPicker]);

  const filtered = useMemo(
    () =>
      query.trim()
        ? ICON_NAMES.filter((n) =>
            n.toLowerCase().includes(query.toLowerCase()),
          )
        : ICON_NAMES,
    [query],
  );

  return createPortal(
    <div className="wf-icon-picker-overlay" onClick={onClose}>
      <div className="wf-icon-picker" onClick={(e) => e.stopPropagation()}>
        <div className="wf-icon-picker__header">
          <span>Choose Icon</span>
          <button
            type="button"
            className="wf-icon-picker__close"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {/* -- Search -- */}
        <div className="wf-icon-picker__search-row">
          <Search size={13} className="wf-icon-picker__search-icon" />
          <input
            autoFocus
            className="wf-icon-picker__search"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* -- Color row -- */}
        <div className="wf-icon-picker__color-row">
          <div
            className="wf-icon-picker__color-preview"
            style={{ background: liveColor }}
          />
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              className={`wf-icon-picker__color-swatch${currentColor === color ? ' wf-icon-picker__color-swatch--active' : ''}`}
              style={{ background: color }}
              onClick={() => onColorSelect(color)}
              aria-label={color}
            />
          ))}
          <button
            ref={addBtnRef}
            type="button"
            className="wf-icon-picker__color-add"
            onClick={openColorPicker}
            aria-label="Custom color"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* -- Color picker popup -- */}
        {showColorPicker && (
          <div
            className="wf-icon-picker__color-popup"
            ref={popupRef}
            style={popupStyle}
          >
            <div className="wf-icon-picker__wheel-area">
              <canvas
                ref={wheelRef}
                width={WHEEL_BUF}
                height={WHEEL_BUF}
                className="wf-icon-picker__wheel-canvas"
                onMouseDown={handleWheelMouseDown}
              />
              <div
                className="wf-icon-picker__wheel-thumb"
                style={{
                  left: thumbPos.left,
                  top: thumbPos.top,
                  background: pickerHex,
                }}
              />
            </div>

            <div
              ref={brightnessRef}
              className="wf-icon-picker__brightness-track"
              onMouseDown={handleBrightnessMouseDown}
              style={{ background: brightnessGradient }}
              role="slider"
              tabIndex={0}
              aria-label="Brightness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pickerHsv.v * 100)}
            >
              <div
                className="wf-icon-picker__brightness-thumb"
                style={{ left: `${pickerHsv.v * 100}%` }}
              />
            </div>

            <div className="wf-icon-picker__color-popup-rgb-row">
              <div className="wf-icon-picker__color-popup-field">
                <label htmlFor="cp-r">R</label>
                <input
                  id="cp-r"
                  className="wf-icon-picker__color-popup-input"
                  type="number"
                  min={0}
                  max={255}
                  value={pickerRgb.r}
                  onChange={(e) => handleRgbInput('r', e.target.value)}
                />
              </div>
              <div className="wf-icon-picker__color-popup-field">
                <label htmlFor="cp-g">G</label>
                <input
                  id="cp-g"
                  className="wf-icon-picker__color-popup-input"
                  type="number"
                  min={0}
                  max={255}
                  value={pickerRgb.g}
                  onChange={(e) => handleRgbInput('g', e.target.value)}
                />
              </div>
              <div className="wf-icon-picker__color-popup-field">
                <label htmlFor="cp-b">B</label>
                <input
                  id="cp-b"
                  className="wf-icon-picker__color-popup-input"
                  type="number"
                  min={0}
                  max={255}
                  value={pickerRgb.b}
                  onChange={(e) => handleRgbInput('b', e.target.value)}
                />
              </div>
            </div>

            <div className="wf-icon-picker__color-popup-field">
              <label htmlFor="cp-hex">Hex</label>
              <input
                id="cp-hex"
                className="wf-icon-picker__color-popup-input"
                value={hexInput}
                onChange={(e) => handleHexInput(e.target.value)}
                placeholder="#rrggbb"
                maxLength={7}
              />
            </div>

            <button
              type="button"
              className="wf-icon-picker__color-popup-apply"
              onClick={() => {
                onColorSelect(pickerHex);
                setShowColorPicker(false);
              }}
            >
              <Check size={13} /> Apply
            </button>
          </div>
        )}

        <div className="wf-icon-picker__grid">
          {filtered.map((name) => {
            const Ic = ICON_REGISTRY[name];
            if (!Ic) return null;
            return (
              <button
                key={name}
                type="button"
                title={name}
                className={`wf-icon-picker__item${current === name ? ' wf-icon-picker__item--active' : ''}`}
                onClick={() => {
                  onSelect(name);
                  onClose();
                }}
              >
                <Ic size={17} />
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

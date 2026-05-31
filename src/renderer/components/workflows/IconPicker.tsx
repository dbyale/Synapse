/**
 * src/renderer/components/workflows/IconPicker.tsx
 *
 * Standalone icon picker rendered via React portal into document.body.
 * Every entry is validated at module-load time so the grid never receives
 * an undefined component.
 */

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
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

export const ICON_REGISTRY: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(RAW).filter(
    (entry): entry is [string, LucideIcon] => typeof entry[1] === 'function',
  ),
);

export const ICON_NAMES: string[] = Object.keys(ICON_REGISTRY).sort();

export function resolveIcon(name: string | undefined): LucideIcon {
  if (name && ICON_REGISTRY[name]) return ICON_REGISTRY[name];
  return GitBranch;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface IconPickerProps {
  current: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}

export default function IconPicker({
  current,
  onSelect,
  onClose,
}: IconPickerProps) {
  const [query, setQuery] = useState('');

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

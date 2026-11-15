import type { ReactNode } from 'react';
import {
  Apple,
  ArrowUpCircle,
  Cpu,
  Download,
  FileCode,
  Gpu,
  HardDrive,
  Loader2,
  Microchip,
  RotateCw,
  Smartphone,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactComponent as NvidiaLogo } from '../../../../assets/logos/nvidia.svg';
import type {
  BackendDownload,
  BackendTag,
  InstalledBackend,
} from '../../preload.d';
import '../../onboarding/onboarding.css';

// The backend picker shared by onboarding and Settings ▸ Backend. Kept in one
// place so the two surfaces cannot disagree about what a card means: the same
// badge, the same icon, and the same install/update/uninstall affordances.

export const ICON_MAP: Record<BackendDownload['icon'], LucideIcon> = {
  cuda: Gpu,
  opencl: Gpu,
  vulkan: Sparkles,
  apple: Apple,
  cpu: Cpu,
  openvino: Microchip,
  rocm: Gpu,
  sycl: Gpu,
  android: Smartphone,
  custom: HardDrive,
  python: FileCode,
};

export const TAG_BADGES: Record<
  BackendTag,
  { label: string; className: string }
> = {
  'no-gpu': { label: 'No Valid GPU', className: 'onb-backend-badge-red' },
  'wrong-arch': {
    label: 'Wrong Architecture',
    className: 'onb-backend-badge-red',
  },
  'wrong-system': {
    label: 'Wrong System',
    className: 'onb-backend-badge-red',
  },
  outdated: { label: 'Outdated', className: 'onb-backend-badge-yellow' },
};

// Groups for the full backend list, in display order:
// 1. Compatible (correct OS+arch+GPU; outdated OK)
// 2. GPU Not Found (correct OS+arch)
// 3. Correct Arch, Incorrect OS
// 4. Other (anything with wrong-arch)
export type OtherBackendGroup =
  | 'compatible'
  | 'gpu-missing'
  | 'wrong-system'
  | 'other';

export function getOtherBackendGroup(
  download: BackendDownload,
): OtherBackendGroup {
  const tags = download.tags ?? [];
  const hasArch = tags.includes('wrong-arch');
  const hasSystem = tags.includes('wrong-system');
  const hasNoGpu = tags.includes('no-gpu');
  if (!hasArch && !hasSystem && !hasNoGpu) return 'compatible';
  if (hasNoGpu && !hasArch && !hasSystem) return 'gpu-missing';
  if (hasSystem && !hasArch) return 'wrong-system';
  return 'other';
}

export function groupBackends(
  downloads: BackendDownload[],
): Record<OtherBackendGroup, BackendDownload[]> {
  const groups: Record<OtherBackendGroup, BackendDownload[]> = {
    compatible: [],
    'gpu-missing': [],
    'wrong-system': [],
    other: [],
  };
  downloads.forEach((download) => {
    groups[getOtherBackendGroup(download)].push(download);
  });
  return groups;
}

// Icon for a backend folder this build has no download entry for (an older
// target name, or a build copied in by hand).
export function iconForFolder(folder: string): BackendDownload['icon'] {
  const name = folder.toLowerCase();
  if (name.includes('cuda')) return 'cuda';
  if (name.includes('vulkan')) return 'vulkan';
  if (name.includes('opencl') || name.includes('adreno')) return 'opencl';
  if (name.includes('rocm')) return 'rocm';
  if (name.includes('sycl')) return 'sycl';
  if (name.includes('openvino')) return 'openvino';
  if (name.includes('macos') || name.includes('metal')) return 'apple';
  return 'cpu';
}

export function BackendCardIcon({ download }: { download: BackendDownload }) {
  const Icon = ICON_MAP[download.icon];
  if (download.icon === 'cuda') {
    return <NvidiaLogo className="onb-backend-logo" />;
  }
  if (download.dualIcon) {
    return (
      <>
        <Gpu size={22} strokeWidth={2} />
        <Cpu size={22} strokeWidth={2} />
      </>
    );
  }
  return <Icon size={24} strokeWidth={2} />;
}

export type DownloadStatus =
  | 'downloading'
  | 'extracting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export function DownloadIcon({
  status,
}: {
  status: DownloadStatus | undefined;
}) {
  if (status === 'completed') return <Trash2 size={18} strokeWidth={2} />;
  if (status === 'downloading' || status === 'extracting') {
    return (
      <Loader2 size={18} strokeWidth={2} className="onb-backend-spinner" />
    );
  }
  return <Download size={18} strokeWidth={2} />;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

// One bar, two stages. Extraction has a real total for archives (a .tar.gz
// payload size is unknown until it is unpacked), so it degrades to counting
// bytes written instead of pretending a percentage is known.
function progressLabel(isExtracting: boolean, percent: number): string {
  if (isExtracting) {
    return percent > 0 ? `Unzipping ${percent}%` : 'Unzipping…';
  }
  return percent > 0 ? `${percent}%` : 'Connecting…';
}

function progressBytes(
  downloadedBytes: number | undefined,
  totalBytes: number | undefined,
): string {
  if (totalBytes) {
    return ` · ${formatBytes(downloadedBytes ?? 0)} / ${formatBytes(totalBytes)}`;
  }
  if (downloadedBytes) {
    return ` · ${formatBytes(downloadedBytes)} written`;
  }
  return '';
}

// Everything the card renders from, in one object: the picker builds a view per
// backend (from the hook) and the card stays a pure function of it. Grouped as
// one prop so call sites never spread.
export interface BackendCardView {
  download: BackendDownload;
  /** What is on disk for this download's folder, when anything is. */
  installed?: InstalledBackend;
  /** llama.cpp nightly this Synapse build downloads. */
  pinnedVersion?: string;
  status?: DownloadStatus;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

// Same shape for every card: the card hands back what it was rendered with, so
// a surface only needs one actions object (with onUninstall swapped out when it
// wants a confirmation first).
export interface BackendCardActions {
  onDownload: (download: BackendDownload) => void;
  onUninstall: (
    download: BackendDownload,
    installed?: InstalledBackend,
  ) => void;
  onReinstall?: (
    download: BackendDownload,
    installed: InstalledBackend,
  ) => void;
}

export interface BackendCardProps {
  view: BackendCardView;
  actions: BackendCardActions;
  /** Extra right-hand control, e.g. "use this backend". */
  // React 19 ignores defaultProps on function components, so the default lives
  // in the destructuring instead.
  // eslint-disable-next-line react/require-default-props
  trailing?: ReactNode;
  // eslint-disable-next-line react/require-default-props
  disabled?: boolean;
}

// The one action a card always offers: download, or replace what is installed.
// An installed build newer than this pin is replaced by an older llama.cpp, so
// the control has to say that rather than read as a repair.
function reinstallLabels(
  label: string,
  canUpdate: boolean,
  isDowngrade: boolean,
  installedVersion: string | null | undefined,
  pinnedVersion: string | undefined,
): { title: string; aria: string } {
  if (canUpdate) {
    return {
      title: `Update ${label} to llama.cpp ${pinnedVersion}`,
      aria: `Update ${label}`,
    };
  }
  if (isDowngrade) {
    return {
      title: `Replace llama.cpp ${installedVersion} with the ${pinnedVersion} this Synapse uses`,
      aria: `Downgrade ${label}`,
    };
  }
  return { title: `Reinstall ${label}`, aria: `Reinstall ${label}` };
}

export default function BackendCard({
  view,
  actions,
  trailing = null,
  disabled = false,
}: BackendCardProps) {
  const {
    download,
    installed,
    pinnedVersion,
    status,
    percent,
    downloadedBytes,
    totalBytes,
    error,
  } = view;
  const { onDownload, onUninstall, onReinstall } = actions;
  const isExtracting = status === 'extracting';
  // Downloading and unpacking share one slot on the card, and neither stage can
  // be re-triggered while it is running.
  const isBusy = status === 'downloading' || isExtracting;
  // Installed means "on disk", which the backend inventory decides — not "this
  // build recorded a download for it". The two differ for every backend that
  // was installed by an earlier Synapse version or copied in by hand.
  const present = !!installed?.exists;
  const isStale = !!installed && !installed.exists;
  const isInstalled = present || isStale || status === 'completed';
  const isIncomplete = present && !installed?.hasServer;
  const hasUpdate = !!installed && installed.updateState === 'update-available';
  const canUpdate =
    hasUpdate &&
    present &&
    !!onReinstall &&
    !!installed?.hasServer &&
    !!download.url;
  // The installed build is newer than this Synapse pins: the action replaces it
  // with an older llama.cpp, so it has to say so rather than read as a repair.
  const isDowngrade =
    present && installed?.updateState === 'newer' && !!download.url;

  const cardClass = [
    'onb-backend-card',
    isBusy ? 'onb-backend-card--downloading' : '',
    present && !isIncomplete ? 'onb-backend-card--completed' : '',
    isIncomplete || isStale ? 'onb-backend-card--broken' : '',
    disabled ? 'onb-backend-card--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const barWidth =
    typeof percent === 'number' && percent > 0 ? Math.min(100, percent) : 0;

  const labels = reinstallLabels(
    download.label,
    canUpdate,
    isDowngrade,
    installed?.llamaVersion,
    pinnedVersion,
  );

  return (
    <div className={cardClass}>
      <span className="onb-backend-card-icon">
        <BackendCardIcon download={download} />
      </span>
      <span className="onb-backend-card-body">
        <span className="onb-backend-card-title-row">
          <span className="onb-backend-card-title">{download.label}</span>
          {download.recommended && (
            <span className="onb-backend-recommended">Recommended</span>
          )}
          {download.experimental && (
            <span className="onb-backend-experimental">Experimental</span>
          )}
          {download.tags?.map((tag) => {
            const badge = TAG_BADGES[tag];
            return (
              <span key={tag} className={badge.className}>
                {badge.label}
              </span>
            );
          })}
          {installed?.selected && (
            <span className="onb-backend-inuse">In use</span>
          )}
        </span>
        {download.sublabel && (
          <span className="onb-backend-card-sublabel">{download.sublabel}</span>
        )}
        {hasUpdate && pinnedVersion && installed?.llamaVersion && (
          <span className="onb-backend-update">
            <ArrowUpCircle size={13} strokeWidth={2.2} />
            Update available: {installed.llamaVersion} → {pinnedVersion}
          </span>
        )}
        {present && installed?.updateState === 'unknown' && (
          <span className="onb-backend-unknown">
            This install has no recorded llama.cpp version — reinstall it to
            bring it up to this build.
          </span>
        )}
        {isIncomplete && (
          <span className="onb-backend-warning">
            <TriangleAlert size={13} strokeWidth={2.2} />
            Incomplete install — llama-server is missing from{' '}
            {installed?.folder}.
          </span>
        )}
        {isStale && (
          <span className="onb-backend-warning">
            <TriangleAlert size={13} strokeWidth={2.2} />
            {installed?.folder} is not on disk — this install record is left
            over.
          </span>
        )}
        {present && installed?.hasServer && !installed?.hasFitParams && (
          <span className="onb-backend-warning">
            <TriangleAlert size={13} strokeWidth={2.2} />
            No llama-fit-params in this folder — the memory optimizer cannot
            measure it.
          </span>
        )}
        {download.warning && (
          <span className="onb-backend-warning">
            <TriangleAlert size={13} strokeWidth={2.2} />
            {download.warning}
          </span>
        )}
        {isBusy && (
          <span className="onb-backend-progress">
            <span
              className="onb-backend-progress-fill"
              style={{ width: `${barWidth}%` }}
            />
            <span className="onb-backend-progress-text">
              {progressLabel(isExtracting, Math.round(barWidth))}
              {progressBytes(downloadedBytes, totalBytes)}
            </span>
          </span>
        )}
        {status === 'failed' && error && (
          <span className="onb-backend-warning">
            <TriangleAlert size={13} strokeWidth={2.2} />
            {error}
          </span>
        )}
      </span>
      {trailing}
      {(download.url || installed) && (
        <span className="onb-backend-actions">
          {present && onReinstall && download.url && (
            <button
              type="button"
              className={`onb-backend-download ${
                canUpdate ? 'onb-backend-download--update' : ''
              }`}
              title={labels.title}
              aria-label={labels.aria}
              onClick={() =>
                installed &&
                onReinstall(download, installed as InstalledBackend)
              }
              disabled={isBusy || disabled}
            >
              {canUpdate ? (
                <ArrowUpCircle size={18} strokeWidth={2} />
              ) : (
                <RotateCw size={18} strokeWidth={2} />
              )}
            </button>
          )}
          {(isInstalled || download.url) && (
            <button
              type="button"
              className={`onb-backend-download ${
                isInstalled ? 'onb-backend-download--uninstall' : ''
              }`}
              title={
                isInstalled
                  ? `${isStale ? 'Remove' : 'Uninstall'} ${download.label}`
                  : `Download ${download.label}`
              }
              aria-label={
                isInstalled
                  ? `${isStale ? 'Remove' : 'Uninstall'} ${download.label}`
                  : `Download ${download.label}`
              }
              onClick={() =>
                isInstalled
                  ? onUninstall(download, installed)
                  : onDownload(download)
              }
              disabled={isBusy || disabled}
            >
              {isInstalled ? (
                <Trash2 size={18} strokeWidth={2} />
              ) : (
                <DownloadIcon status={status} />
              )}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

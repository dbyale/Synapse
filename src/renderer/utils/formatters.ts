export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return val >= 10 ? `${Math.round(val)}M` : `${val.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return val >= 10 ? `${Math.round(val)}K` : `${val.toFixed(1)}K`;
  }
  return n.toString();
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0 || isNaN(bytesPerSec)) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return `${parseFloat((bytesPerSec / k ** i).toFixed(1))} ${sizes[i]}`;
}

const AVATAR_COLORS = [
  '#89b4fa',
  '#f38ba8',
  '#a6e3a1',
  '#f9e2af',
  '#cba6f7',
  '#94e2d5',
];

export function getAvatarColor(name: string): string {
  const hash = name
    .split('')
    .reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Updated to return only 1 uppercase letter
export function getInitials(name: string): string {
  return name.substring(0, 1).toUpperCase();
}

export function formatGB(bytes: number): string {
  if (bytes === 0 || isNaN(bytes)) return '0.00 GB';
  const gb = bytes / 1073741824; // 1024^3
  return `${gb.toFixed(2)} GB`;
}

export function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

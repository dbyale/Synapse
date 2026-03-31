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

export function getInitials(name: string): string {
  return name.substring(0, 2).toUpperCase();
}

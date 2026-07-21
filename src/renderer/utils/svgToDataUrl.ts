export function svgToDataUrl(iconSvgData: string): string {
  const raw = atob(iconSvgData.split(',')[1]);

  const resolvedColor =
    getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#888';

  const svg = raw.replace(/currentColor/gi, resolvedColor);

  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

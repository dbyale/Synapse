import path from 'path';
import type { ExtensionToolDef } from '../types';
import manifest from './manifest.json';

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

export const tools: Record<string, ExtensionToolDef> = {
  display_web_image: {
    meta: {
      name: 'display_web_image',
      label: 'Display Web Image',
      description:
        'Display an image from a URL in the chat response. The image is fetched and shown inline.',
      descriptionForModel:
        'Display an image from the web inline in the chat.\n' +
        'Parameters:\n' +
        '  url (required) — URL of the image (http or https)\n' +
        '  alt_text (optional) — descriptive text for the image\n' +
        '  width (optional) — display width in pixels, height scales proportionally\n' +
        'Returns "Success" on success, or "Error [reason]" on failure.',
      icon: 'Image',
      displayType: 'image',
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
          description: 'Optional descriptive alt text for the image.',
        },
        width: {
          type: 'integer',
          description: 'Optional display width in pixels.',
        },
      },
      required: ['url'],
    },
    async handler(params: {
      url: string;
      alt_text?: string;
      width?: number;
    }): Promise<any> {
      const { url } = params;

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return { _response: `Error Invalid URL: ${url}` };
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return { _response: `Error Unsupported protocol: ${parsedUrl.protocol}` };
      }

      try {
        const response = await fetch(parsedUrl.toString(), {
          headers: { 'User-Agent': 'Synapse/1.0' },
        });

        if (!response.ok) {
          return { _response: `Error HTTP ${response.status}: ${response.statusText}` };
        }

        const contentType = response.headers.get('content-type') ?? '';
        let mimeType: string | null = null;

        if (contentType.includes('image/')) {
          const match = contentType.match(/image\/[a-zA-Z+.-]+/);
          if (match) {
            [mimeType] = match;
          }
        }

        if (!mimeType) {
          const ext = path.extname(parsedUrl.pathname).toLowerCase();
          if (ext) mimeType = IMAGE_EXTENSIONS[ext] ?? null;
        }

        if (!mimeType) {
          mimeType = 'image/png';
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const imageUrl = bufferToDataUrl(buffer, mimeType);

        return {
          _response: 'Success',
          _image: {
            url: imageUrl,
            altText: params.alt_text,
            width: params.width,
          },
        };
      } catch (err) {
        return { _response: `Error Failed to fetch image: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  },
};

export { manifest };

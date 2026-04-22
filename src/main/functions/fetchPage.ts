import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const turndown = new TurndownService();

export async function fetchPage(url: string, raw: boolean = false): Promise<string> {
  try {
    new URL(url);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) {
      return `Error: Failed to fetch URL. Status ${response.status}: ${response.statusText}`;
    }

    const contentType = response.headers.get('content-type') || '';
    let content = '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      content = JSON.stringify(json, null, 2);
    } else if (contentType.includes('text/html')) {
      let html = await response.text();

      if (raw) {
        content = html;
      } else {
        // Smart router for HTML content
        let $ = cheerio.load(html);

        // 1. Check for Next.js __NEXT_DATA__ JSON payload
        const nextDataScript = $('script#__NEXT_DATA__');
        if (nextDataScript.length > 0) {
          try {
            const nextData = JSON.parse(nextDataScript.html() || '{}');
            content = JSON.stringify(nextData, null, 2);
            content = content.replace(/\n{3,}/g, '\n\n').trim();
            return content;
          } catch {
            // If parsing fails, fall through to standard processing
          }
        }

        // 2. Use static fetch with Cheerio + Turndown
        $ = cheerio.load(html);
        $('script').remove();
        $('style').remove();

        const cleanedHtml = $.html();
        const markdown = turndown.turndown(cleanedHtml);
        content = markdown;
      }
    } else {
      content = await response.text();
    }

    content = content.replace(/\n{3,}/g, '\n\n').trim();
    return content;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('timeout')) {
      return `Error: Request timeout while fetching ${url}`;
    }

    if (errorMessage.includes('Invalid URL')) {
      return `Error: Invalid URL provided: ${url}`;
    }

    return `Error: Failed to fetch ${url}. ${errorMessage}`;
  }
}

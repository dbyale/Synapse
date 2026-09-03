/* eslint import/prefer-default-export: off */
import type { Message, SavedSession } from '../../shared/chatTypes';

function prettyPrintJson(jsonString: string): string {
  let out: string;
  try {
    out = JSON.stringify(JSON.parse(jsonString), null, 2);
  } catch {
    out = jsonString;
  }
  return out.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
}

export function sessionsToMarkdown(
  session: SavedSession,
  profileName: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}`);
  lines.push('');
  lines.push(`- **Profile:** ${profileName || session.profileId}`);
  lines.push(`- **Created:** ${new Date(session.createdAt).toLocaleString()}`);
  lines.push(`- **Updated:** ${new Date(session.updatedAt).toLocaleString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const labelFor = (msg: Message): string => {
    if (msg.role === 'user') return 'You';
    if (msg.role === 'system') return 'System';
    return profileName || 'Assistant';
  };

  const hasStats = (msg: Message) =>
    !!msg.stats ||
    !!msg.promptStats ||
    msg.content.some((s) => s.text?.trim() || s.type === 'tool');

  session.messages.filter(hasStats).forEach((msg) => {
    lines.push(`## ${labelFor(msg)}`);
    lines.push('');

    const segments = msg.content.filter(
      (s) => s.text?.trim() || s.type === 'tool',
    );
    segments.forEach((seg) => {
      if (seg.type === 'tool') {
        lines.push(
          `**Tool call**${seg.toolName ? `: \`${seg.toolName}\`` : ''}`,
        );
        if (seg.toolParams) {
          lines.push('');
          lines.push('```json');
          lines.push(prettyPrintJson(seg.toolParams));
          lines.push('```');
        }
        if (seg.toolResult) {
          lines.push('');
          lines.push('```json');
          lines.push(prettyPrintJson(seg.toolResult));
          lines.push('```');
        }
        lines.push('');
        return;
      }
      if (seg.text && seg.text.trim()) {
        lines.push(seg.text.trim());
        lines.push('');
      }
    });

    if (msg.promptStats) {
      lines.push(
        `*Prompt: ${msg.promptStats.tokens} tokens in ${(msg.promptStats.timeMs / 1000).toFixed(2)}s*`,
      );
      lines.push('');
    }
    if (msg.stats) {
      lines.push(
        `*Generated: ${msg.stats.tokens} tokens in ${(msg.stats.timeMs / 1000).toFixed(2)}s*`,
      );
      lines.push('');
    }
  });

  return lines.join('\n');
}

// Import only the TYPE — erased at compile time, webpack never sees a real import
import type { defineChatSessionFunction as DefineChatSessionFunctionType } from 'node-llama-cpp';

type DefineFn = typeof DefineChatSessionFunctionType;

export function createChatFunctions(defineFn: DefineFn) {
  return {
    getCurrentDateTime: defineFn({
      description:
        'Get the current local date, time, and timezone. ' +
        'Returns an object with date, time, timezone, and ISO 8601 string. ' +
        'Make sure to use this information in a format readable to humans',
      params: {
        type: 'object',
        properties: {
          timezone: {
            oneOf: [
              { type: 'null' },
              { type: 'string' }, // e.g. "America/New_York"
            ],
          },
        },
      },
      async handler(params) {
        const requestedZone = params.timezone ?? null;
        const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const zone = requestedZone ?? systemZone;
        const now = new Date();

        try {
          const fmt = (opts: Intl.DateTimeFormatOptions) =>
            new Intl.DateTimeFormat('en-US', { ...opts, timeZone: zone }).format(now);

          return {
            date:     fmt({ year: 'numeric', month: 'long', day: 'numeric' }),
            time:     fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
            timezone: zone,
            iso:      now.toISOString(),
          };
        } catch {
          return (
            `Unrecognized timezone "${zone}". ` +
            `Current system time: ${now.toLocaleString()} (${systemZone})`
          );
        }
      },
    }),
  };
}

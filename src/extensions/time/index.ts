import type { ExtensionToolDef } from '../types';
import manifest from './manifest.json';

function isDSTActive(timezone: string, date: Date): boolean {
  try {
    const year = date.getFullYear();
    const januaryDate = new Date(year, 0, 1);
    const julyDate = new Date(year, 6, 1);
    const getUTCOffset = (d: Date): number => {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const yearVal = parseInt(parts.find((p) => p.type === 'year')?.value || '0', 10);
      const month = parseInt(parts.find((p) => p.type === 'month')?.value || '0', 10);
      const day = parseInt(parts.find((p) => p.type === 'day')?.value || '0', 10);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);
      const localDate = new Date(yearVal, month - 1, day, hour, minute, second);
      return (d.getTime() - localDate.getTime()) / (1000 * 60);
    };
    const januaryOffset = getUTCOffset(januaryDate);
    const julyOffset = getUTCOffset(julyDate);
    const currentOffset = getUTCOffset(date);
    const standardOffset = Math.min(januaryOffset, julyOffset);
    const daylightOffset = Math.max(januaryOffset, julyOffset);
    return currentOffset === daylightOffset;
  } catch {
    return false;
  }
}

function formatDateTimeWithOffset(date: Date, timezone: string): string {
  try {
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone }).format(date);
    const year = fmt({ year: 'numeric' });
    const month = fmt({ month: '2-digit' });
    const day = fmt({ day: '2-digit' });
    const hour = fmt({ hour: '2-digit', hour12: false });
    const minute = fmt({ minute: '2-digit' });
    const second = fmt({ second: '2-digit' });
    const localDateString = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const localDate = new Date(localDateString);
    const utcOffsetMs = date.getTime() - localDate.getTime();
    const utcOffsetMinutes = utcOffsetMs / (1000 * 60);
    const utcOffsetHours = Math.floor(utcOffsetMinutes / 60);
    const utcOffsetMinsRemainder = Math.abs(utcOffsetMinutes % 60);
    const offsetStr = `${utcOffsetHours >= 0 ? '+' : ''}${String(utcOffsetHours).padStart(2, '0')}:${String(Math.round(utcOffsetMinsRemainder)).padStart(2, '0')}`;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetStr}`;
  } catch {
    return date.toISOString();
  }
}

export const tools: Record<string, ExtensionToolDef> = {
  get_current_time: {
    meta: {
      name: 'get_current_time',
      label: 'Get Current Time',
      description: 'Allows the AI to get the current time in any timezone, including Daylight Savings Time.',
      icon: 'Clock',
    },
    params: {
      type: 'object',
      properties: {
        timezone: {
          oneOf: [
            { type: 'null' },
            { type: 'string', description: 'IANA timezone name (e.g., "America/New_York", "Europe/London", "Asia/Tokyo")' },
          ],
          description: 'IANA timezone name. If not provided, uses system timezone.',
        },
      },
    },
    async handler(params: { timezone?: string | null }) {
      const requestedZone = params.timezone ?? null;
      const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const zone = requestedZone ?? systemZone;
      const now = new Date();
      try {
        const datetime = formatDateTimeWithOffset(now, zone);
        const is_dst = isDSTActive(zone, now);
        return { timezone: zone, datetime, is_dst };
      } catch {
        return {
          error: `Unrecognized timezone "${zone}". Using system timezone: ${systemZone}`,
          timezone: systemZone,
          datetime: formatDateTimeWithOffset(now, systemZone),
          is_dst: isDSTActive(systemZone, now),
        };
      }
    },
  },

  convert_time: {
    meta: {
      name: 'convert_time',
      label: 'Convert Time',
      description: 'Allows the AI to convert a time from one timezone to another, showing the time difference and Daylight Savings Time information.',
      icon: 'Clock',
    },
    params: {
      type: 'object',
      properties: {
        source_timezone: { type: 'string', description: 'IANA timezone name of the source time (e.g., "America/New_York")' },
        time: { type: 'string', description: 'Time in 24-hour HH:MM format (e.g., "14:30")' },
        target_timezone: { type: 'string', description: 'IANA timezone name of the target timezone (e.g., "Europe/London")' },
      },
      required: ['source_timezone', 'time', 'target_timezone'],
    },
    async handler(params: { source_timezone: string; time: string; target_timezone: string }) {
      const { source_timezone, time, target_timezone } = params;
      try {
        const timeParts = time.split(':');
        if (timeParts.length !== 2) return { error: 'Invalid time format. Use HH:MM (24-hour format).' };
        const hours = parseInt(timeParts[0], 10);
        const minutes = parseInt(timeParts[1], 10);
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
          return { error: 'Invalid time. Hours must be 0-23, minutes 0-59.' };
        }
        const today = new Date();
        const sourceDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0);
        const fmt = (opts: Intl.DateTimeFormatOptions, tz: string) =>
          new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(sourceDate);
        const sourceYear = fmt({ year: 'numeric' }, source_timezone);
        const sourceMonth = fmt({ month: '2-digit' }, source_timezone);
        const sourceDay = fmt({ day: '2-digit' }, source_timezone);
        const sourceHour = fmt({ hour: '2-digit', hour12: false }, source_timezone);
        const sourceMinute = fmt({ minute: '2-digit' }, source_timezone);
        const sourceSecond = fmt({ second: '2-digit' }, source_timezone);
        const sourceLocalString = `${sourceYear}-${sourceMonth}-${sourceDay}T${sourceHour}:${sourceMinute}:${sourceSecond}`;
        const sourceLocalDate = new Date(sourceLocalString);
        const sourceUTCOffsetMs = sourceDate.getTime() - sourceLocalDate.getTime();
        const sourceUTCOffsetMinutes = sourceUTCOffsetMs / (1000 * 60);
        const utcDate = new Date(sourceDate.getTime() - sourceUTCOffsetMs);
        const targetYear = fmt({ year: 'numeric' }, target_timezone);
        const targetMonth = fmt({ month: '2-digit' }, target_timezone);
        const targetDay = fmt({ day: '2-digit' }, target_timezone);
        const targetHour = fmt({ hour: '2-digit', hour12: false }, target_timezone);
        const targetMinute = fmt({ minute: '2-digit' }, target_timezone);
        const targetSecond = fmt({ second: '2-digit' }, target_timezone);
        const targetLocalString = `${targetYear}-${targetMonth}-${targetDay}T${targetHour}:${targetMinute}:${targetSecond}`;
        const targetLocalDate = new Date(targetLocalString);
        const targetUTCOffsetMs = utcDate.getTime() - targetLocalDate.getTime();
        const targetUTCOffsetMinutes = targetUTCOffsetMs / (1000 * 60);
        const sourceDateTime = formatDateTimeWithOffset(sourceDate, source_timezone);
        const targetDateTime = formatDateTimeWithOffset(utcDate, target_timezone);
        const timeDiffMinutes = targetUTCOffsetMinutes - sourceUTCOffsetMinutes;
        const timeDiffHours = timeDiffMinutes / 60;
        const sign = timeDiffHours >= 0 ? '+' : '';
        const timeDiffStr = timeDiffHours % 1 === 0
          ? `${sign}${timeDiffHours.toFixed(0)}h`
          : `${sign}${timeDiffHours.toFixed(1)}h`;
        return {
          source: { timezone: source_timezone, datetime: sourceDateTime, is_dst: isDSTActive(source_timezone, sourceDate) },
          target: { timezone: target_timezone, datetime: targetDateTime, is_dst: isDSTActive(target_timezone, utcDate) },
          time_difference: timeDiffStr,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { error: `Failed to convert time: ${errorMessage}` };
      }
    },
  },
};

export { manifest };

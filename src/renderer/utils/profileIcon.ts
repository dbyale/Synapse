import { Send, type LucideIcon } from 'lucide-react';
import { ICON_REGISTRY } from '../components/workflows/IconPicker';

/**
 * Icon used for every profile that has none stored: profiles created before the
 * icon field existed, and imports that named an icon this build does not know.
 * The send glyph doubles as the empty-chat placeholder, so an icon-less profile
 * looks the same in both places.
 */
export const DEFAULT_PROFILE_ICON = 'Send';

/**
 * Resolves a profile's stored icon name to a component. Never returns
 * undefined, so a hand-edited or stale profile can never blank out the UI.
 *
 * The registry is a plain object, so the lookup is own-property only: a profile
 * that names 'constructor' or 'toString' must not hand back Object.prototype.
 */
export function resolveProfileIcon(name?: string): LucideIcon {
  if (name && Object.prototype.hasOwnProperty.call(ICON_REGISTRY, name)) {
    return ICON_REGISTRY[name];
  }
  return Send;
}

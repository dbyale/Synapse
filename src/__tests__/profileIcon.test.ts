// Unit tests for src/renderer/utils/profileIcon.ts. The rule the whole UI
// depends on: a profile always resolves to a drawable icon, whether it stored
// one, stored none (profiles predating the field), or named one this build
// does not ship.
import { Send } from 'lucide-react';
import {
  DEFAULT_PROFILE_ICON,
  resolveProfileIcon,
} from '../renderer/utils/profileIcon';
import { ICON_REGISTRY } from '../renderer/components/workflows/IconPicker';

describe('resolveProfileIcon', () => {
  it('resolves a stored icon name to its component', () => {
    expect(resolveProfileIcon('BrainCircuit')).toBe(ICON_REGISTRY.BrainCircuit);
    expect(resolveProfileIcon('Bot')).toBe(ICON_REGISTRY.Bot);
  });

  it('falls back to the default icon when the profile has none', () => {
    expect(resolveProfileIcon(undefined)).toBe(Send);
    expect(resolveProfileIcon('')).toBe(Send);
  });

  it('falls back for names this build does not ship', () => {
    expect(resolveProfileIcon('IconFromAnOlderBuild')).toBe(Send);
  });

  it('falls back for values that are not icon names at all', () => {
    // A hand-edited profile file can put anything in the field.
    expect(resolveProfileIcon('constructor')).toBe(Send);
  });

  it('names a default that the registry itself can resolve', () => {
    // The default is stored as a name, so a name missing from the registry
    // would make every icon-less profile take the unknown-name fallback.
    expect(ICON_REGISTRY[DEFAULT_PROFILE_ICON]).toBe(Send);
  });

  it('every icon in the registry resolves to a component', () => {
    const entries = Object.entries(ICON_REGISTRY);
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(([name, component]) => {
      expect(resolveProfileIcon(name)).toBe(component);
    });
  });
});

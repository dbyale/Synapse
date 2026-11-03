import fs from 'fs';
import path from 'path';
import {
  getEffectiveSettings,
  getExtensionDefaults,
  getExtensionSettingsDir,
  invalidateSettingsCache,
  setExtensionDefaults,
  setProfileToolSettings,
  updateRuntimeSettings,
} from '../main/extensionSettings';
import * as registryMock from '../main/extensionRegistry';

// The settings resolver in the main process is driven entirely by whatever an
// extension declares for itself. These tests use fixture extension ids the core
// has never heard of, plus a fake registry, to prove a user-authored extension
// gets the whole system with zero core changes. jest hoists these calls above
// the imports.
jest.mock('electron', () => {
  const os = require('os');
  const fsp = require('fs');
  const pth = require('path');
  const dir = fsp.mkdtempSync(pth.join(os.tmpdir(), 'synapse-settings-'));
  return { app: { getPath: () => dir } };
});

jest.mock('../main/extensionRegistry', () => {
  // Mirrors what the real registry does: a manifest's raw `settings` block is
  // validated once, and only the validated def is ever handed to the resolver.
  const { validateSettingsDef } = require('../shared/extensionSettings');
  const schemas: Record<string, any> = {};
  const defaultHooks: Record<string, () => any> = {};
  const normalizeHooks: Record<string, (bag: any) => any> = {};
  return {
    defineFixtureExtension(
      id: string,
      settings: unknown,
      hooks?: {
        defaultSettings?: () => any;
        normalizeSettings?: (bag: any) => any;
      },
    ) {
      schemas[id] = validateSettingsDef(settings);
      if (hooks?.defaultSettings) defaultHooks[id] = hooks.defaultSettings;
      if (hooks?.normalizeSettings)
        normalizeHooks[id] = hooks.normalizeSettings;
    },
    getExtensionRegistry: () => ({
      getExtensionSettingsSchema: (id: string) => schemas[id],
      getExtensionDefaultSettings: (id: string) => defaultHooks[id],
      getExtensionNormalizeSettings: (id: string) => normalizeHooks[id],
    }),
  };
});

type DefineFixture = (
  id: string,
  settings: unknown,
  hooks?: {
    defaultSettings?: () => any;
    normalizeSettings?: (bag: any) => any;
  },
) => void;

function defineFixture(
  id: string,
  settings: unknown,
  hooks?: {
    defaultSettings?: () => any;
    normalizeSettings?: (bag: any) => any;
  },
): void {
  const { defineFixtureExtension } = registryMock as any;
  (defineFixtureExtension as DefineFixture)(id, settings, hooks);
  invalidateSettingsCache();
}

describe('per-extension, per-profile settings resolution', () => {
  it('layers declared defaults, defaults file, profile overrides and runtime', () => {
    const id = 'layered_fixture';
    defineFixture(
      id,
      {
        fields: [
          {
            key: 'greeting',
            label: 'Greeting',
            kind: 'text',
            default: 'hello',
          },
          {
            key: 'retries',
            label: 'Retries',
            kind: 'number',
            min: 0,
            max: 5,
            default: 1,
          },
          { key: 'token', label: 'Token', kind: 'secret' },
        ],
      },
      { defaultSettings: () => ({ token: 'global-secret' }) },
    );

    // Layer 1: declared defaults + the extension's own defaultSettings() hook.
    expect(getEffectiveSettings(id, 'p-a')).toEqual({
      greeting: 'hello',
      retries: 1,
      token: 'global-secret',
    });

    // Layer 2: the extension's own defaults page.
    expect(setExtensionDefaults(id, { greeting: 'howdy' })).toEqual({
      success: true,
    });
    expect(getExtensionDefaults(id).greeting).toBe('howdy');
    expect(getEffectiveSettings(id, 'p-a').greeting).toBe('howdy');

    // Layer 3: this profile's overrides. Another profile is unaffected, and a
    // secret smuggled in through a profile is ignored.
    setProfileToolSettings('p-a', {
      [id]: { greeting: 'yo', token: 'stolen' },
    });
    expect(getEffectiveSettings(id, 'p-a')).toEqual({
      greeting: 'yo',
      retries: 1,
      token: 'global-secret',
    });
    expect(getEffectiveSettings(id, 'p-b').greeting).toBe('howdy');

    // Layer 4: the runtime overlay written by ctx.updateSettings().
    const updated = updateRuntimeSettings(id, 'p-a', {
      greeting: 'runtime',
      retries: 99,
    });
    expect(updated.success).toBe(true);
    expect(updated.applied.sort()).toEqual(['greeting', 'retries']);
    expect(getEffectiveSettings(id, 'p-a')).toEqual({
      greeting: 'runtime',
      retries: 5, // clamped by the field definition
      token: 'global-secret',
    });
    expect(getEffectiveSettings(id, 'p-b').greeting).toBe('howdy');

    const dir = getExtensionSettingsDir();
    const runtime = JSON.parse(
      fs.readFileSync(path.join(dir, `${id}.runtime.json`), 'utf-8'),
    );
    expect(runtime['p-a']).toEqual({ greeting: 'runtime', retries: 5 });
    const defaults = JSON.parse(
      fs.readFileSync(path.join(dir, `${id}.json`), 'utf-8'),
    );
    expect(defaults).toEqual({ greeting: 'howdy' });
    expect(JSON.stringify(defaults)).not.toContain('secret');
  });

  it('refuses runtime writes for keys the extension does not expose per profile', () => {
    const id = 'guarded_fixture';
    defineFixture(id, {
      fields: [
        { key: 'greeting', label: 'Greeting', kind: 'text', default: 'hi' },
        { key: 'token', label: 'Token', kind: 'secret' },
        {
          key: 'cacheDir',
          label: 'Cache directory',
          kind: 'directory',
          perProfile: false,
        },
      ],
    });

    const result = updateRuntimeSettings(id, 'p-a', {
      token: 'sneaky',
      cacheDir: 'C:/sneaky',
      unknown: 'value',
    });
    expect(result.success).toBe(true);
    expect(result.applied).toEqual([]);
    expect(getEffectiveSettings(id, 'p-a')).toEqual({
      greeting: 'hi',
      token: '',
      cacheDir: '',
    });
  });

  it('runs the extension normalizeSettings hook over the resolved bag', () => {
    const id = 'normalized_fixture';
    defineFixture(
      id,
      {
        fields: [{ key: 'domains', label: 'Domains', kind: 'stringList' }],
      },
      {
        normalizeSettings: (bag: any) => ({
          ...bag,
          domains: (bag.domains as string[]).map((d) => d.toLowerCase()),
        }),
      },
    );
    setProfileToolSettings('p-c', { [id]: { domains: ['EXAMPLE.com'] } });
    expect(getEffectiveSettings(id, 'p-c').domains).toEqual(['example.com']);
  });

  it('still works for an extension that declares no settings at all', () => {
    const id = 'bare_fixture';
    defineFixture(id, undefined);
    setExtensionDefaults(id, { anything: 'value' });
    expect(getExtensionDefaults(id)).toEqual({ anything: 'value' });
    expect(getEffectiveSettings(id, 'p-a')).toEqual({ anything: 'value' });
    const result = updateRuntimeSettings(id, 'p-a', { a: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('declares no settings fields');
  });
});

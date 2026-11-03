import {
  coerceSettings,
  coerceValue,
  declaredDefaults,
  findField,
  hasSettings,
  isPerProfileField,
  mergeRuntimePatch,
  optionLabel,
  sanitizeProfileOverrides,
  sanitizeToolSettings,
  sameSettingValue,
  validateSettingsDef,
} from '../shared/extensionSettings';

// A settings block written exactly the way a user extension would author it in
// its own manifest.json. Nothing here is known to the core.
const fixtureManifestSettings = {
  fields: [
    {
      key: 'greeting',
      label: 'Greeting',
      kind: 'text',
      group: 'Basics',
      default: 'hello',
    },
    {
      key: 'retries',
      label: 'Retries',
      kind: 'number',
      min: 0,
      max: 5,
      default: 2,
    },
    { key: 'verbose', label: 'Verbose', kind: 'toggle', default: false },
    {
      key: 'mode',
      label: 'Mode',
      kind: 'select',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'safe', label: 'Safe' },
      ],
      default: 'fast',
    },
    { key: 'tags', label: 'Tags', kind: 'stringList' },
    {
      key: 'token',
      label: 'API token',
      kind: 'secret',
      sensitive: true,
    },
    {
      key: 'cacheDir',
      label: 'Cache directory',
      kind: 'directory',
      perProfile: false,
    },
  ],
  defaults: { greeting: 'hi', retries: 1 },
};

describe('validateSettingsDef', () => {
  it('accepts a manifest-authored block and derives per-field metadata', () => {
    const def = validateSettingsDef(fixtureManifestSettings);
    expect(def).toBeDefined();
    expect(hasSettings(def)).toBe(true);
    expect(def?.fields.map((f) => f.key)).toEqual([
      'greeting',
      'retries',
      'verbose',
      'mode',
      'tags',
      'token',
      'cacheDir',
    ]);
    expect(def?.defaults).toEqual({ greeting: 'hi', retries: 1 });
  });

  it('forces secrets out of the profile layer regardless of what was authored', () => {
    const def = validateSettingsDef({
      fields: [
        { key: 'token', label: 'Token', kind: 'secret', perProfile: true },
      ],
    });
    const token = findField(def, 'token');
    expect(token?.sensitive).toBe(true);
    expect(token?.perProfile).toBe(false);
    expect(isPerProfileField(token!)).toBe(false);
  });

  it('drops malformed fields and unknown kinds', () => {
    const def = validateSettingsDef({
      fields: [
        { key: 'ok', label: 'Ok', kind: 'text' },
        { key: '', label: 'No key', kind: 'text' },
        { key: 'bad key!', label: 'Bad', kind: 'text' },
        { key: 'weird', label: 'Weird', kind: 'dropdown' },
        { key: 'ok', label: 'Duplicate', kind: 'text' },
        'not-an-object',
      ],
    });
    expect(def?.fields).toHaveLength(1);
    expect(def?.fields[0].key).toBe('ok');
  });

  it('returns undefined when nothing usable remains', () => {
    expect(validateSettingsDef(undefined)).toBeUndefined();
    expect(validateSettingsDef({})).toBeUndefined();
    expect(validateSettingsDef({ fields: [] })).toBeUndefined();
    expect(hasSettings(undefined)).toBe(false);
  });
});

describe('declaredDefaults', () => {
  it('applies per-field defaults, overridden by settings.defaults', () => {
    const def = validateSettingsDef(fixtureManifestSettings);
    // Fields without a `default` are simply absent until someone sets them.
    expect(declaredDefaults(def)).toEqual({
      greeting: 'hi',
      retries: 1,
      verbose: false,
      mode: 'fast',
    });
  });
});

describe('coerceSettings', () => {
  const { fields } = validateSettingsDef(fixtureManifestSettings)!;

  it('coerces every value through its own field definition', () => {
    const bag = coerceSettings(fields, {
      greeting: 42,
      retries: '9',
      verbose: 'false',
      mode: 'nope',
      tags: 'a, b\n c',
      token: 's3cret',
      cacheDir: 'C:/cache',
    });
    expect(bag.greeting).toBe('42');
    expect(bag.retries).toBe(5); // clamped to max
    expect(bag.verbose).toBe(false);
    expect(bag.mode).toBe('fast'); // unknown option falls back
    expect(bag.tags).toEqual(['a', 'b', 'c']);
    expect(bag.token).toBe('s3cret');
    expect(bag.cacheDir).toBe('C:/cache');
  });

  it('drops keys that have no field definition', () => {
    const bag = coerceSettings(fields, { invented: 'value' });
    expect(bag).not.toHaveProperty('invented');
  });
});

describe('profile override sanitizing', () => {
  const def = validateSettingsDef(fixtureManifestSettings);

  it('keeps only perProfile fields the extension declares', () => {
    const clean = sanitizeProfileOverrides(def, {
      greeting: 'yo',
      retries: 3,
      token: 'stolen',
      cacheDir: 'C:/secret-cache',
      invented: 'nope',
    });
    expect(clean).toEqual({ greeting: 'yo', retries: 3 });
  });

  it('drops malformed override objects entirely', () => {
    expect(sanitizeProfileOverrides(def, 'nope')).toBeUndefined();
    expect(sanitizeProfileOverrides(def, {})).toBeUndefined();
    expect(
      sanitizeProfileOverrides(undefined, { greeting: 'x' }),
    ).toBeUndefined();
  });

  it('sanitizes a whole toolSettings map keyed by extension id', () => {
    const clean = sanitizeToolSettings(
      {
        acme: { greeting: 'hi', token: 'nope' },
        unknown_ext: { anything: 'value' },
      },
      (extId) => (extId === 'acme' ? def : undefined),
    );
    expect(clean).toEqual({ acme: { greeting: 'hi' } });
  });
});

describe('mergeRuntimePatch', () => {
  const def = validateSettingsDef(fixtureManifestSettings);

  it('applies only declared, perProfile-permitted keys', () => {
    const { merged, applied } = mergeRuntimePatch(
      def,
      { greeting: 'hi', retries: 1 },
      { greeting: 'sup', retries: 99, token: 'nope', cacheDir: 'C:/x' },
    );
    expect(applied).toEqual(['greeting', 'retries']);
    expect(merged.greeting).toBe('sup');
    expect(merged.retries).toBe(5);
    expect(merged).not.toHaveProperty('token');
    expect(merged).not.toHaveProperty('cacheDir');
  });

  it('leaves the bag untouched for a malformed patch', () => {
    const { merged, applied } = mergeRuntimePatch(
      def,
      { greeting: 'hi' },
      null,
    );
    expect(applied).toEqual([]);
    expect(merged).toEqual({ greeting: 'hi' });
  });
});

describe('sameSettingValue', () => {
  it('compares primitives of every kind', () => {
    expect(sameSettingValue('fast', 'fast')).toBe(true);
    expect(sameSettingValue('fast', 'safe')).toBe(false);
    expect(sameSettingValue('', '')).toBe(true);
    expect(sameSettingValue(0, 0)).toBe(true);
    expect(sameSettingValue(false, false)).toBe(true);
    expect(sameSettingValue(false, true)).toBe(false);
  });

  it('compares string lists by content and order', () => {
    expect(sameSettingValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameSettingValue([], [])).toBe(true);
    expect(sameSettingValue(['a'], ['a', 'b'])).toBe(false);
    expect(sameSettingValue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameSettingValue(['a'], 'a')).toBe(false);
  });
});

describe('empty select options', () => {
  const def = validateSettingsDef({
    fields: [
      {
        key: 'timelimit',
        label: 'Time limit',
        kind: 'select',
        default: 'w',
        options: [
          { value: '', label: 'None (any time)' },
          { value: 'd', label: 'Past day' },
        ],
      },
      { key: 'sizes', label: 'Sizes', kind: 'select', options: ['', 'Small'] },
      { key: 'mode', label: 'Mode', kind: 'select', options: ['fast'] },
    ],
  });

  const valuesOf = (key: string): unknown[] =>
    findField(def, key)?.options?.map((o) =>
      typeof o === 'string' ? o : o.value,
    ) ?? [];

  it('keeps the empty option in either form it can be authored in', () => {
    expect(valuesOf('timelimit')).toEqual(['', 'd']);
    expect(valuesOf('sizes')).toEqual(['', 'Small']);
  });

  it('treats the empty option as a value, not as a missing one', () => {
    expect(coerceValue(findField(def, 'timelimit')!, '', 'w')).toBe('');
    // A field that does not offer an empty option still falls back.
    expect(coerceValue(findField(def, 'mode')!, '', 'fast')).toBe('fast');
  });
});

describe('optionLabel', () => {
  it('maps a stored value back to its authored display text', () => {
    const def = validateSettingsDef(fixtureManifestSettings)!;
    const mode = findField(def, 'mode')!;
    expect(optionLabel(mode, 'safe')).toBe('Safe');
    expect(optionLabel(mode, 'anything-else')).toBe('anything-else');
  });
});

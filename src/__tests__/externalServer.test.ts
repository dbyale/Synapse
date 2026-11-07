import {
  normalizeExternalServerUrl,
  isValidExternalServerUrl,
  externalServerSecretScope,
  EXTERNAL_API_KEY_SECRET_KEY,
} from '../shared/externalServer';

describe('normalizeExternalServerUrl', () => {
  it('accepts a full http URL and strips the trailing slash', () => {
    expect(normalizeExternalServerUrl('http://192.168.1.50:8080/')).toBe(
      'http://192.168.1.50:8080',
    );
  });

  it('accepts https URLs', () => {
    expect(normalizeExternalServerUrl('https://llm.example.com')).toBe(
      'https://llm.example.com',
    );
  });

  it('treats host:port shorthand as http', () => {
    expect(normalizeExternalServerUrl('192.168.1.50:8080')).toBe(
      'http://192.168.1.50:8080',
    );
    expect(normalizeExternalServerUrl('localhost')).toBe('http://localhost');
  });

  it('keeps an optional proxy base path but drops query/hash', () => {
    expect(
      normalizeExternalServerUrl('http://proxy.local:8080/llm/main/?x=1#frag'),
    ).toBe('http://proxy.local:8080/llm/main');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeExternalServerUrl('  http://host:1234  ')).toBe(
      'http://host:1234',
    );
  });

  it('rejects empty, malformed, and non-http inputs', () => {
    expect(normalizeExternalServerUrl('')).toBeNull();
    expect(normalizeExternalServerUrl('   ')).toBeNull();
    expect(normalizeExternalServerUrl('ftp://host:21')).toBeNull();
    expect(normalizeExternalServerUrl('http://')).toBeNull();
    expect(normalizeExternalServerUrl('not a url')).toBeNull();
  });

  it('isValidExternalServerUrl mirrors normalize', () => {
    expect(isValidExternalServerUrl('http://host:8080')).toBe(true);
    expect(isValidExternalServerUrl('ftp://x')).toBe(false);
    expect(isValidExternalServerUrl('')).toBe(false);
  });
});

describe('secret addressing', () => {
  it('scopes secrets per profile id', () => {
    expect(externalServerSecretScope('1732')).toBe('profile:1732');
    expect(EXTERNAL_API_KEY_SECRET_KEY).toBe('externalApiKey');
  });
});

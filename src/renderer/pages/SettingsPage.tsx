import { CSSProperties, useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2, Save } from 'lucide-react';
import type { AppSettings, ProfileSettings } from '../preload.d';

const s: Record<string, CSSProperties> = {
  page: {
    maxWidth: 700,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
  },
  heading: {
    fontSize: 24,
    fontWeight: 600,
  },
  card: {
    background: 'var(--bg-secondary)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 4,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    fontSize: 14,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
  profileTab: {
    padding: '8px 16px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  profileTabActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    fontWeight: 600,
  },
  saveBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 20px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 500,
    alignSelf: 'flex-start',
  },
  numberInput: {
    width: 120,
    padding: '10px 14px',
    fontSize: 14,
  },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeProfileKey, setActiveProfileKey] = useState('default');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const loaded = await window.electronAPI.loadSettings();
        setSettings(loaded);
        setActiveProfileKey(loaded.activeProfile);
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };

    load();
  }, []);

  if (!settings) return null;

  const profile = settings.profiles[activeProfileKey];

  const updateProfile = (updates: Partial<ProfileSettings>) => {
    setSettings({
      ...settings,
      profiles: {
        ...settings.profiles,
        [activeProfileKey]: { ...profile, ...updates },
      },
    });
  };

  const handlePickDirectory = async () => {
    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir) {
        updateProfile({ modelsDirectory: dir });
      }
    } catch (err) {
      console.error('Failed to pick directory:', err);
    }
  };

  const handleSave = async () => {
    try {
      const updated = { ...settings, activeProfile: activeProfileKey };
      await window.electronAPI.saveSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const addProfile = () => {
    const key = `profile_${Date.now()}`;
    setSettings({
      ...settings,
      profiles: {
        ...settings.profiles,
        [key]: {
          name: 'New Profile',
          modelsDirectory: profile.modelsDirectory,
          defaultModel: '',
          contextSize: 4096,
          gpuLayers: 0,
        },
      },
    });
    setActiveProfileKey(key);
  };

  const deleteProfile = () => {
    if (activeProfileKey === 'default') return;
    const updated = { ...settings.profiles };
    delete updated[activeProfileKey];
    setSettings({
      ...settings,
      profiles: updated,
      activeProfile: 'default',
    });
    setActiveProfileKey('default');
  };

  return (
    <div style={s.page}>
      <h1 style={s.heading}>Settings</h1>

      {/* Profile Selector */}
      <div style={s.card}>
        <div style={s.cardTitle}>Profiles</div>
        <div style={{ ...s.row, flexWrap: 'wrap' }}>
          {Object.entries(settings.profiles).map(([key, p]) => (
            <button
              type="button"
              key={key}
              style={{
                ...s.profileTab,
                ...(key === activeProfileKey ? s.profileTabActive : {}),
              }}
              onClick={() => setActiveProfileKey(key)}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            style={s.iconBtn}
            onClick={addProfile}
            title="Add profile"
          >
            <Plus size={16} />
          </button>
          {activeProfileKey !== 'default' && (
            <button
              type="button"
              style={{ ...s.iconBtn, color: '#f38ba8' }}
              onClick={deleteProfile}
              title="Delete profile"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Profile Settings */}
      <div style={s.card}>
        <div style={s.cardTitle}>Profile: {profile.name}</div>

        <div style={s.field}>
          <span style={s.label}>Profile Name</span>
          <input
            className="input-base"
            style={s.input}
            value={profile.name}
            onChange={(e) => updateProfile({ name: e.target.value })}
          />
        </div>

        <div style={s.field}>
          <span style={s.label}>Models Directory</span>
          <div style={s.row}>
            <input
              className="input-base"
              style={s.input}
              value={profile.modelsDirectory}
              readOnly
            />
            <button
              type="button"
              style={s.iconBtn}
              onClick={handlePickDirectory}
              title="Browse"
            >
              <FolderOpen size={16} />
            </button>
          </div>
        </div>

        <div style={s.field}>
          <span style={s.label}>Context Size</span>
          <input
            className="input-base"
            style={s.numberInput}
            type="number"
            min={512}
            max={131072}
            step={512}
            value={profile.contextSize}
            onChange={(e) =>
              updateProfile({
                contextSize: parseInt(e.target.value, 10) || 4096,
              })
            }
          />
        </div>

        <div style={s.field}>
          <span style={s.label}>GPU Layers</span>
          <input
            className="input-base"
            style={s.numberInput}
            type="number"
            min={0}
            max={100}
            value={profile.gpuLayers}
            onChange={(e) =>
              updateProfile({
                gpuLayers: parseInt(e.target.value, 10) || 0,
              })
            }
          />
        </div>
      </div>

      <button
        type="button"
        className="btn-accent"
        style={s.saveBtn}
        onClick={handleSave}
      >
        <Save size={16} />
        {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}

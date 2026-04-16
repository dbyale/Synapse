import {
  useState,
  useEffect,
  ReactNode,
  useMemo,
  useRef,
  DragEvent,
} from 'react';
import {
  Plus,
  Trash2,
  Check,
  Pencil,
  X,
  ChevronDown,
  Info,
  GripVertical,
} from 'lucide-react';
import type { LocalModel } from '../preload.d';
import { Profile } from '../types/profile';
import '../styles/ProfilesPage.css';

interface EditSectionProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  helper: string;
  tooltip: string[];
}

function EditSection({
  label,
  htmlFor,
  children,
  helper,
  tooltip,
}: EditSectionProps) {
  return (
    <div className="sp-card__edit-section">
      <div className="sp-card__label-row">
        <div className="sp-card__label-with-tooltip">
          <label htmlFor={htmlFor}>{label}</label>
          {tooltip.length > 0 && (
            <div className="sp-card__tooltip-wrapper">
              <Info size={14} className="sp-card__info-icon" />
              <div className="sp-card__tooltip">
                <div className="sp-card__tooltip-title">{label}</div>
                <ul className="sp-card__tooltip-list">
                  {tooltip.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
      {children}
      {helper && <small>{helper}</small>}
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen: boolean;
  tooltip: string[];
}

function CollapsibleSection({
  title,
  children,
  defaultOpen,
  tooltip,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="sp-card__collapsible">
      <button
        type="button"
        className={`sp-card__collapsible-header ${isOpen ? 'is-open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <ChevronDown
          size={16}
          className={`sp-card__collapsible-icon ${isOpen ? 'open' : ''}`}
        />
        <span>{title}</span>
        {tooltip.length > 0 && (
          <div className="sp-card__tooltip-wrapper">
            <Info size={14} className="sp-card__info-icon" />
            <div className="sp-card__tooltip">
              <div className="sp-card__tooltip-title">{title}</div>
              <ul className="sp-card__tooltip-list">
                {tooltip.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </button>
      {isOpen && <div className="sp-card__collapsible-content">{children}</div>}
    </div>
  );
}

// ── File group type (same as ModelsPage) ──
interface LocalFileGroup {
  id: string;
  quantization: string;
  isProjector: boolean;
  parts: LocalModel[];
  totalSize: number;
}

// ── Model group type (same as ModelsPage) ──
interface LocalModelGroup {
  name: string;
  fileGroups: LocalFileGroup[];
  totalSize: number;
}

// ── Helper to extract quantization from filename ──
function extractQuantizationFromFilename(filename: string): string {
  // Remove mmproj- prefix if present
  const cleanFilename = filename.replace(/^mmproj-/i, '');

  // Extract quantization suffix like -Q6_K, -f16, etc.
  const match = cleanFilename.match(
    /-(Q\d+_K|f\d+|Q\d+|I\d+|A\d+B)(?:\.gguf)?$/i,
  );
  return match ? match[1] : 'Unknown';
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNewProfile, setIsNewProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSystemPrompt, setEditSystemPrompt] = useState('');
  const [editTemperature, setEditTemperature] = useState('0.7');
  const [editTopK, setEditTopK] = useState('20');
  const [editTopP, setEditTopP] = useState('0.8');
  const [editMinP, setEditMinP] = useState('0.05');
  const [editSeed, setEditSeed] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editProjector, setEditProjector] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Profile[]>([]);
  const dragLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // ── Load profiles and local models on mount ──
  useEffect(() => {
    const stored = localStorage.getItem('profiles');
    if (stored) {
      try {
        const parsedProfiles = JSON.parse(stored) as Profile[];
        // Sort by order field, defaulting to creation order if not set
        const sortedProfiles = parsedProfiles.sort((a, b) => {
          const orderA = a.order ?? a.createdAt;
          const orderB = b.order ?? b.createdAt;
          return orderA - orderB;
        });
        setProfiles(sortedProfiles);
      } catch {
        // Silently fail on parse error
      }
    }

    const storedSelectedId = localStorage.getItem('selectedProfileId');
    if (storedSelectedId) {
      setSelectedProfileId(storedSelectedId);
    }

    // Load local models
    const loadLocalModels = async () => {
      try {
        const models = await window.electronAPI.listLocalModels();
        setLocalModels(models);
      } catch {
        // Silently fail on load error
      }
    };
    loadLocalModels();
  }, []);

  // Add inside ProfilesPage's useEffect (or a new one)
  useEffect(() => {
    const handleProfilesUpdated = () => {
      const stored = localStorage.getItem('profiles');
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Profile[];
          const sorted = parsed.sort(
            (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
          );
          setProfiles(sorted);
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('profiles-updated', handleProfilesUpdated);
    return () =>
      window.removeEventListener('profiles-updated', handleProfilesUpdated);
  }, []);

  // ── Persist to localStorage ──
  const saveProfiles = (updated: Profile[]) => {
    setProfiles(updated);
    localStorage.setItem('profiles', JSON.stringify(updated));
  };

  const handleNewProfile = () => {
    setError(null);
    const newProfile: Profile = {
      id: Date.now().toString(),
      name: 'New Profile',
      model: '',
      systemPrompt: 'You are a helpful assistant.',
      temperature: 0.7,
      topK: 20,
      topP: 0.8,
      minP: 0.05,
      seed: 0,
      order: Date.now(),
      createdAt: Date.now(),
    };

    const updated = [newProfile, ...profiles];
    saveProfiles(updated);
    setEditingId(newProfile.id);
    setIsNewProfile(true);
    setEditName(newProfile.name);
    setEditSystemPrompt(newProfile.systemPrompt);
    setEditTemperature(String(newProfile.temperature));
    setEditTopK(String(newProfile.topK));
    setEditTopP(String(newProfile.topP));
    setEditMinP(String(newProfile.minP));
    setEditSeed(String(newProfile.seed));
    setEditModel('');
    setEditProjector('');
  };

  const handleEdit = (profile: Profile) => {
    setError(null);
    setEditingId(profile.id);
    setIsNewProfile(false);
    setEditName(profile.name);
    setEditSystemPrompt(profile.systemPrompt);
    setEditTemperature(String(profile.temperature));
    setEditTopK(String(profile.topK));
    setEditTopP(String(profile.topP));
    setEditMinP(String(profile.minP));
    setEditSeed(String(profile.seed || 0));
    setEditModel(profile.model);
    setEditProjector(profile.projector || '');
  };

  const handleSaveEdit = () => {
    if (!editingId || !editName.trim() || !editModel) return;

    const selectedLocalModel = localModels.find(
      (m) => m.filename === editModel,
    );

    // Extract relative path from full filepath
    // filepath is like: /Volumes/X10/Models/Local/Qwen3_5-2B-Uncensored-HauhauCS-Aggressive/Qwen3.5-2B-Uncensored-HauhauCS-Aggressive-Q6_K.gguf
    // We want: Local/Qwen3_5-2B-Uncensored-HauhauCS-Aggressive/Qwen3.5-2B-Uncensored-HauhauCS-Aggressive-Q6_K.gguf (last 3 path segments)
    let modelRelativePath = editModel;
    if (selectedLocalModel?.filepath) {
      const pathParts = selectedLocalModel.filepath.split(/[/\\]/);
      const filename = pathParts.pop() || editModel;
      const subfolder = pathParts.pop() || '';
      const author = pathParts.pop() || '';
      modelRelativePath =
        author && subfolder
          ? `${author}/${subfolder}/${filename}`
          : subfolder
            ? `${subfolder}/${filename}`
            : filename;
    }

    // Same for projector
    let projectorRelativePath: string | undefined;
    if (editProjector) {
      const selectedProjector = localModels.find(
        (m) => m.filename === editProjector,
      );
      if (selectedProjector?.filepath) {
        const projParts = selectedProjector.filepath.split(/[/\\]/);
        const projFilename = projParts.pop() || editProjector;
        const projSubfolder = projParts.pop() || '';
        const projAuthor = projParts.pop() || '';
        projectorRelativePath =
          projAuthor && projSubfolder
            ? `${projAuthor}/${projSubfolder}/${projFilename}`
            : projSubfolder
              ? `${projSubfolder}/${projFilename}`
              : projFilename;
      } else {
        projectorRelativePath = editProjector;
      }
    }

    const updated = profiles.map((p) =>
      p.id === editingId
        ? {
            ...p,
            name: editName.trim(),
            systemPrompt: editSystemPrompt,
            temperature: parseFloat(editTemperature),
            topK: parseInt(editTopK, 10),
            topP: parseFloat(editTopP),
            minP: parseFloat(editMinP),
            seed: parseInt(editSeed, 10),
            model: modelRelativePath, // Store "Local/subfolder/filename.gguf"
            projector: projectorRelativePath || undefined,
          }
        : p,
    );
    saveProfiles(updated);
    setEditingId(null);
    setIsNewProfile(false);
    setError(null);
  };

  const handleCancelEdit = () => {
    // If canceling a new profile, delete it
    if (isNewProfile && editingId) {
      const updated = profiles.filter((p) => p.id !== editingId);
      saveProfiles(updated);
    }
    setEditingId(null);
    setIsNewProfile(false);
    setError(null);
  };

  const handleDelete = (id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    saveProfiles(updated);
    if (selectedProfileId === id) {
      setSelectedProfileId(null);
      localStorage.removeItem('selectedProfileId');
    }
    if (editingId === id) {
      setEditingId(null);
    }
  };

  const handleSelect = async (id: string) => {
    if (selectedProfileId === id) {
      setSelectedProfileId(null);
      localStorage.removeItem('selectedProfileId');
      setError(null);
      await window.electronAPI.chatUnload();
    } else {
      const profile = profiles.find((p) => p.id === id);
      if (profile) {
        setLoading(true);
        setError(null);
        try {
          const result = await window.electronAPI.chatLoadProfile(profile);
          if (result.success) {
            setSelectedProfileId(id);
            localStorage.setItem('selectedProfileId', id);
          } else {
            setError(
              `Failed to load profile: ${result.error || 'Unknown error'}`,
            );
          }
        } catch {
          setError('Error loading profile. Please try again.');
        } finally {
          setLoading(false);
        }
      }
    }
  };

  const handleModelChange = (filename: string) => {
    setEditModel(filename);
  };

  // ── Drag and drop handlers ──
  const handleDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    setDraggedId(id);
    setPreviewOrder(profiles);
    e.dataTransfer.effectAllowed = 'move';

    // Clear any pending drag leave timeout
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Clear any pending drag leave timeout when dragging over a card
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }

    if (!draggedId || draggedId === targetId) {
      return;
    }

    const draggedIndex = profiles.findIndex((p) => p.id === draggedId);
    const targetIndex = profiles.findIndex((p) => p.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const updated = [...profiles];
    const [draggedProfile] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedProfile);

    setPreviewOrder(updated);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Only reset if we're actually leaving the card element
    // (not just moving to a child element)
    if (e.currentTarget === e.target) {
      // Use a small timeout to avoid flickering when moving between cards
      dragLeaveTimeoutRef.current = setTimeout(() => {
        setPreviewOrder(profiles);
        dragLeaveTimeoutRef.current = null;
      }, 50);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();

    // Clear any pending drag leave timeout
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }

    if (!draggedId) {
      setDraggedId(null);
      setPreviewOrder([]);
      return;
    }

    // Allow dropping on the same card (it will just revert to original order)
    const draggedIndex =
      previewOrder.length > 0
        ? previewOrder.findIndex((p) => p.id === draggedId)
        : profiles.findIndex((p) => p.id === draggedId);

    const targetIndex =
      previewOrder.length > 0
        ? previewOrder.findIndex((p) => p.id === targetId)
        : profiles.findIndex((p) => p.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedId(null);
      setPreviewOrder([]);
      return;
    }

    // Use the preview order if it exists (the reordered state), otherwise use profiles
    const sourceArray = previewOrder.length > 0 ? previewOrder : profiles;
    const updated = [...sourceArray];
    const [draggedProfile] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedProfile);

    // Update order field for all profiles
    const reorderedProfiles = updated.map((p, idx) => ({
      ...p,
      order: idx,
    }));

    saveProfiles(reorderedProfiles);
    setDraggedId(null);
    setPreviewOrder([]);
  };

  const handleDragEnd = () => {
    // Clear any pending drag leave timeout
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }

    setDraggedId(null);
    setPreviewOrder([]);
  };

  // ── Group local models (same logic as ModelsPage) ──
  const groupedLocalModels = useMemo(() => {
    const mGroups = new Map<string, LocalModelGroup>();

    localModels.forEach((baseModel: LocalModel) => {
      const m = baseModel;

      const splitMatch = m.filename.match(
        /^(.*?)(?:-(\d{4,5})-of-(\d{4,5}))?\.gguf$/i,
      );
      const fileBaseName =
        splitMatch && splitMatch[2]
          ? splitMatch[1]
          : m.filename.replace(/\.gguf$/i, '');

      const modelName = m.generalName || fileBaseName;

      if (!mGroups.has(modelName)) {
        mGroups.set(modelName, {
          name: modelName,
          fileGroups: [],
          totalSize: 0,
        });
      }

      const mGroup = mGroups.get(modelName)!;

      let fGroup = mGroup.fileGroups.find((g) => g.id === fileBaseName);
      if (!fGroup) {
        fGroup = {
          id: fileBaseName,
          quantization: m.quantization || 'Unknown',
          isProjector: !!m.isProjector,
          parts: [],
          totalSize: 0,
        };
        mGroup.fileGroups.push(fGroup);
      }

      fGroup.parts.push(m);
      fGroup.totalSize += m.sizeBytes;
      mGroup.totalSize += m.sizeBytes;
    });

    mGroups.forEach((mg) => {
      mg.fileGroups.forEach((fg) => {
        fg.parts.sort((a, b) => a.filename.localeCompare(b.filename));
      });
      mg.fileGroups.sort((a, b) => {
        if (a.isProjector && !b.isProjector) return 1;
        if (!a.isProjector && b.isProjector) return -1;
        return a.id.localeCompare(b.id);
      });
    });

    return Array.from(mGroups.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [localModels]);

  // ── Get available models (non-projectors) ──
  const availableModelsForEdit = useMemo(() => {
    const models: Array<{
      filename: string;
      quantization: string;
      name: string;
    }> = [];
    groupedLocalModels.forEach((group) => {
      group.fileGroups.forEach((fg) => {
        if (!fg.isProjector) {
          fg.parts.forEach((part) => {
            models.push({
              filename: part.filename,
              quantization: fg.quantization,
              name: `${group.name} (${fg.quantization.toUpperCase()})`,
            });
          });
        }
      });
    });
    return models;
  }, [groupedLocalModels]);

  // ── Get available projectors for selected model ──
  const availableProjectorsForEdit = useMemo(() => {
    if (!editModel) return [];

    // Find the model group for the selected model
    let selectedGroup: LocalModelGroup | undefined;

    groupedLocalModels.forEach((group) => {
      if (selectedGroup) return;
      group.fileGroups.forEach((fg) => {
        if (selectedGroup) return;
        if (fg.parts.some((p) => p.filename === editModel)) {
          selectedGroup = group;
        }
      });
    });

    if (!selectedGroup) return [];

    // Find projectors with the same base name
    const projectors: Array<{
      filename: string;
      quantization: string;
      name: string;
    }> = [];
    selectedGroup.fileGroups.forEach((fg) => {
      if (fg.isProjector) {
        fg.parts.forEach((part) => {
          const displayQuantization = extractQuantizationFromFilename(
            part.filename,
          );
          projectors.push({
            filename: part.filename,
            quantization: displayQuantization,
            name: `MMPROJ (${displayQuantization.toUpperCase()})`,
          });
        });
      }
    });

    return projectors;
  }, [editModel, groupedLocalModels]);

  // ── Determine which list to display (preview or actual) ──
  const displayProfiles =
    draggedId && previewOrder.length > 0 ? previewOrder : profiles;

  return (
    <div className="sp-page">
      {/* Header */}
      <div className="sp-page__header">
        <div className="sp-page__header-text">
          <h1>Profiles</h1>
          <p>
            Create and manage profiles. Each profile contains a model, system
            prompt, and generation parameters. Select a profile to use it in
            chat.
          </p>
        </div>
        <button
          type="button"
          className="btn-accent"
          onClick={handleNewProfile}
          disabled={loading || availableModelsForEdit.length === 0}
          title={
            availableModelsForEdit.length === 0
              ? 'Download a model first'
              : 'Create a new profile'
          }
        >
          <Plus size={16} />
          New Profile
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="sp-page__error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="sp-page__error-close"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* No Models Warning */}
      {availableModelsForEdit.length === 0 && (
        <div className="sp-page__warning" role="status">
          <p>
            No models installed. Please download a model from the Models tab
            before creating a profile.
          </p>
        </div>
      )}

      {/* Content */}
      <div className="sp-page__content">
        {profiles.length === 0 ? (
          <div className="sp-page__empty">
            <p>No profiles yet.</p>
            <p>
              Click <strong>New Profile</strong> to create one.
            </p>
          </div>
        ) : (
          <div className="sp-page__list">
            {displayProfiles.map((profile) => {
              const isDragged = draggedId === profile.id;

              return (
                <div
                  key={profile.id}
                  className={`sp-card ${
                    selectedProfileId === profile.id ? 'sp-card--active' : ''
                  } ${isDragged ? 'sp-card--dragging' : ''}`}
                  draggable={editingId !== profile.id}
                  onDragStart={(e) => handleDragStart(e, profile.id)}
                  onDragOver={(e) => handleDragOver(e, profile.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, profile.id)}
                  onDragEnd={handleDragEnd}
                >
                  {editingId === profile.id ? (
                    /* ── Edit Mode ── */
                    <div className="sp-card__edit">
                      <EditSection
                        label="Profile Name"
                        htmlFor={`edit-name-${profile.id}`}
                        helper=""
                        tooltip={[]}
                      >
                        <input
                          id={`edit-name-${profile.id}`}
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Profile name..."
                          className="sp-card__edit-input"
                        />
                      </EditSection>

                      <EditSection
                        label="Model"
                        htmlFor={`edit-model-${profile.id}`}
                        helper=""
                        tooltip={[]}
                      >
                        {availableModelsForEdit.length === 0 ? (
                          <div className="sp-card__edit-empty">
                            No models available
                          </div>
                        ) : (
                          <select
                            id={`edit-model-${profile.id}`}
                            value={editModel}
                            onChange={(e) => handleModelChange(e.target.value)}
                            className="sp-card__edit-select"
                          >
                            <option value="">Select a model...</option>
                            {availableModelsForEdit.map((model) => (
                              <option
                                key={model.filename}
                                value={model.filename}
                              >
                                {model.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </EditSection>

                      {editModel && availableProjectorsForEdit.length > 0 && (
                        <EditSection
                          label="Projector (Optional)"
                          htmlFor={`edit-projector-${profile.id}`}
                          helper=""
                          tooltip={[
                            'Enables vision/image capabilities',
                            'Only available for compatible models',
                          ]}
                        >
                          <select
                            id={`edit-projector-${profile.id}`}
                            value={editProjector}
                            onChange={(e) => setEditProjector(e.target.value)}
                            className="sp-card__edit-select"
                          >
                            <option value="">None</option>
                            {availableProjectorsForEdit.map((projector) => (
                              <option
                                key={projector.filename}
                                value={projector.filename}
                              >
                                {projector.name}
                              </option>
                            ))}
                          </select>
                        </EditSection>
                      )}

                      <CollapsibleSection
                        title="System Prompt"
                        defaultOpen
                        tooltip={[
                          'Defines AI behavior and personality',
                          'Sent with every message',
                          'Guides how the model responds',
                        ]}
                      >
                        <div className="sp-card__collapsible-edit-section">
                          <textarea
                            id={`edit-prompt-${profile.id}`}
                            value={editSystemPrompt}
                            onChange={(e) =>
                              setEditSystemPrompt(e.target.value)
                            }
                            placeholder="Enter your system prompt here..."
                            className="sp-card__edit-textarea"
                            rows={6}
                          />
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection
                        title="Advanced Parameters"
                        defaultOpen={false}
                        tooltip={[]}
                      >
                        <div className="sp-card__edit-grid">
                          <EditSection
                            label="Temperature"
                            htmlFor={`edit-temp-${profile.id}`}
                            helper="Default: 0.7"
                            tooltip={[
                              'Controls how creative vs. predictable responses are',
                              '0 = always picks the most likely word (boring, repetitive)',
                              '0.7 = balanced',
                              '1.5+ = very creative and unpredictable',
                              'Higher for creative writing, lower for factual answers',
                            ]}
                          >
                            <input
                              id={`edit-temp-${profile.id}`}
                              type="number"
                              value={editTemperature}
                              onChange={(e) =>
                                setEditTemperature(e.target.value)
                              }
                              min="0"
                              max="2"
                              step="0.1"
                              className="sp-card__edit-input"
                            />
                          </EditSection>

                          <EditSection
                            label="Top K"
                            htmlFor={`edit-topk-${profile.id}`}
                            helper="Default: 20"
                            tooltip={[
                              'Limits choices to the K most likely next words',
                              'Only used when Temperature > 0',
                              '20 = pick from top 20 candidates',
                              '0 = disable (consider all words)',
                              'Higher = more variety, lower = more focused',
                            ]}
                          >
                            <input
                              id={`edit-topk-${profile.id}`}
                              type="number"
                              value={editTopK}
                              onChange={(e) => setEditTopK(e.target.value)}
                              min="0"
                              step="1"
                              className="sp-card__edit-input"
                            />
                          </EditSection>

                          <EditSection
                            label="Top P"
                            htmlFor={`edit-topp-${profile.id}`}
                            helper="Default: 0.8"
                            tooltip={[
                              'Picks words until reaching a probability threshold',
                              'Only used when Temperature > 0',
                              '0.8 = keep picking until 80% probability is reached',
                              '1 = disable (consider all words)',
                              'Lower = more focused, higher = more variety',
                            ]}
                          >
                            <input
                              id={`edit-topp-${profile.id}`}
                              type="number"
                              value={editTopP}
                              onChange={(e) => setEditTopP(e.target.value)}
                              min="0"
                              max="1"
                              step="0.05"
                              className="sp-card__edit-input"
                            />
                          </EditSection>

                          <EditSection
                            label="Min P"
                            htmlFor={`edit-minp-${profile.id}`}
                            helper="Default: 0.05"
                            tooltip={[
                              'Removes unlikely words to improve quality',
                              'Only used when Temperature > 0',
                              '0.05 = discard the worst 5% of word choices',
                              'Helps prevent weird or nonsensical outputs',
                              'Range: 0-1 (0 = disabled)',
                            ]}
                          >
                            <input
                              id={`edit-minp-${profile.id}`}
                              type="number"
                              value={editMinP}
                              onChange={(e) => setEditMinP(e.target.value)}
                              min="0"
                              max="1"
                              step="0.01"
                              className="sp-card__edit-input"
                            />
                          </EditSection>

                          <EditSection
                            label="Seed"
                            htmlFor={`edit-seed-${profile.id}`}
                            helper="Default: 0 (random)"
                            tooltip={[
                              'Makes responses reproducible',
                              'Only used when Temperature > 0',
                              '0 = different response every time',
                              'Same seed = identical outputs',
                              'Use when you need consistent behavior',
                            ]}
                          >
                            <input
                              id={`edit-seed-${profile.id}`}
                              type="number"
                              value={editSeed}
                              onChange={(e) => setEditSeed(e.target.value)}
                              min="0"
                              step="1"
                              className="sp-card__edit-input"
                            />
                          </EditSection>
                        </div>
                      </CollapsibleSection>

                      <div className="sp-card__edit-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleCancelEdit}
                          aria-label="Cancel editing"
                        >
                          <X size={14} />
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-accent"
                          onClick={handleSaveEdit}
                          disabled={!editName.trim() || !editModel}
                          aria-label="Save profile"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── View Mode ── */
                    <div className="sp-card__view">
                      <div className="sp-card__grip-handle">
                        <GripVertical
                          size={18}
                          className="sp-card__grip-icon"
                        />
                      </div>
                      <div className="sp-card__info">
                        <div className="sp-card__title-row">
                          <h3>{profile.name}</h3>
                          {selectedProfileId === profile.id && (
                            <span className="sp-card__active-badge">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="sp-card__model">
                          <strong>Model:</strong>{' '}
                          {profile.model.split(/[/\\]/).pop()}
                        </p>
                        <span className="sp-card__date">
                          Created{' '}
                          {new Date(profile.createdAt).toLocaleDateString(
                            undefined,
                            {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            },
                          )}
                        </span>
                      </div>

                      <div className="sp-card__actions">
                        <button
                          type="button"
                          className={`sp-card__select-btn ${
                            selectedProfileId === profile.id
                              ? 'sp-card__select-btn--active'
                              : ''
                          }`}
                          onClick={() => handleSelect(profile.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelect(profile.id);
                            }
                          }}
                          disabled={loading}
                          aria-label={
                            selectedProfileId === profile.id
                              ? `Deactivate profile ${profile.name}`
                              : `Activate profile ${profile.name}`
                          }
                        >
                          <Check size={15} />
                          {selectedProfileId === profile.id
                            ? 'Active'
                            : 'Set Active'}
                        </button>
                        <button
                          type="button"
                          className="sp-card__icon-btn"
                          onClick={() => handleEdit(profile)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleEdit(profile);
                            }
                          }}
                          aria-label={`Edit profile ${profile.name}`}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="sp-card__icon-btn sp-card__icon-btn--danger"
                          onClick={() => handleDelete(profile.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleDelete(profile.id);
                            }
                          }}
                          aria-label={`Delete profile ${profile.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

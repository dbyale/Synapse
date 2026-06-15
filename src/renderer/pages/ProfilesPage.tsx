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
  Loader2,
  PackageCheck,
  PackageMinus,
} from 'lucide-react';
import type { LocalModel } from '../preload.d';
import { Profile } from '../types/profile';
import { AVAILABLE_TOOLS, TOOL_METADATA } from '../../data/defaultTools';
import EditProfileModal from '../components/EditProfileModal';
import ConfirmDialog from '../components/ConfirmDialog';
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

interface ToolCategoryCardProps {
  category: string;
  toolKeys: string[];
  editTools: string[];
  onToolToggle: (toolKey: string) => void;
  onCategoryToggle: (toolKeys: string[]) => void;
}

function ToolCategoryCard({
  category,
  toolKeys,
  editTools,
  onToolToggle,
  onCategoryToggle,
}: ToolCategoryCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const enabledCount = toolKeys.filter((tk) => editTools.includes(tk)).length;
  const totalCount = toolKeys.length;
  const allEnabled = enabledCount === totalCount;

  const handleSelectAll = () => {
    if (allEnabled) {
      onCategoryToggle([]);
    } else {
      onCategoryToggle(toolKeys.filter((tk) => !editTools.includes(tk)));
    }
  };

  return (
    <div className="sp-card__category-card">
      <div
        className={`sp-card__category-header${isOpen ? ' open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
      >
        <ChevronDown
          size={18}
          className={`sp-card__category-chevron ${
            isOpen ? 'sp-card__category-chevron--open' : ''
          }`}
        />
        <span className="sp-card__category-name">{category}</span>
        <span
          className="sp-card__category-badge"
          onClick={(e) => {
            e.stopPropagation();
            handleSelectAll();
          }}
          role="button"
          tabIndex={0}
          title={allEnabled ? 'Deselect All' : 'Select All'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleSelectAll();
            }
          }}
        >
          {enabledCount} / {totalCount}
        </span>
      </div>

      {isOpen && (
        <div className="sp-card__category-content">
          <div className="sp-card__tools-list">
            {toolKeys.map((toolKey) => {
              const meta = TOOL_METADATA[toolKey as keyof typeof TOOL_METADATA];
              const checked = editTools.includes(toolKey);
              return (
                <label
                  key={toolKey}
                  htmlFor={toolKey}
                  className={`sp-card__tool-row ${
                    checked ? 'sp-card__tool-row--checked' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sp-card__tool-checkbox"
                    checked={checked}
                    onChange={() => onToolToggle(toolKey)}
                  />
                  <div className="sp-card__tool-info">
                    <span className="sp-card__tool-label">{meta.label}</span>
                    <span className="sp-card__tool-description">
                      {meta.description}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── File group type ──
interface LocalFileGroup {
  id: string;
  quantization: string;
  isProjector: boolean;
  parts: LocalModel[];
  totalSize: number;
}

// ── Model group type ──
interface LocalModelGroup {
  name: string;
  fileGroups: LocalFileGroup[];
  totalSize: number;
}

// ── Helper to extract quantization from filename ──
function extractQuantizationFromFilename(filename: string): string {
  const cleanFilename = filename.replace(/^mmproj-/i, '');
  const match = cleanFilename.match(
    /-?(Q\d+_K|F\d+|f\d+|Q\d+|q\d+|I\d+|A\d+B|BF\d+)(?:\.gguf)?$/i,
  );
  return match ? match[1].toUpperCase() : 'Unknown';
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Profile[]>([]);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [showEditRestartDialog, setShowEditRestartDialog] = useState(false);
  const [pendingEditProfiles, setPendingEditProfiles] = useState<Profile[] | null>(null);
  const dragLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // ── Load profiles and local models on mount ──
  useEffect(() => {
    const stored = localStorage.getItem('profiles');
    if (stored) {
      try {
        const parsedProfiles = JSON.parse(stored) as Profile[];
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

  // ── Persist to localStorage and notify ChatPage ──
  const saveProfiles = (updated: Profile[], suppressEvent = false) => {
    setProfiles(updated);
    localStorage.setItem('profiles', JSON.stringify(updated));
    if (!suppressEvent) {
      window.dispatchEvent(new Event('profiles-changed'));
    }
  };

  const handleNewProfile = () => {
    setError(null);
    setEditingProfile(null);
    setShowEditModal(true);
  };

  const handleEdit = (profile: Profile) => {
    setError(null);
    setEditingProfile(profile);
    setShowEditModal(true);
  };

  const handleDelete = (id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    saveProfiles(updated);
    if (selectedProfileId === id) {
      setSelectedProfileId(null);
      localStorage.removeItem('selectedProfileId');
    }
  };

  const handleSelect = async (id: string) => {
    if (selectedProfileId === id) {
      setSelectedProfileId(null);
      localStorage.removeItem('selectedProfileId');
      localStorage.removeItem('deferredProfileSwitch');
      setError(null);
      window.dispatchEvent(new Event('profiles-changed'));
    } else {
      const profile = profiles.find((p) => p.id === id);
      if (profile) {
        const isRunning = await window.electronAPI.chatIsRunning();
        const hasConv = await window.electronAPI.chatHasConversation();

        if (isRunning && hasConv) {
          setPendingSwitchId(id);
          setShowRestartDialog(true);
        } else {
          proceedProfileSwitch(id);
        }
      }
    }
  };

  const proceedProfileSwitch = (id: string) => {
    setSelectedProfileId(id);
    localStorage.setItem('selectedProfileId', id);
    localStorage.removeItem('deferredProfileSwitch');
    setError(null);
    window.dispatchEvent(new Event('profiles-changed'));
  };

  const handleRestartNow = () => {
    setShowRestartDialog(false);
    if (pendingSwitchId) {
      proceedProfileSwitch(pendingSwitchId);
      setPendingSwitchId(null);
    }
  };

  const handleKeepConversation = () => {
    setShowRestartDialog(false);
    if (pendingSwitchId) {
      setSelectedProfileId(pendingSwitchId);
      localStorage.setItem('selectedProfileId', pendingSwitchId);
      localStorage.setItem('deferredProfileSwitch', 'true');
      setError(null);
      setPendingSwitchId(null);
    }
  };

  const handleSaveProfile = async (updated: Profile[]) => {
    // If editing an existing profile that is the currently selected one,
    // check if a server restart dialog is needed
    if (editingProfile && editingProfile.id === selectedProfileId) {
      const isRunning = await window.electronAPI.chatIsRunning();
      const hasConv = await window.electronAPI.chatHasConversation();
      if (isRunning && hasConv) {
        setShowEditModal(false);
        setPendingEditProfiles(updated);
        setShowEditRestartDialog(true);
        return;
      }
    }
    finishSaveProfile(updated);
  };

  const finishSaveProfile = (updated: Profile[]) => {
    saveProfiles(updated);
    setShowEditModal(false);
    setEditingProfile(null);
    setError(null);
  };

  const handleEditRestartNow = () => {
    setShowEditRestartDialog(false);
    if (pendingEditProfiles) {
      const updated = pendingEditProfiles;
      setPendingEditProfiles(null);

      // Set flag so ChatPage knows to do a full reload
      if (selectedProfileId) {
        localStorage.setItem('forceProfileReload', selectedProfileId);
      }

      // Save and dispatch profiles-changed — triggers ChatPage reload via handleProfilesChanged
      saveProfiles(updated);

      setShowEditModal(false);
      setEditingProfile(null);
      setError(null);
    }
  };

  const handleEditKeepConversation = () => {
    setShowEditRestartDialog(false);
    if (pendingEditProfiles) {
      saveProfiles(pendingEditProfiles, true);
      setShowEditModal(false);
      setEditingProfile(null);
      setPendingEditProfiles(null);
      setError(null);
    }
  };

  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditingProfile(null);
    setError(null);
  };

  // ── Drag and drop handlers ──
  const handleDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    setDraggedId(id);
    setPreviewOrder(profiles);
    e.dataTransfer.effectAllowed = 'move';
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }
    if (!draggedId || draggedId === targetId) return;

    const draggedIndex = profiles.findIndex((p) => p.id === draggedId);
    const targetIndex = profiles.findIndex((p) => p.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const updated = [...profiles];
    const [draggedProfile] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedProfile);
    setPreviewOrder(updated);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target) {
      dragLeaveTimeoutRef.current = setTimeout(() => {
        setPreviewOrder(profiles);
        dragLeaveTimeoutRef.current = null;
      }, 50);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }
    if (!draggedId) {
      setDraggedId(null);
      setPreviewOrder([]);
      return;
    }

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

    const sourceArray = previewOrder.length > 0 ? previewOrder : profiles;
    const updated = [...sourceArray];
    const [draggedProfile] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedProfile);

    const reorderedProfiles = updated.map((p, idx) => ({ ...p, order: idx }));
    saveProfiles(reorderedProfiles);
    setDraggedId(null);
    setPreviewOrder([]);
  };

  const handleDragEnd = () => {
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current);
      dragLeaveTimeoutRef.current = null;
    }
    setDraggedId(null);
    setPreviewOrder([]);
  };

  // ── Group local models ──
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

  const modelSelectGroups = useMemo(() => {
    return groupedLocalModels
      .map((group) => {
        const variants = group.fileGroups
          .filter((fg) => !fg.isProjector)
          .flatMap((fg) =>
            fg.parts.map((part) => ({
              filename: part.filename,
              quantization: fg.quantization,
              sizeBytes: part.sizeBytes,
            })),
          );
        return variants.length > 0
          ? { name: group.name, totalSize: group.totalSize, variants }
          : null;
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [groupedLocalModels]);

  const categorizedTools = useMemo(() => {
    const categories: Record<string, string[]> = {};

    AVAILABLE_TOOLS.forEach((toolKey) => {
      const meta = TOOL_METADATA[toolKey];
      const category = meta.category || 'Uncategorized';

      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(toolKey);
    });

    return Object.entries(categories)
      .sort(([catA], [catB]) => catA.localeCompare(catB))
      .map(([category, toolKeys]) => ({ category, toolKeys }));
  }, []);

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
          disabled={loadingId !== null || availableModelsForEdit.length === 0}
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
              const isLoadingThis = loadingId === profile.id;

              return (
                <div
                  key={profile.id}
                  className={`sp-card ${
                    selectedProfileId === profile.id ? 'sp-card--active' : ''
                  } ${isDragged ? 'sp-card--dragging' : ''}`}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, profile.id)}
                  onDragOver={(e) => handleDragOver(e, profile.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, profile.id)}
                  onDragEnd={handleDragEnd}
                >
                  {(
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
                        {/* ── Tool badges (grouped by package/category) ── */}
                        {profile.tools &&
                          profile.tools.length > 0 &&
                          (() => {
                            const categoryMap: Record<
                              string,
                              { total: number; enabled: number }
                            > = {};

                            AVAILABLE_TOOLS.forEach((toolKey) => {
                              const meta =
                                TOOL_METADATA[
                                  toolKey as keyof typeof TOOL_METADATA
                                ];
                              const category = meta.category || 'Uncategorized';
                              if (!categoryMap[category]) {
                                categoryMap[category] = {
                                  total: 0,
                                  enabled: 0,
                                };
                              }
                              categoryMap[category].total += 1;
                              if ((profile.tools ?? []).includes(toolKey)) {
                                categoryMap[category].enabled += 1;
                              }
                            });

                            const activeCategories = Object.entries(categoryMap)
                              .filter(([, { enabled }]) => enabled > 0)
                              .sort(([a], [b]) => a.localeCompare(b));

                            return (
                              <div className="sp-card__tool-badges">
                                {activeCategories.map(
                                  ([category, { total, enabled }]) => (
                                    <span
                                      key={category}
                                      className="sp-card__tool-badge"
                                    >
                                      {enabled === total ? (
                                        <PackageCheck size={11} />
                                      ) : (
                                        <PackageMinus size={11} />
                                      )}
                                      {category}
                                    </span>
                                  ),
                                )}
                              </div>
                            );
                          })()}
                        <span className="sp-card__date">
                          Created{' '}
                          {new Date(profile.createdAt).toLocaleDateString(
                            undefined,
                            { year: 'numeric', month: 'short', day: 'numeric' },
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
                          } ${isLoadingThis ? 'sp-card__select-btn--loading' : ''}`}
                          onClick={() => handleSelect(profile.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelect(profile.id);
                            }
                          }}
                          disabled={loadingId !== null}
                          aria-label={
                            isLoadingThis
                              ? `Loading profile ${profile.name}`
                              : selectedProfileId === profile.id
                                ? `Deactivate profile ${profile.name}`
                                : `Activate profile ${profile.name}`
                          }
                        >
                          {isLoadingThis ? (
                            <>
                              <Loader2 size={15} className="sp-card__spinner" />
                              Loading...
                            </>
                          ) : selectedProfileId === profile.id ? (
                            <>
                              <Check size={15} />
                              Active
                            </>
                          ) : (
                            <>
                              <Check size={15} />
                              Set Active
                            </>
                          )}
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
                          disabled={loadingId !== null}
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
                          disabled={loadingId !== null}
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

      {showRestartDialog && (
        <ConfirmDialog
          title="Switch Profile?"
          message={`Switching to "${profiles.find((p) => p.id === pendingSwitchId)?.name ?? 'this profile'}" will restart the server and clear your current conversation.`}
          confirmText="Restart Now"
          cancelText="Cancel"
          onConfirm={handleRestartNow}
          onCancel={handleKeepConversation}
        />
      )}

      {showEditRestartDialog && (
        <ConfirmDialog
          title="Apply Profile Changes?"
          message={`Saving changes to "${editingProfile?.name ?? 'this profile'}" will restart the server and clear your current conversation.`}
          confirmText="Restart Now"
          cancelText="Restart Later"
          onConfirm={handleEditRestartNow}
          onCancel={handleEditKeepConversation}
        />
      )}

      {showEditModal && (
        <EditProfileModal
          profile={editingProfile}
          profiles={profiles}
          localModels={localModels}
          modelSelectGroups={modelSelectGroups}
          availableModelsForEdit={availableModelsForEdit}
          groupedLocalModels={groupedLocalModels}
          categorizedTools={categorizedTools}
          onSave={handleSaveProfile}
          onClose={handleCancelEdit}
        />
      )}
    </div>
  );
}

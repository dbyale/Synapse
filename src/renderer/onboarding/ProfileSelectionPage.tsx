import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  HardDrive,
} from 'lucide-react';
import type { LocalModel } from '../preload.d';
import {
  buildSelection,
  getCategoriesForSelection,
  getDownloadGroups,
  getDownloadKey,
  getOptionDownloads,
  getUniqueDownloads,
  isDownloadInstalled,
  type DownloadGroup,
  type DownloadTarget,
  type OnboardingProfileSelection,
} from './profileCatalog';
import getCategoryIcon from './categoryIcons';
import { useDownloadSizes } from './downloadSizes';
import { formatGB, formatGBTruncated } from '../utils/formatters';

interface ProfileSelectionPageProps {
  professionIds: string[];
  selectedOptionIds: string[];
  onSelectedOptionIdsChange: (optionIds: string[]) => void;
  requireSelection: boolean;
  onBack: () => void;
  onContinue: (selection: OnboardingProfileSelection) => void;
}

function getPendingGroupBytes(
  group: DownloadGroup,
  installedKeys: Set<string>,
  sizes: Map<string, number>,
): number {
  let totalBytes = 0;
  if (!installedKeys.has(getDownloadKey(group.model))) {
    totalBytes += sizes.get(getDownloadKey(group.model)) ?? 0;
  }
  if (group.projector && !installedKeys.has(getDownloadKey(group.projector))) {
    totalBytes += sizes.get(getDownloadKey(group.projector)) ?? 0;
  }
  return totalBytes;
}

function getTargetSizeLabel(
  target: DownloadTarget,
  sizes: Map<string, number>,
  loading: boolean,
): string {
  const size = sizes.get(getDownloadKey(target));
  if (size !== undefined) return formatGB(size);
  return loading ? 'Calculating…' : 'Size unavailable';
}

function getOptionCost(
  targets: readonly DownloadTarget[],
  installedKeys: Set<string>,
  selectedKeys: Set<string>,
  sizes: Map<string, number>,
): { knownBytes: number; unknownCount: number } {
  let knownBytes = 0;
  let unknownCount = 0;
  targets.forEach((target) => {
    const key = getDownloadKey(target);
    if (installedKeys.has(key) || selectedKeys.has(key)) return;
    const size = sizes.get(key);
    if (size !== undefined) {
      knownBytes += size;
    } else {
      unknownCount += 1;
    }
  });
  return { knownBytes, unknownCount };
}

function getTotalLabel(
  total: { knownBytes: number; unknownCount: number },
  loading: boolean,
): string {
  if (total.unknownCount === 0) return formatGBTruncated(total.knownBytes);
  if (loading) return 'Calculating…';
  if (total.knownBytes > 0) return `~${formatGBTruncated(total.knownBytes)}`;
  return 'Size unavailable';
}

function getCostLabel(
  cost: { knownBytes: number; unknownCount: number },
  loading: boolean,
): string {
  if (cost.unknownCount === 0) {
    return `+${formatGBTruncated(cost.knownBytes)}`;
  }
  if (loading) return 'Calculating…';
  if (cost.knownBytes > 0) return `~+${formatGBTruncated(cost.knownBytes)}`;
  return 'Size unavailable';
}

export default function ProfileSelectionPage({
  professionIds,
  selectedOptionIds,
  onSelectedOptionIdsChange,
  requireSelection,
  onBack,
  onContinue,
}: ProfileSelectionPageProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);

  const categories = useMemo(
    () => getCategoriesForSelection(professionIds),
    [professionIds],
  );
  const allOptionIds = useMemo(
    () =>
      categories.flatMap((category) =>
        category.options.map((option) => option.id),
      ),
    [categories],
  );
  const allDownloads = useMemo(
    () => getUniqueDownloads(allOptionIds),
    [allOptionIds],
  );
  const { sizes, loading: sizesLoading } = useDownloadSizes(allDownloads);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .listLocalModels()
      .then((models) => {
        if (!cancelled) setLocalModels(models);
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const installedDownloadKeys = useMemo(() => {
    const keys = new Set<string>();
    categories.forEach((category) => {
      category.options.forEach((option) => {
        getOptionDownloads(option).forEach((target) => {
          if (isDownloadInstalled(target, localModels)) {
            keys.add(getDownloadKey(target));
          }
        });
      });
    });
    return keys;
  }, [categories, localModels]);

  const visibleOptionIds = useMemo(
    () =>
      new Set(
        categories.flatMap((category) =>
          category.options.map((option) => option.id),
        ),
      ),
    [categories],
  );

  const selected = useMemo(
    () =>
      new Set(
        selectedOptionIds.filter((optionId) => visibleOptionIds.has(optionId)),
      ),
    [selectedOptionIds, visibleOptionIds],
  );
  const downloadGroups = useMemo(
    () => getDownloadGroups(Array.from(selected)),
    [selected],
  );
  const pendingGroupBytes = useMemo(() => {
    const bytes = new Map<string, number>();
    downloadGroups.forEach((group) => {
      bytes.set(
        group.id,
        getPendingGroupBytes(group, installedDownloadKeys, sizes),
      );
    });
    return bytes;
  }, [downloadGroups, installedDownloadKeys, sizes]);
  const selectedDownloadKeys = useMemo(
    () =>
      new Set(
        getUniqueDownloads(Array.from(selected)).map((target) =>
          getDownloadKey(target),
        ),
      ),
    [selected],
  );
  const total = useMemo(() => {
    let knownBytes = 0;
    let unknownCount = 0;
    downloadGroups.forEach((group) => {
      const targets = group.projector
        ? [group.model, group.projector]
        : [group.model];
      targets.forEach((target) => {
        const key = getDownloadKey(target);
        if (installedDownloadKeys.has(key)) return;
        const size = sizes.get(key);
        if (size !== undefined) {
          knownBytes += size;
        } else {
          unknownCount += 1;
        }
      });
    });
    return { knownBytes, unknownCount };
  }, [downloadGroups, installedDownloadKeys, sizes]);
  const totalLabel = getTotalLabel(total, sizesLoading);
  const sortedDownloadGroups = useMemo(
    () =>
      [...downloadGroups].sort(
        (a, b) =>
          (pendingGroupBytes.get(a.id) ?? 0) -
          (pendingGroupBytes.get(b.id) ?? 0),
      ),
    [downloadGroups, pendingGroupBytes],
  );
  const selectedCount = selected.size;
  const needsSelection = requireSelection && selectedCount === 0;

  const toggleOption = (optionId: string) => {
    const next = new Set(selected);
    if (next.has(optionId)) {
      next.delete(optionId);
    } else {
      next.add(optionId);
    }
    onSelectedOptionIdsChange(Array.from(next));
  };

  const handleContinue = () => {
    onContinue(buildSelection(professionIds, Array.from(selected)));
  };

  return (
    <div className="onb-page onb-profile-selection-page">
      <button
        type="button"
        aria-label="Back to professions"
        className="onb-back-arrow onb-rise"
        onClick={onBack}
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      <div className="onb-profile-selection">
        <header className="onb-profile-selection-header onb-rise">
          <div className="onb-profile-selection-heading">
            <h1 className="onb-profile-selection-title">
              Choose your assistants
            </h1>
            <p className="onb-profile-selection-text">
              Pick one or more setups for each area you need. Every option is
              tuned for a different balance of speed, quality, and hardware, so
              you can choose what fits your computer.
            </p>
          </div>
          <span
            className={`onb-profile-selection-count${
              selectedCount > 0 ? ' onb-profile-selection-count--active' : ''
            }`}
          >
            {selectedCount === 0
              ? 'No options selected'
              : `${selectedCount} option${
                  selectedCount === 1 ? '' : 's'
                } selected`}
          </span>
        </header>

        <div className="onb-category-grid">
          {categories.map((category, categoryIndex) => {
            const CategoryIcon = getCategoryIcon(category.id);
            const categorySelectedCount = category.options.filter((option) =>
              selected.has(option.id),
            ).length;

            return (
              <section
                key={category.id}
                className={`onb-category onb-rise onb-delay-${
                  (categoryIndex % 4) + 1
                }`}
              >
                <div className="onb-category-header">
                  <span className="onb-category-icon">
                    <CategoryIcon size={20} strokeWidth={2} />
                  </span>
                  <div className="onb-category-heading">
                    <div className="onb-category-title-row">
                      <h2 className="onb-category-title">{category.name}</h2>
                      <span
                        className={`onb-category-status${
                          categorySelectedCount > 0
                            ? ' onb-category-status--active'
                            : ''
                        }`}
                      >
                        {categorySelectedCount > 0
                          ? `${categorySelectedCount} selected`
                          : 'Choose any'}
                      </span>
                    </div>
                    <p className="onb-category-desc">{category.description}</p>
                  </div>
                </div>

                <div className="onb-category-options">
                  {category.options.map((option) => {
                    const isSelected = selected.has(option.id);
                    const optionDownloads = getOptionDownloads(option);
                    const isInstalled =
                      optionDownloads.length > 0 &&
                      optionDownloads.every((target) =>
                        installedDownloadKeys.has(getDownloadKey(target)),
                      );
                    const additional = isSelected
                      ? { knownBytes: 0, unknownCount: 0 }
                      : getOptionCost(
                          optionDownloads,
                          installedDownloadKeys,
                          selectedDownloadKeys,
                          sizes,
                        );
                    const costLabel = getCostLabel(additional, sizesLoading);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={isSelected}
                        className={`onb-category-option${
                          isSelected ? ' onb-category-option--selected' : ''
                        }`}
                        onClick={() => toggleOption(option.id)}
                      >
                        <span
                          className="onb-category-option-radio"
                          aria-hidden="true"
                        >
                          {isSelected && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span className="onb-category-option-body">
                          <span className="onb-category-option-title-row">
                            <span className="onb-category-option-name">
                              {option.name}
                            </span>
                            {option.recommended && (
                              <span className="onb-category-option-badge">
                                Recommended
                              </span>
                            )}
                          </span>
                          <span className="onb-category-option-desc">
                            {option.description}
                          </span>
                        </span>
                        {isInstalled ? (
                          <span className="onb-category-option-cost onb-category-option-cost--installed">
                            Installed
                          </span>
                        ) : (
                          !isSelected && (
                            <span
                              className={`onb-category-option-cost${
                                additional.unknownCount === 0 &&
                                additional.knownBytes === 0
                                  ? ' onb-category-option-cost--free'
                                  : ''
                              }`}
                            >
                              {costLabel}
                            </span>
                          )
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="onb-selection-summary onb-rise onb-delay-4">
          <button
            type="button"
            className="onb-selection-total"
            aria-expanded={showBreakdown}
            disabled={downloadGroups.length === 0}
            onClick={() => setShowBreakdown((current) => !current)}
          >
            <HardDrive size={15} strokeWidth={2} />
            <span>Total Download:</span>
            <strong>{totalLabel}</strong>
            <span className="onb-selection-total-chevron" aria-hidden="true">
              {showBreakdown ? (
                <ChevronUp size={15} strokeWidth={2} />
              ) : (
                <ChevronDown size={15} strokeWidth={2} />
              )}
            </span>
          </button>

          {showBreakdown && downloadGroups.length > 0 && (
            <div className="onb-selection-breakdown">
              {sortedDownloadGroups.map((group) => {
                const modelInstalled = installedDownloadKeys.has(
                  getDownloadKey(group.model),
                );
                const projectorInstalled = group.projector
                  ? installedDownloadKeys.has(getDownloadKey(group.projector))
                  : false;
                return (
                  <div key={group.id} className="onb-selection-breakdown-group">
                    <div className="onb-selection-breakdown-row">
                      <span className="onb-selection-breakdown-name">
                        {group.modelName}
                      </span>
                      <span
                        className={`onb-selection-breakdown-size${
                          modelInstalled
                            ? ' onb-selection-breakdown-size--installed'
                            : ''
                        }`}
                      >
                        {modelInstalled
                          ? 'Installed'
                          : getTargetSizeLabel(
                              group.model,
                              sizes,
                              sizesLoading,
                            )}
                      </span>
                    </div>
                    {group.projector && (
                      <div className="onb-selection-breakdown-row onb-selection-breakdown-row--sub">
                        <span className="onb-selection-breakdown-name">
                          {group.modelName} projector
                        </span>
                        <span
                          className={`onb-selection-breakdown-size${
                            projectorInstalled
                              ? ' onb-selection-breakdown-size--installed'
                              : ''
                          }`}
                        >
                          {projectorInstalled
                            ? 'Installed'
                            : getTargetSizeLabel(
                                group.projector,
                                sizes,
                                sizesLoading,
                              )}
                        </span>
                      </div>
                    )}
                    <div className="onb-selection-breakdown-used">
                      {group.categories
                        .map((category) => category.categoryName)
                        .join(' + ')}
                    </div>
                  </div>
                );
              })}
              <div className="onb-selection-breakdown-total">
                <span>Total</span>
                <span>{totalLabel}</span>
              </div>
            </div>
          )}
        </div>

        <div className="onb-profile-selection-footer onb-rise onb-delay-4">
          <button
            type="button"
            className="onb-continue"
            onClick={handleContinue}
            disabled={needsSelection}
          >
            Continue
            <ArrowRight size={20} strokeWidth={2} />
          </button>
          {needsSelection && (
            <p className="onb-continue-reason">
              Select at least one option to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

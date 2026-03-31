import React, { useRef, useEffect, useState } from 'react';
import { Tag, Globe, Check, ChevronDown, Package, X } from 'lucide-react';
import type { Language } from '../../../data/languages';
import type { PipelineTagOption } from '../../../data/pipelineTags';
import { LANGUAGES } from '../../../data/languages';
import { PIPELINE_TAGS } from '../../../data/pipelineTags';

// ============================================================================
// SINGLE FILTER DROPDOWN
// ============================================================================
interface FilterDropdownProps {
  icon: React.ReactNode;
  label: string;
  activeLabel: string | null;
  onClear: () => void;
  children: React.ReactNode;
  hasSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
}

function FilterDropdown({
  icon,
  label,
  activeLabel,
  onClear,
  children,
  hasSearch,
  searchValue,
  onSearchChange,
  searchPlaceholder,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && hasSearch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open, hasSearch]);

  const isActive = activeLabel !== null;

  if (isActive) {
    return (
      <span className="filter-chip--active">
        {icon}
        {activeLabel}
        <button type="button" className="filter-chip__remove" onClick={onClear}>
          <X size={12} />
        </button>
      </span>
    );
  }

  return (
    <div className="filter-dropdown" ref={ref}>
      <button
        type="button"
        className={`filter-dropdown__trigger ${open ? 'filter-dropdown__trigger--open' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {label}
        <ChevronDown
          size={12}
          className={`filter-dropdown__chevron ${open ? 'filter-dropdown__chevron--open' : ''}`}
        />
      </button>

      {open && (
        <div className="filter-dropdown__panel">
          {hasSearch && onSearchChange && (
            <input
              ref={inputRef}
              className="filter-dropdown__search"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          )}
          {children}
        </div>
      )}
    </div>
  );
}

FilterDropdown.defaultProps = {
  hasSearch: false,
  searchValue: '',
  onSearchChange: undefined,
  searchPlaceholder: 'Search...',
};

// ============================================================================
// FILTER BAR
// ============================================================================
interface ModelFilterPanelProps {
  selectedLanguage: string | null;
  selectedPipeline: string | null;
  onLanguageSelect: (code: string | null) => void;
  onPipelineSelect: (tag: string | null) => void;
}

export default function ModelFilterPanel({
  selectedLanguage,
  selectedPipeline,
  onLanguageSelect,
  onPipelineSelect,
}: ModelFilterPanelProps) {
  const [langSearch, setLangSearch] = useState('');

  const filteredLanguages = LANGUAGES.filter(
    (l: Language) =>
      l.label.toLowerCase().includes(langSearch.toLowerCase()) ||
      l.code.toLowerCase().includes(langSearch.toLowerCase()),
  );

  const activePipelineLabel = selectedPipeline
    ? (PIPELINE_TAGS.find((p: PipelineTagOption) => p.id === selectedPipeline)
        ?.label ?? selectedPipeline)
    : null;

  const activeLanguageLabel = selectedLanguage
    ? (LANGUAGES.find((l: Language) => l.code === selectedLanguage)?.label ??
      selectedLanguage)
    : null;

  return (
    <div className="filter-bar">
      {/* Fixed GGUF chip */}
      <span className="filter-chip--fixed">
        <Package size={12} /> GGUF
      </span>

      {/* Pipeline Tag dropdown */}
      <FilterDropdown
        icon={<Tag size={12} />}
        label="Pipeline"
        activeLabel={activePipelineLabel}
        onClear={() => onPipelineSelect(null)}
      >
        {PIPELINE_TAGS.map((pt: PipelineTagOption) => (
          <button
            type="button"
            key={pt.id}
            className={`filter-dropdown__item ${selectedPipeline === pt.id ? 'filter-dropdown__item--active' : ''}`}
            onClick={() => onPipelineSelect(pt.id)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ opacity: 0.7, display: 'flex' }}>
                <pt.icon size={14} />
              </span>
              {pt.label}
            </span>
            {selectedPipeline === pt.id && (
              <Check size={14} style={{ color: 'var(--accent)' }} />
            )}
          </button>
        ))}
      </FilterDropdown>

      {/* Language dropdown */}
      <FilterDropdown
        icon={<Globe size={12} />}
        label="Language"
        activeLabel={activeLanguageLabel}
        onClear={() => onLanguageSelect(null)}
        hasSearch
        searchValue={langSearch}
        onSearchChange={setLangSearch}
        searchPlaceholder="Search languages..."
      >
        {filteredLanguages.map((lang: Language) => (
          <button
            type="button"
            key={lang.code}
            className={`filter-dropdown__item ${selectedLanguage === lang.code ? 'filter-dropdown__item--active' : ''}`}
            onClick={() => onLanguageSelect(lang.code)}
          >
            <span>
              {lang.label}
              <span className="filter-dropdown__item-code">({lang.code})</span>
            </span>
            {selectedLanguage === lang.code && (
              <Check size={14} style={{ color: 'var(--accent)' }} />
            )}
          </button>
        ))}
      </FilterDropdown>
    </div>
  );
}

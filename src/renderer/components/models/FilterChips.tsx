import React from 'react';
import { Package, Tag, Globe, X } from 'lucide-react';
import type { Language } from '../../../data/languages';
import type { PipelineTagOption } from '../../../data/pipelineTags';
import { LANGUAGES } from '../../../data/languages';
import { PIPELINE_TAGS } from '../../../data/pipelineTags';

interface FilterChipsProps {
  selectedPipeline: string | null;
  selectedLanguage: string | null;
  onPipelineClear: () => void;
  onLanguageClear: () => void;
}

export default function FilterChips({
  selectedPipeline,
  selectedLanguage,
  onPipelineClear,
  onLanguageClear,
}: FilterChipsProps) {
  return (
    <div className="filter-chips-row">
      <span className="filter-chip--fixed">
        <Package size={12} /> GGUF
      </span>

      {selectedPipeline && (
        <span className="filter-chip">
          <Tag size={12} />
          {PIPELINE_TAGS.find(
            (p: PipelineTagOption) => p.id === selectedPipeline,
          )?.label ?? selectedPipeline}
          <button
            type="button"
            className="filter-chip__remove"
            onClick={onPipelineClear}
          >
            <X size={12} />
          </button>
        </span>
      )}

      {selectedLanguage && (
        <span className="filter-chip">
          <Globe size={12} />
          {LANGUAGES.find((l: Language) => l.code === selectedLanguage)
            ?.label ?? selectedLanguage}
          <button
            type="button"
            className="filter-chip__remove"
            onClick={onLanguageClear}
          >
            <X size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

import React from 'react';
import { Trash2 } from 'lucide-react';
import type { LocalModel } from '../../preload.d';
import { formatBytes } from '../../utils/formatters';

interface LocalModelCardProps {
  model: LocalModel;
  onDelete: (filename: string) => void;
}

export default function LocalModelCard({
  model,
  onDelete,
}: LocalModelCardProps) {
  return (
    <div className="local-card">
      <div className="local-card__info">
        <span className="local-card__name">{model.filename}</span>
        <span className="local-card__size">{formatBytes(model.sizeBytes)}</span>
      </div>
      <button
        type="button"
        className="local-card__delete"
        onClick={() => onDelete(model.filename)}
        title="Delete model"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

import React, { useState } from 'react';
import { X, Plus, Upload, Trash2 } from 'lucide-react';

interface AddLocalModelModalProps {
  onClose: () => void;
  onAdd: (
    name: string,
    author: string,
    modelPaths: string[],
    projectorPaths: string[],
  ) => Promise<void>;
}

const GGUF_FILTER = [{ name: 'GGUF Models', extensions: ['gguf'] }];

export default function AddLocalModelModal({
  onClose,
  onAdd,
}: AddLocalModelModalProps) {
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [modelPaths, setModelPaths] = useState<string[]>([]);
  const [projectorPaths, setProjectorPaths] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Native file picker via Electron dialog ──────────────────────────────
  const browseModels = async () => {
    try {
      setError(null);
      const paths = await window.electronAPI.browseForFiles({
        title: 'Select Model File(s)',
        filters: GGUF_FILTER,
        multiSelections: true,
      });

      if (paths && paths.length > 0) {
        setModelPaths((prev) => {
          const newPaths = paths.filter((p) => !prev.includes(p));
          return [...prev, ...newPaths];
        });

        // Auto-fill name from first file if still empty
        if (!name.trim()) {
          const basename = paths[0].split(/[\\/]/).pop() ?? '';
          setName(basename.replace(/\.gguf$/i, ''));
        }

        // Auto-fill author if still empty
        if (!author.trim()) {
          setAuthor('Local');
        }
      }
    } catch (err) {
      console.error('Browse models error:', err);
      setError('Failed to browse for files');
    }
  };

  const browseProjectors = async () => {
    try {
      setError(null);
      const paths = await window.electronAPI.browseForFiles({
        title: 'Select Projector File(s)',
        filters: GGUF_FILTER,
        multiSelections: true,
      });

      if (paths && paths.length > 0) {
        setProjectorPaths((prev) => {
          const newPaths = paths.filter((p) => !prev.includes(p));
          return [...prev, ...newPaths];
        });
      }
    } catch (err) {
      console.error('Browse projectors error:', err);
      setError('Failed to browse for files');
    }
  };

  const removeModel = (p: string) =>
    setModelPaths((prev) => prev.filter((x) => x !== p));

  const removeProjector = (p: string) =>
    setProjectorPaths((prev) => prev.filter((x) => x !== p));

  const filename = (p: string) => p.split(/[\\/]/).pop() ?? p;

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Model name is required');
      return;
    }

    if (!author.trim()) {
      setError('Author is required');
      return;
    }

    if (modelPaths.length === 0) {
      setError('At least one model file is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await onAdd(name.trim(), author.trim(), modelPaths, projectorPaths);
      // Reset form on success
      setName('');
      setAuthor('');
      setModelPaths([]);
      setProjectorPaths([]);
      onClose();
    } catch (err: any) {
      console.error('Add model error:', err);
      setError(err.message || 'Failed to add model');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid =
    name.trim().length > 0 && author.trim().length > 0 && modelPaths.length > 0;

  return (
    <div className="alm-overlay" onClick={onClose}>
      <div
        className="alm-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="alm-title"
      >
        {/* Header */}
        <div className="alm-header">
          <h2 id="alm-title" className="alm-title">
            Add Local Model
          </h2>
          <button
            type="button"
            className="alm-close"
            onClick={onClose}
            aria-label="Close"
            disabled={isSubmitting}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="alm-body">
          {/* Error message */}
          {error && (
            <div className="alm-error">
              <span>{error}</span>
            </div>
          )}

          {/* Author */}
          <div className="alm-field">
            <label className="alm-label" htmlFor="alm-author">
              Author <span className="alm-required">*</span>
            </label>
            <input
              id="alm-author"
              className="input-base alm-input"
              placeholder="e.g. Local, MyOrg"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Name */}
          <div className="alm-field">
            <label className="alm-label" htmlFor="alm-name">
              Model Name <span className="alm-required">*</span>
            </label>
            <input
              id="alm-name"
              className="input-base alm-input"
              placeholder="e.g. My Fine-tuned Llama"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          {/* Model Files */}
          <div className="alm-field">
            <label className="alm-label">
              Model File(s) <span className="alm-required">*</span>
              <span className="alm-hint">.gguf</span>
            </label>
            <button
              type="button"
              className="alm-upload-btn"
              onClick={browseModels}
              disabled={isSubmitting}
            >
              <Upload size={14} /> Choose File(s)
            </button>
            {modelPaths.length > 0 && (
              <ul className="alm-file-list">
                {modelPaths.map((p) => (
                  <li key={p} className="alm-file-item">
                    <span className="alm-file-name" title={p}>
                      {filename(p)}
                    </span>
                    <button
                      type="button"
                      className="alm-file-remove"
                      onClick={() => removeModel(p)}
                      disabled={isSubmitting}
                      aria-label={`Remove ${filename(p)}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Projector Files */}
          <div className="alm-field">
            <label className="alm-label">
              Projector(s)
              <span className="alm-hint">optional · mmproj .gguf</span>
            </label>
            <button
              type="button"
              className="alm-upload-btn"
              onClick={browseProjectors}
              disabled={isSubmitting}
            >
              <Upload size={14} /> Choose Projector(s)
            </button>
            {projectorPaths.length > 0 && (
              <ul className="alm-file-list">
                {projectorPaths.map((p) => (
                  <li key={p} className="alm-file-item">
                    <span className="alm-file-name" title={p}>
                      {filename(p)}
                    </span>
                    <button
                      type="button"
                      className="alm-file-remove"
                      onClick={() => removeProjector(p)}
                      disabled={isSubmitting}
                      aria-label={`Remove ${filename(p)}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="alm-footer">
            <button
              type="button"
              className="alm-btn alm-btn--cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="alm-btn alm-btn--submit btn-accent"
              disabled={!isValid || isSubmitting}
            >
              {isSubmitting ? (
                'Adding...'
              ) : (
                <>
                  <Plus size={15} /> Add Model
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

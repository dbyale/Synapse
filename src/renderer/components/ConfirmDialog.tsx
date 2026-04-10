import { MouseEvent, KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import './styles/ConfirmDialog.css';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleOverlayClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <button
      type="button"
      className="confirm-dialog-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      aria-label="Close dialog"
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="confirm-dialog-icon" aria-hidden="true">
          <AlertTriangle size={48} />
        </div>
        <h2 id="confirm-dialog-title" className="confirm-dialog-title">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="confirm-dialog-message">
          {message}
        </p>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button type="button" className="btn-accent" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </button>
  );
}

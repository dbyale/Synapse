import { KeyboardEvent, MouseEvent, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import './styles/ServerLogModal.css';

interface ServerLogModalProps {
  log: string;
  onClose: () => void;
}

export default function ServerLogModal({ log, onClose }: ServerLogModalProps) {
  const [copied, setCopied] = useState(false);

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — leave button state unchanged
    }
  };

  return (
    <div
      className="slm-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className="slm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Full server log"
      >
        <div className="slm-header">
          <h2>Server Log</h2>
          <button
            type="button"
            className="slm-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="slm-body">
          <pre className="slm-log">{log}</pre>
        </div>
        <div className="slm-footer">
          <button
            type="button"
            className="slm-copy"
            onClick={handleCopy}
            aria-label="Copy full log"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button type="button" className="slm-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, MouseEvent, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import './styles/ImageViewer.css';

interface ImageViewerProps {
  imageUrl: string;
  onClose: () => void;
}

export default function ImageViewer({ imageUrl, onClose }: ImageViewerProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleOverlayClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <button
      type="button"
      className="image-viewer-overlay"
      onClick={handleOverlayClick}
      aria-label="Close image viewer"
    >
      <button
        type="button"
        className="image-viewer-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className="image-viewer-container" role="dialog" aria-modal="true">
        {hasError ? (
          <div className="image-viewer-error">Failed to load image</div>
        ) : (
          <span className="image-viewer-image-wrap">
            <img
              src={imageUrl}
              alt="Enlarged image"
              className="image-viewer-image"
              onError={() => setHasError(true)}
            />
          </span>
        )}
      </div>
    </button>
  );
}

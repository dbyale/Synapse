import {
  useEffect,
  useRef,
  useState,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import './styles/ImageViewer.css';

interface ImageViewerProps {
  imageUrl: string;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;
const WHEEL_ZOOM_FACTOR = 1.15;
const DOUBLE_CLICK_ZOOM = 2;

interface ViewState {
  scale: number;
  x: number;
  y: number;
}

const INITIAL_VIEW: ViewState = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function zoomBy(prev: ViewState, delta: number): ViewState {
  const scale = clamp(prev.scale + delta, MIN_ZOOM, MAX_ZOOM);
  if (scale === MIN_ZOOM) return INITIAL_VIEW;
  const ratio = scale / prev.scale;
  return { scale, x: prev.x * ratio, y: prev.y * ratio };
}

export default function ImageViewer({ imageUrl, onClose }: ImageViewerProps) {
  const [hasError, setHasError] = useState(false);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [smooth, setSmooth] = useState(false);
  const [dragging, setDragging] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);

  useEffect(() => {
    setView(INITIAL_VIEW);
    setHasError(false);
  }, [imageUrl]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setSmooth(true);
        setView((prev) => zoomBy(prev, ZOOM_STEP));
      } else if (e.key === '-') {
        setSmooth(true);
        setView((prev) => zoomBy(prev, -ZOOM_STEP));
      } else if (e.key === '0') {
        setSmooth(true);
        setView(INITIAL_VIEW);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Native wheel listener so preventDefault() works (React's onWheel is passive).
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSmooth(false);
      const rect = img.getBoundingClientRect();
      const mx = e.clientX - (rect.left + rect.width / 2);
      const my = e.clientY - (rect.top + rect.height / 2);
      setView((prev) => {
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
        const scale = clamp(prev.scale * factor, MIN_ZOOM, MAX_ZOOM);
        if (scale === MIN_ZOOM) return INITIAL_VIEW;
        const ratio = scale / prev.scale;
        return {
          scale,
          x: prev.x + mx * (1 - ratio),
          y: prev.y + my * (1 - ratio),
        };
      });
    };
    img.addEventListener('wheel', handleWheel, { passive: false });
    return () => img.removeEventListener('wheel', handleWheel);
  }, [imageUrl, hasError]);

  useEffect(() => {
    if (!dragging) return undefined;
    const handleMove = (e: MouseEvent) => {
      const start = dragStart.current;
      if (!start) return;
      setView((prev) => ({
        scale: prev.scale,
        x: start.ox + (e.clientX - start.x),
        y: start.oy + (e.clientY - start.y),
      }));
    };
    const handleUp = () => {
      dragStart.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  const handleOverlayClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleDoubleClick = (e: ReactMouseEvent<HTMLImageElement>) => {
    setSmooth(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - (rect.left + rect.width / 2);
    const my = e.clientY - (rect.top + rect.height / 2);
    setView((prev) => {
      if (prev.scale > MIN_ZOOM) return INITIAL_VIEW;
      const scale = clamp(DOUBLE_CLICK_ZOOM, MIN_ZOOM, MAX_ZOOM);
      const ratio = scale / prev.scale;
      return {
        scale,
        x: prev.x + mx * (1 - ratio),
        y: prev.y + my * (1 - ratio),
      };
    });
  };

  const handleMouseDown = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (view.scale <= MIN_ZOOM) return;
    e.preventDefault();
    dragStart.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
    setSmooth(false);
    setDragging(true);
  };

  const zoomOut = () => {
    setSmooth(true);
    setView((prev) => zoomBy(prev, -ZOOM_STEP));
  };

  const zoomIn = () => {
    setSmooth(true);
    setView((prev) => zoomBy(prev, ZOOM_STEP));
  };

  const resetZoom = () => {
    setSmooth(true);
    setView(INITIAL_VIEW);
  };

  const imageClassName = [
    'image-viewer-image',
    view.scale > MIN_ZOOM ? 'image-viewer-image--zoomed' : '',
    dragging ? 'image-viewer-image--dragging' : '',
    smooth && !dragging ? 'image-viewer-image--smooth' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className="image-viewer-overlay"
      onClick={handleOverlayClick}
      aria-label="Close image viewer"
    >
      <div className="image-viewer-toolbar">
        <button
          type="button"
          className="image-viewer-btn"
          onClick={(e) => {
            e.stopPropagation();
            zoomOut();
          }}
          disabled={view.scale <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          <ZoomOut size={18} />
        </button>
        <span className="image-viewer-zoom-level">
          {Math.round(view.scale * 100)}%
        </span>
        <button
          type="button"
          className="image-viewer-btn"
          onClick={(e) => {
            e.stopPropagation();
            zoomIn();
          }}
          disabled={view.scale >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          <ZoomIn size={18} />
        </button>
        <button
          type="button"
          className="image-viewer-btn"
          onClick={(e) => {
            e.stopPropagation();
            resetZoom();
          }}
          disabled={view.scale === MIN_ZOOM && view.x === 0 && view.y === 0}
          aria-label="Reset zoom"
        >
          <Maximize2 size={18} />
        </button>
      </div>
      <button
        type="button"
        className="image-viewer-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className="image-viewer-container" role="dialog" aria-modal="true">
        {hasError ? (
          <div className="image-viewer-error">Failed to load image</div>
        ) : (
          <span className="image-viewer-image-wrap">
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Enlarged view"
              className={imageClassName}
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
              draggable={false}
              onError={() => setHasError(true)}
              onDoubleClick={handleDoubleClick}
              onMouseDown={handleMouseDown}
            />
          </span>
        )}
      </div>
    </button>
  );
}

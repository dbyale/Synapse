import React from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import InfoTooltip from '../InfoTooltip';
import {
  MEMORY_ALLOCATOR_TOOLTIP,
  MAX_LABEL_TOOLTIP,
  RAM_LABEL_TOOLTIP,
  VRAM_LABEL_TOOLTIP,
} from '../../utils/tooltipContent';

export interface MemoryStats {
  total: number;
  appAllocated: number;
  otherUsed: number;
  maxRecommended: number;
}

export const EMPTY_MEMORY: MemoryStats = {
  total: 0,
  appAllocated: 0,
  otherUsed: 0,
  maxRecommended: 0,
};

const formatGB = (mb: number) => (mb / 1024).toFixed(1);

type MemorySliderProps = {
  title: string;
  stats: MemoryStats;
  loading: boolean;
  unavailableMessage: string;
  onChange: (newVal: number) => void;
  onSave: (newVal: number) => void;
  onRefresh: () => void;
};

export function MemorySlider({
  title,
  stats,
  loading,
  unavailableMessage,
  onChange,
  onSave,
  onRefresh,
}: MemorySliderProps) {
  const titleTooltip =
    title.includes('Video') || title.includes('GPU')
      ? VRAM_LABEL_TOOLTIP
      : RAM_LABEL_TOOLTIP;

  const TitleNode = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <InfoTooltip
        content={titleTooltip}
        side="right"
        hideIcon
        title={title}
        className="mem-title-tooltip"
      >
        <div className="mem-title">{title}</div>
      </InfoTooltip>
      <InfoTooltip content="Refresh memory usage" side="bottom" hideIcon>
        <button
          type="button"
          className={`mem-refresh-btn ${loading ? 'loading' : ''}`}
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={14} />
        </button>
      </InfoTooltip>
    </div>
  );

  if (loading) {
    return (
      <div className="mem-container">
        <div className="mem-header">
          {TitleNode}
          <div className="mem-usage-row">Detecting hardware…</div>
        </div>
        <div className="mem-bar-wrapper" style={{ opacity: 0.45 }} />
      </div>
    );
  }

  if (stats.total <= 0 || Number.isNaN(stats.total)) {
    return (
      <div className="mem-container">
        <div className="mem-header">
          {TitleNode}
          <div className="mem-usage-row">{unavailableMessage}</div>
        </div>
      </div>
    );
  }

  const appPct = Math.min((stats.appAllocated / stats.total) * 100, 100);
  const otherPct = Math.min((stats.otherUsed / stats.total) * 100, 100);
  const freePct = Math.max(0, 100 - appPct - otherPct);
  const maxPct = Math.min((stats.maxRecommended / stats.total) * 100, 100);

  const freeSpace = Math.max(
    0,
    stats.total - stats.appAllocated - stats.otherUsed,
  );
  const isExceeded = stats.appAllocated > stats.maxRecommended;

  const appGB = formatGB(stats.appAllocated);
  const otherGB = formatGB(stats.otherUsed);
  const freeGB = formatGB(freeSpace);
  const totalGB = formatGB(stats.total);
  const displayUsedGB = formatGB(stats.appAllocated);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseInt(e.target.value, 10));
  };

  const handleSliderCommit = () => {
    onSave(stats.appAllocated);
  };

  return (
    <div className="mem-container">
      <div className="mem-header">
        {TitleNode}
        <div className="mem-usage-row">
          <span className="mem-value">{displayUsedGB}</span>
          <span className="mem-unit"> / {totalGB} GB</span>
        </div>
      </div>

      <div className="mem-bar-wrapper">
        <InfoTooltip
          title="OS & Other Apps"
          content={`${otherGB} GB In Use`}
          side="bottom"
          hideIcon
          portal
          className="mem-segment-other"
          style={{ right: 0, left: 'auto', width: `${otherPct}%` }}
        />
        <InfoTooltip
          title="Free Space"
          content={`${freeGB} GB Available`}
          side="bottom"
          hideIcon
          portal
          className="mem-segment-free"
          style={{ left: `${appPct}%`, width: `${freePct}%` }}
        />
        <InfoTooltip
          title="Synapse Allocation"
          content={`${appGB} GB Reserved`}
          side="bottom"
          hideIcon
          portal
          className={`mem-segment-app${isExceeded ? ' exceeded' : ''}`}
          style={{ left: 0, width: `${appPct}%` }}
        />
        <div className="mem-max-wrapper" style={{ left: `${maxPct}%` }}>
          <InfoTooltip
            content={MAX_LABEL_TOOLTIP}
            side="top"
            iconSize={10}
            title="Maximum"
            portal
          >
            <div className="mem-max-label">MAX</div>
          </InfoTooltip>
          <div className="mem-max-line" />
        </div>
        <input
          type="range"
          min={0}
          max={stats.total}
          value={stats.appAllocated}
          onChange={handleSliderChange}
          onMouseUp={handleSliderCommit}
          onTouchEnd={handleSliderCommit}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
              handleSliderCommit();
          }}
          className={`mem-slider ${isExceeded ? 'slider-exceeded' : ''}`}
          style={{ left: 0, width: '100%' }}
        />
      </div>

      <div className="mem-legend-row">
        <div className={`mem-legend-box ${isExceeded ? 'exceeded' : ''}`} />
        <InfoTooltip
          content={MEMORY_ALLOCATOR_TOOLTIP}
          side="right"
          hideIcon
          title="Synapse Allocation"
        >
          <span>
            Synapse Allocation:{' '}
            <strong className="mem-value-small">{appGB} GB</strong>
          </span>
        </InfoTooltip>
      </div>

      {isExceeded ? (
        <div className="mem-warning">
          <AlertTriangle size={14} />
          <span>
            Exceeding recommended limits may cause system instability or severe
            performance drops.
          </span>
        </div>
      ) : null}
    </div>
  );
}

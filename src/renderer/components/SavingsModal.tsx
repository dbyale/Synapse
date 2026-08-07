import { KeyboardEvent, MouseEvent, useState } from 'react';
import { X, HandHeart, CircleDollarSign } from 'lucide-react';
import type { UsageStore } from '../utils/usage';
import {
  totalSavings,
  monthlySavings,
  formatNumber,
  formatMoney,
  EMPTY_MONTHLY_USAGE,
} from '../utils/usage';
import './styles/SavingsModal.css';

const TIP_OPTIONS = [1, 5, 10] as const;

interface SavingsModalProps {
  usage: UsageStore;
  currentMonthId: string;
  monthLabel: 'This month' | 'Last month';
  title: string;
  tipBasis: 'monthly' | 'total';
  onClose: () => void;
}

export default function SavingsModal({
  usage,
  currentMonthId,
  monthLabel,
  title,
  tipBasis,
  onClose,
}: SavingsModalProps) {
  const [selectedTip, setSelectedTip] = useState<number | null>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);

  const monthly = usage.monthly[currentMonthId] ?? EMPTY_MONTHLY_USAGE;

  const savedThisMonth = monthlySavings(usage, currentMonthId);
  const savedTotal = totalSavings(usage);
  const tipBase = tipBasis === 'monthly' ? savedThisMonth : savedTotal;

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

  const handleTipTap = () => {
    setShowComingSoon(true);
  };

  return (
    <div
      className="sm-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Estimated savings"
    >
      <div className="sm-dialog">
        <div className="sm-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="sm-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="sm-body">
          <div className="sm-left">
            <div className="sm-usage">
              <div className="sm-usage__header">
                <span className="sm-usage__spacer" />
                <span className="sm-usage__col">Monthly</span>
                <span className="sm-usage__col">Total</span>
              </div>
              <div className="sm-usage__row">
                <span className="sm-usage__label">Input tokens</span>
                <span className="sm-usage__value">
                  {formatNumber(monthly.totalInputTokens)}
                </span>
                <span className="sm-usage__value">
                  {formatNumber(usage.totalInputTokens)}
                </span>
              </div>
              <div className="sm-usage__row">
                <span className="sm-usage__label">Output tokens</span>
                <span className="sm-usage__value">
                  {formatNumber(monthly.totalOutputTokens)}
                </span>
                <span className="sm-usage__value">
                  {formatNumber(usage.totalOutputTokens)}
                </span>
              </div>
              <div className="sm-usage__row">
                <span className="sm-usage__label">Web searches</span>
                <span className="sm-usage__value">
                  {formatNumber(monthly.totalWebSearches)}
                </span>
                <span className="sm-usage__value">
                  {formatNumber(usage.totalWebSearches)}
                </span>
              </div>
            </div>

            <div className="sm-big">
              <div className="sm-big__label">{monthLabel}</div>
              <div className="sm-big__monthly">
                {formatMoney(savedThisMonth)}
              </div>
              <div className="sm-big__amount">
                <div className="sm-big__total">{formatMoney(savedTotal)}</div>
                <div className="sm-big__amount-label">Total</div>
              </div>
            </div>

            <div className="sm-note">
              <CircleDollarSign size={14} className="sm-note__icon" />
              <span className="sm-note__text">
                Compared to paying for similar models
              </span>
            </div>
          </div>

          <div className="sm-divider" />

          <div className="sm-right">
            <div className="sm-right__header">
              <span className="sm-right__title">Include a tip</span>
              <span className="sm-right__subtitle">Support the project</span>
            </div>
            <div className="sm-tip-grid">
              {TIP_OPTIONS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={`sm-tip${selectedTip === pct ? ' sm-tip--selected' : ''}`}
                  onClick={() => {
                    setSelectedTip(pct);
                    handleTipTap();
                  }}
                >
                  <span className="sm-tip__pct">{pct}%</span>
                  <span className="sm-tip__amount">
                    {formatMoney(tipBase * (pct / 100))}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sm-custom-button"
              onClick={handleTipTap}
            >
              Custom amount
            </button>
            {showComingSoon && (
              <div className="sm-coming-soon">
                <HandHeart size={14} />
                Tips are coming soon
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

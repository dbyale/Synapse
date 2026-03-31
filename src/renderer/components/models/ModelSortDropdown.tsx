import React, { useRef, useEffect, useState } from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  Download,
  Heart,
  TrendingUp,
  Clock,
} from 'lucide-react';

export type SortOption = 'trending' | 'downloads' | 'likes' | 'recent';

const SORT_CONFIG: {
  key: SortOption;
  label: string;
  icon: React.FC<{ size?: number }>;
}[] = [
  { key: 'trending', label: 'Trending', icon: TrendingUp },
  { key: 'downloads', label: 'Most Downloads', icon: Download },
  { key: 'likes', label: 'Most Likes', icon: Heart },
  { key: 'recent', label: 'Recently Updated', icon: Clock },
];

interface ModelSortDropdownProps {
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
}

export default function ModelSortDropdown({
  sortBy,
  onSortChange,
}: ModelSortDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = SORT_CONFIG.find((c) => c.key === sortBy)!;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (key: SortOption): void => {
    onSortChange(key);
    setOpen(false);
  };

  return (
    <div className="sort-row">
      <span className="sort-label">
        <ArrowDownUp size={14} /> Sort by:
      </span>

      <div className="sort-dropdown-wrapper" ref={ref}>
        <button
          type="button"
          className={`sort-trigger ${open ? 'sort-trigger--open' : ''}`}
          onClick={() => setOpen(!open)}
        >
          <current.icon size={14} />
          <span className="sort-trigger__label">{current.label}</span>
          <ChevronDown size={14} style={{ marginTop: 2, opacity: 0.8 }} />
        </button>

        {open && (
          <div className="sort-menu">
            {SORT_CONFIG.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                className={`sort-option ${sortBy === key ? 'sort-option--active' : ''}`}
                onClick={() => handleSelect(key)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { MouseEvent, KeyboardEvent } from 'react';
import { X, PackageCheck, PackageMinus } from 'lucide-react';
import { Profile } from '../types/profile';
import { getExtensions } from '../utils/extensionData';
import './styles/ProfileSelectModal.css';

interface ProfileSelectModalProps {
  profiles: Profile[];
  selectedProfileId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function renderToolBadges(profileTools: string[]) {
  if (!profileTools || profileTools.length === 0) return null;

  const badges = getExtensions()
    .map((ext) => {
      const toolKeys = Object.keys(ext.tools);
      const total = toolKeys.length;
      const enabled = toolKeys.filter((tk) => profileTools.includes(tk)).length;
      return { id: ext.manifest.id, name: ext.manifest.name, total, enabled };
    })
    .filter(({ enabled }) => enabled > 0);

  return (
    <div className="psm-card__tool-badges">
      {badges.map(({ id, name, total, enabled }) => (
        <span key={id} className="psm-card__tool-badge">
          {enabled === total ? (
            <PackageCheck size={10} />
          ) : (
            <PackageMinus size={10} />
          )}
          {name}
        </span>
      ))}
    </div>
  );
}

export default function ProfileSelectModal({
  profiles,
  selectedProfileId,
  onSelect,
  onClose,
}: ProfileSelectModalProps) {
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

  return (
    <div
      className="psm-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Select a profile"
    >
      <div className="psm-dialog">
        <div className="psm-header">
          <h2>Select Profile</h2>
          <button
            type="button"
            className="psm-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="psm-list">
          {profiles.length === 0 ? (
            <div className="psm-empty">No profiles available.</div>
          ) : (
            profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`psm-card${selectedProfileId === profile.id ? ' psm-card--active' : ''}`}
                onClick={() => {
                  onSelect(profile.id);
                  onClose();
                }}
              >
                <div className="psm-card__title-row">
                  <h3>{profile.name}</h3>
                  {selectedProfileId === profile.id && (
                    <span className="psm-card__active-badge">Active</span>
                  )}
                </div>
                <p className="psm-card__model">
                  {profile.model.split(/[/\\]/).pop()}
                </p>
                {renderToolBadges(profile.tools ?? [])}
                <span className="psm-card__date">
                  Created{' '}
                  {new Date(profile.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

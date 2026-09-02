import { FolderOpen } from 'lucide-react';
import InfoTooltip from '../InfoTooltip';

type Props = {
  label: string;
  tooltip: any;
  value: string;
  onPick: () => void;
  readOnly?: boolean;
  onChange?: (v: string) => void;
};

export function DirectoryField({
  label,
  tooltip,
  value,
  onPick,
  readOnly = true,
  onChange,
}: Props) {
  return (
    <div className="settings-field">
      <InfoTooltip
        content={tooltip}
        side="bottom"
        hideIcon
        title={label}
        className={
          label === 'Models Directory'
            ? 'models-dir-tooltip'
            : label === 'Backend Directory'
              ? 'backend-dir-tooltip'
              : 'parser-dir-tooltip'
        }
      >
        <span className="settings-label">{label}</span>
        <div className="settings-row">
          <input
            className="settings-input"
            value={value}
            readOnly={readOnly}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            spellCheck={false}
          />
          <button
            type="button"
            className="settings-icon-btn"
            onClick={onPick}
            title="Browse"
          >
            <FolderOpen size={16} />
          </button>
        </div>
      </InfoTooltip>
    </div>
  );
}

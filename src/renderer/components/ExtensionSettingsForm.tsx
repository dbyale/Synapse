import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FolderOpen,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  SettingField,
  SettingValue,
  SettingsBag,
} from '../../shared/extensionSettings';
import { isPerProfileField, optionLabel } from '../../shared/extensionSettings';
import './styles/ExtensionSettingsForm.css';

/**
 * The one settings form every extension gets. It renders entirely from the
 * field definitions an extension declares in its own manifest.json — there is
 * no per-extension settings UI, so a user-authored extension is configured
 * exactly like a built-in one.
 *
 * Two modes:
 *   defaults (default)  edits the extension's global defaults layer
 *   profile             every perProfile field is editable; the value shown is
 *                       the profile's override when it has one and the default
 *                       otherwise, and any edit becomes an override
 */

export interface ExtensionSettingsFormProps {
  fields: SettingField[];
  /** Values of the layer being edited (defaults, or the profile's overrides). */
  values: SettingsBag;
  onFieldChange?: (key: string, value: SettingValue) => void;
  /** Edits are per-profile overrides instead of the extension's defaults. */
  profileMode?: boolean;
  /** Defaults layer, shown under a field the profile has overridden. */
  defaults?: SettingsBag;
  disabled?: boolean;
  description?: string;
}

function isOverridden(field: SettingField, values: SettingsBag): boolean {
  return values[field.key] !== undefined;
}

function displayValue(field: SettingField, value: SettingValue): string {
  if (field.kind === 'secret') {
    return typeof value === 'string' && value !== '' ? '••••••••' : '(not set)';
  }
  if (field.kind === 'toggle') return value ? 'On' : 'Off';
  if (field.kind === 'select') return optionLabel(field, value);
  if (field.kind === 'stringList') {
    const list = Array.isArray(value) ? value : [];
    return list.length > 0 ? list.join(', ') : '(none)';
  }
  const str = String(value ?? '');
  return str === '' ? '(empty)' : str;
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`esf-switch${checked ? ' esf-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="esf-switch-thumb" />
    </button>
  );
}

function StringListControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  value: SettingValue;
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const list = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState('');
  const usePicker = field.kind === 'directory' || field.picker === 'directory';

  function addItem(next: string) {
    const trimmed = next.trim();
    if (trimmed === '' || list.includes(trimmed)) return;
    onChange([...list, trimmed]);
    setDraft('');
  }

  async function pickItem() {
    const picked = await window.electronAPI.pickDirectory();
    if (picked) addItem(picked);
  }

  return (
    <div className="esf-list">
      {list.length === 0 && (
        <div className="esf-list-empty">Nothing configured.</div>
      )}
      {list.map((item) => (
        <div key={item} className="esf-list-row">
          {usePicker && <FolderOpen size={13} className="esf-list-icon" />}
          <span className="esf-list-value" title={item}>
            {item}
          </span>
          <button
            type="button"
            className="esf-icon-btn"
            aria-label={`Remove ${item}`}
            disabled={disabled}
            onClick={() => onChange(list.filter((v) => v !== item))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="esf-list-add">
        <input
          className="esf-input"
          value={draft}
          placeholder={field.placeholder ?? 'Add…'}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem(draft);
            }
          }}
        />
        {usePicker && (
          <button
            type="button"
            className="btn-secondary esf-add-btn"
            onClick={pickItem}
            disabled={disabled}
          >
            <FolderOpen size={13} />
          </button>
        )}
        <button
          type="button"
          className="btn-secondary esf-add-btn"
          onClick={() => addItem(draft)}
          disabled={disabled || draft.trim() === ''}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function SecretControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  value: SettingValue;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="esf-secret">
      <input
        className="esf-input"
        type={reveal ? 'text' : 'password'}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="esf-icon-btn"
        aria-label={reveal ? 'Hide value' : 'Reveal value'}
        onClick={() => setReveal((r) => !r)}
      >
        {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

/**
 * A select field's option list, rendered from the manifest. An empty option
 * value is a real choice ("no filter"), so it is labelled rather than hidden.
 */
type SelectOption = { value: string; label: string };

function selectOptions(field: SettingField): SelectOption[] {
  return (field.options ?? []).map((option) => {
    const value = typeof option === 'string' ? option : option.value;
    const label = typeof option === 'string' ? option : option.label;
    return { value, label: label === '' ? '(none)' : label };
  });
}

const PANEL_MAX_HEIGHT = 264;
const PANEL_GAP = 6;
const PANEL_MIN_Z_INDEX = 1200;

/** Keys the open list handles itself; Tab is left alone for focus movement. */
const CONSUMED_KEYS = [
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
  'Enter',
  ' ',
  'Escape',
];

/**
 * The list is portaled to <body>, so it sits outside the modal that opened it
 * and has to out-rank that modal: modals stack (the profile editor is 2000 and
 * the per-profile settings modal inside it is 1000), so the panel takes the
 * highest z-index in the trigger's ancestor chain and adds one.
 */
function panelZIndex(trigger: HTMLElement): number {
  let highest = PANEL_MIN_Z_INDEX;
  let node: HTMLElement | null = trigger;
  while (node && node !== document.documentElement) {
    const { position, zIndex } = window.getComputedStyle(node);
    if (position !== 'static') {
      const parsed = Number.parseInt(zIndex, 10);
      if (Number.isFinite(parsed) && parsed + 1 > highest) highest = parsed + 1;
    }
    node = node.parentElement;
  }
  return highest;
}

interface PanelPlacement {
  left: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
  zIndex: number;
  top?: number;
  bottom?: number;
  up: boolean;
}

/**
 * Fixed positioning keeps a long list from being clipped by a scrolling modal,
 * and the panel flips above the trigger when there is more room there.
 */
function placePanel(trigger: HTMLElement): PanelPlacement {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP;
  const spaceAbove = rect.top - PANEL_GAP;
  const up = spaceBelow < 140 && spaceAbove > spaceBelow;
  return {
    left: rect.left,
    minWidth: rect.width,
    maxWidth: Math.max(rect.width, window.innerWidth - rect.left - 12),
    maxHeight: Math.max(
      96,
      Math.min(PANEL_MAX_HEIGHT, up ? spaceAbove : spaceBelow),
    ),
    zIndex: panelZIndex(trigger),
    ...(up
      ? { bottom: window.innerHeight - rect.top + PANEL_GAP }
      : { top: rect.bottom + PANEL_GAP }),
    up,
  };
}

function SelectControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  value: SettingValue;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const options = selectOptions(field);
  const current = typeof value === 'string' ? value : '';
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const openList = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const selected = options.findIndex((option) => option.value === current);
    setActive(selected >= 0 ? selected : 0);
    setPlacement(placePanel(trigger));
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    setPlacement(null);
  };

  const commit = (option: SelectOption) => {
    onChange(option.value);
    closeList();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closeList();
    };
    const reposition = () => {
      if (triggerRef.current) setPlacement(placePanel(triggerRef.current));
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  // The highlighted option follows the keyboard into view.
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${listId}-option-${active}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        openList();
      }
      return;
    }
    // While the list is open these keys belong to it. Settings modals close on
    // Escape from a handler on the overlay, so let none of them bubble there.
    if (CONSUMED_KEYS.includes(event.key)) event.stopPropagation();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(options.length - 1, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const option = options[active];
        if (option) commit(option);
        break;
      }
      case 'Escape':
        event.preventDefault();
        closeList();
        break;
      case 'Tab':
        closeList();
        break;
      default:
        break;
    }
  };

  const selected = options.find((option) => option.value === current);
  // A stored value that isn't offered any more is still shown, so a settings
  // change can never silently rewrite itself.
  const fallbackLabel = current === '' ? '(none)' : current;
  const shownLabel = selected ? selected.label : fallbackLabel;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`esf-select${open ? ' esf-select--open' : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-option-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
      >
        <span
          className={`esf-select-value${selected ? '' : ' esf-select-value--unlisted'}`}
        >
          {shownLabel}
        </span>
        <ChevronDown className="esf-select-chevron" size={14} />
      </button>
      {open &&
        placement &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-label={field.label}
            className={`esf-select-panel${placement.up ? ' esf-select-panel--up' : ''}`}
            style={{
              left: placement.left,
              minWidth: placement.minWidth,
              maxWidth: placement.maxWidth,
              maxHeight: placement.maxHeight,
              zIndex: placement.zIndex,
              top: placement.top,
              bottom: placement.bottom,
            }}
          >
            {options.length === 0 && (
              <div className="esf-select-empty">No options</div>
            )}
            {options.map((option, index) => (
              <button
                key={option.value === '' ? '(none)' : option.value}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === current}
                className={[
                  'esf-select-option',
                  index === active ? 'esf-select-option--active' : '',
                  option.value === current ? 'esf-select-option--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(option)}
              >
                <span className="esf-select-option__label">{option.label}</span>
                <Check className="esf-select-option__check" size={14} />
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  value: SettingValue;
  onChange: (v: SettingValue) => void;
  disabled?: boolean;
}) {
  switch (field.kind) {
    case 'toggle':
      return (
        <ToggleSwitch
          checked={!!value}
          label={field.label}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case 'number':
      return (
        <input
          className="esf-input esf-input--number"
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
      );
    case 'select': {
      const options = selectOptions(field);
      if (options.length === 0) {
        // No option list declared: the field is free-form text.
        return (
          <input
            className="esf-input"
            type="text"
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      }
      return (
        <SelectControl
          field={field}
          value={value}
          disabled={disabled}
          onChange={(v) => onChange(v)}
        />
      );
    }
    case 'stringList':
      return (
        <StringListControl
          field={field}
          value={value}
          disabled={disabled}
          onChange={(v) => onChange(v)}
        />
      );
    case 'secret':
      return (
        <SecretControl
          field={field}
          value={value}
          disabled={disabled}
          onChange={(v) => onChange(v)}
        />
      );
    case 'textarea':
      return (
        <textarea
          className="esf-textarea"
          rows={4}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'directory':
      return (
        <div className="esf-dir">
          <input
            className="esf-input"
            type="text"
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary esf-add-btn"
            disabled={disabled}
            onClick={async () => {
              const picked = await window.electronAPI.pickDirectory();
              if (picked) onChange(picked);
            }}
          >
            <FolderOpen size={13} />
            Browse
          </button>
        </div>
      );
    default:
      return (
        <input
          className="esf-input"
          type="text"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function groupFields(fields: SettingField[]): Array<[string, SettingField[]]> {
  const order: string[] = [];
  const groups = new Map<string, SettingField[]>();
  for (const field of fields) {
    const key = field.group ?? '';
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(field);
  }
  return order.map((key) => [key, groups.get(key)!]);
}

export default function ExtensionSettingsForm(
  props: ExtensionSettingsFormProps,
) {
  const {
    fields,
    values,
    onFieldChange,
    profileMode,
    defaults,
    disabled,
    description,
  } = props;

  if (fields.length === 0) {
    return (
      <div className="esf-empty">This extension declares no settings.</div>
    );
  }

  return (
    <div className="esf">
      {description && <p className="esf-description">{description}</p>}
      {groupFields(fields).map(([group, groupItems]) => (
        <div key={group || '(default)'} className="esf-group">
          {group && <div className="esf-group-title">{group}</div>}
          {groupItems.map((field) => {
            const overridable = isPerProfileField(field);
            const overridden =
              !!profileMode && overridable && isOverridden(field, values);
            const defaultValue = defaults?.[field.key] ?? field.default ?? '';
            const shown = values[field.key] ?? defaultValue;
            return (
              <div key={field.key} className="esf-field">
                <div className="esf-field-head">
                  <span className="esf-label">{field.label}</span>
                  {profileMode && overridden && (
                    <span className="esf-badge esf-badge--overridden">
                      Overridden
                    </span>
                  )}
                  {profileMode && !overridable && (
                    <span className="esf-badge">Defaults only</span>
                  )}
                </div>
                {profileMode && !overridable ? (
                  <div
                    className="esf-readonly"
                    title={displayValue(field, shown)}
                  >
                    {displayValue(field, shown)}
                  </div>
                ) : (
                  <FieldControl
                    field={field}
                    value={shown}
                    disabled={disabled}
                    onChange={(v) => onFieldChange?.(field.key, v)}
                  />
                )}
                {overridden && (
                  <div className="esf-default">
                    {`Default: ${displayValue(field, defaultValue)}`}
                  </div>
                )}
                {field.hint && <div className="esf-hint">{field.hint}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ExtensionSettingsForm from '../renderer/components/ExtensionSettingsForm';
import { validateSettingsDef } from '../shared/extensionSettings';

// jsdom has no layout engine; the list scrolls the highlighted row into view.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const def = validateSettingsDef({
  fields: [
    {
      key: 'mode',
      label: 'Mode',
      kind: 'select',
      group: 'Behaviour',
      default: 'fast',
      options: [
        { value: '', label: '' },
        { value: 'fast', label: 'Fast' },
        { value: 'safe', label: 'Safe' },
      ],
    },
  ],
})!;

describe('select fields in the generic settings form', () => {
  it('shows the stored option and writes the chosen one back', () => {
    const onFieldChange = jest.fn();
    render(
      <ExtensionSettingsForm
        fields={def.fields}
        values={{ mode: 'fast' }}
        onFieldChange={onFieldChange}
      />,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Fast');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    // Portaled to <body>, so a scrolling settings modal can never clip it.
    expect(listbox.parentElement).toBe(document.body);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('option', { name: 'Safe' }));
    expect(onFieldChange).toHaveBeenCalledWith('mode', 'safe');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('labels the empty option instead of hiding it', () => {
    render(<ExtensionSettingsForm fields={def.fields} values={{ mode: '' }} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('(none)');
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: '(none)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps a stored value that is no longer one of the options', () => {
    render(
      <ExtensionSettingsForm fields={def.fields} values={{ mode: 'legacy' }} />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('legacy');
  });

  it('opens and chooses with the keyboard', () => {
    const onFieldChange = jest.fn();
    render(
      <ExtensionSettingsForm
        fields={def.fields}
        values={{ mode: 'fast' }}
        onFieldChange={onFieldChange}
      />,
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onFieldChange).toHaveBeenCalledWith('mode', '');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape and on a click outside', () => {
    render(
      <ExtensionSettingsForm fields={def.fields} values={{ mode: 'fast' }} />,
    );
    const trigger = screen.getByRole('combobox');

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stacks above the modal it was opened from', () => {
    // The profile editor is z-index 2000 and the per-profile settings modal is
    // nested inside it, so a list portaled to <body> has to out-rank both.
    render(
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000 }}>
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
          <ExtensionSettingsForm
            fields={def.fields}
            values={{ mode: 'fast' }}
          />
        </div>
      </div>,
    );
    fireEvent.click(screen.getByRole('combobox'));
    const panel = screen.getByRole('listbox');
    expect(Number(panel.style.zIndex)).toBeGreaterThan(2000);
  });

  it('does not let the modal behind it act on the list keys', () => {
    // Settings modals close on Escape from a handler on the overlay, so the
    // open list has to consume the key.
    const onOverlayKeyDown = jest.fn();
    render(
      <div onKeyDown={onOverlayKeyDown}>
        <ExtensionSettingsForm fields={def.fields} values={{ mode: 'fast' }} />
      </div>,
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onOverlayKeyDown).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(onOverlayKeyDown).not.toHaveBeenCalled();
  });

  it('falls back to a text input when a select declares no options', () => {
    const freeForm = validateSettingsDef({
      fields: [{ key: 'endpoint', label: 'Endpoint', kind: 'select' }],
    })!;
    render(
      <ExtensionSettingsForm
        fields={freeForm.fields}
        values={{ endpoint: '' }}
      />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('per-profile settings', () => {
  const profileDef = validateSettingsDef({
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        kind: 'select',
        default: 'fast',
        options: ['fast', 'safe'],
      },
      { key: 'token', label: 'Token', kind: 'secret', sensitive: true },
    ],
  })!;

  it('is editable straight away, with no override switches', () => {
    const onFieldChange = jest.fn();
    render(
      <ExtensionSettingsForm
        fields={profileDef.fields}
        values={{ mode: 'safe' }}
        defaults={{ mode: 'fast' }}
        profileMode
        onFieldChange={onFieldChange}
      />,
    );

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('combobox')).toHaveTextContent('safe');
    expect(screen.getByText('Overridden')).toBeInTheDocument();
    expect(screen.getByText('Default: fast')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'fast' }));
    expect(onFieldChange).toHaveBeenCalledWith('mode', 'fast');
  });

  it('shows the default for a field the profile has not touched', () => {
    render(
      <ExtensionSettingsForm
        fields={profileDef.fields}
        values={{}}
        defaults={{ mode: 'safe' }}
        profileMode
      />,
    );

    expect(screen.queryByText('Overridden')).toBeNull();
    expect(screen.getByRole('combobox')).toHaveTextContent('safe');
  });

  it('keeps defaults-only fields out of the profile', () => {
    render(
      <ExtensionSettingsForm
        fields={profileDef.fields}
        values={{}}
        defaults={{}}
        profileMode
      />,
    );

    expect(screen.getByText('Defaults only')).toBeInTheDocument();
    expect(screen.getByText('(not set)')).toBeInTheDocument();
  });
});

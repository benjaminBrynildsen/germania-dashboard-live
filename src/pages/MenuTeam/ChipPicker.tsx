import { useMemo, useState } from 'react';

// Header-field picker: a row of toggleable chips drawn from a preset
// list, plus a "+ Add custom" inline input for one-off values. The
// outward-facing value is a comma-joined string so we don't have to
// migrate the existing TEXT columns to JSON.

type Props = {
  presets: string[];
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  placeholder?: string;
};

function splitValue(v: string | null | undefined): string[] {
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function joinValue(items: string[]): string | null {
  const cleaned = items.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.join(', ');
}

export default function ChipPicker({ presets, value, onChange, placeholder = 'Custom value' }: Props) {
  const selected = useMemo(() => splitValue(value), [value]);
  const selectedSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const [customDraft, setCustomDraft] = useState('');

  function toggle(preset: string) {
    const has = selectedSet.has(preset.toLowerCase());
    if (has) {
      onChange(joinValue(selected.filter((s) => s.toLowerCase() !== preset.toLowerCase())));
    } else {
      onChange(joinValue([...selected, preset]));
    }
  }

  function addCustom() {
    const v = customDraft.trim();
    if (!v) return;
    if (selectedSet.has(v.toLowerCase())) {
      setCustomDraft('');
      return;
    }
    onChange(joinValue([...selected, v]));
    setCustomDraft('');
  }

  // Surface user-entered custom values that aren't in the preset list,
  // so they can be removed via their own chip.
  const presetLower = new Set(presets.map((p) => p.toLowerCase()));
  const extras = selected.filter((s) => !presetLower.has(s.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {presets.map((p) => {
          const on = selectedSet.has(p.toLowerCase());
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              style={{
                padding: '5px 11px',
                fontSize: 12,
                border: `1px solid ${on ? '#1a1a1a' : 'rgba(0,0,0,0.18)'}`,
                background: on ? '#1a1a1a' : '#fff',
                color: on ? '#fff' : 'rgba(0,0,0,0.7)',
                borderRadius: 999,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {on ? '✓ ' : ''}{p}
            </button>
          );
        })}
        {extras.map((x) => (
          <button
            key={`extra-${x}`}
            type="button"
            onClick={() => onChange(joinValue(selected.filter((s) => s !== x)))}
            style={{
              padding: '5px 11px',
              fontSize: 12,
              border: '1px solid #1a1a1a',
              background: '#1a1a1a',
              color: '#fff',
              borderRadius: 999,
              cursor: 'pointer',
            }}
            title="Remove custom value"
          >
            ✓ {x} <span style={{ opacity: 0.6, marginLeft: 4 }}>×</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          type="text"
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={placeholder}
          style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={addCustom} disabled={!customDraft.trim()}>+ Add</button>
      </div>
    </div>
  );
}

'use client';

import type { ComponentInstance } from '@oas/app-spec';
import { byRef } from '@oas/component-registry';

export default function PropsInspector({
  instance,
  onChange,
  onMove,
  onRemove,
}: {
  instance: ComponentInstance;
  onChange: (key: string, value: unknown) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const manifest = byRef(instance.ref);
  const props = instance.props ?? {};
  const specs = manifest?.props ?? Object.keys(props).map((name) => ({ name, type: 'string' as const }));

  return (
    <div>
      <div className="inspector-head">
        <div>
          <div className="inspector-title">{manifest?.name ?? instance.ref}</div>
          <div className="inspector-ref">{instance.ref}</div>
        </div>
        <div className="inspector-actions">
          <button title="Move up" onClick={() => onMove(-1)}>↑</button>
          <button title="Move down" onClick={() => onMove(1)}>↓</button>
          <button title="Remove" className="danger" onClick={onRemove}>✕</button>
        </div>
      </div>

      {specs.map((p) => {
        const value = props[p.name];
        const id = `prop-${p.name}`;
        return (
          <div key={p.name} className="prop-field">
            <label htmlFor={id} className="pv-label">
              {p.name}
              <span className="prop-type"> {p.type}</span>
            </label>
            {p.type === 'boolean' ? (
              <input
                id={id}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onChange(p.name, e.target.checked)}
              />
            ) : p.type === 'number' ? (
              <input
                id={id}
                type="number"
                value={typeof value === 'number' ? value : ''}
                onChange={(e) => onChange(p.name, Number(e.target.value))}
              />
            ) : p.type === 'enum' && 'values' in p && p.values ? (
              <select id={id} value={String(value ?? '')} onChange={(e) => onChange(p.name, e.target.value)}>
                {p.values.map((v: string) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type="text"
                value={stringify(value)}
                onChange={(e) => onChange(p.name, parse(e.target.value))}
                placeholder={p.type === 'binding' || p.type === 'items' ? '$data.path' : p.type === 'action' ? '{"navigate":"screen_id"}' : ''}
              />
            )}
          </div>
        );
      })}
      {specs.length === 0 && <p className="pv-label">No props.</p>}
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Text inputs accept strings, bindings, or JSON (for actions/arrays). */
function parse(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

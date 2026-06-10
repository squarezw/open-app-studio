'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSpec } from '@oas/app-spec';
import { BUILTINS, byRef } from '@oas/component-registry';
import { GATEWAY_URL } from '../lib/gateway';
import {
  addComponent,
  apply,
  defaultPropsFor,
  initHistory,
  moveComponent,
  redo,
  removeComponent,
  renameApp,
  undo,
  updateProp,
  type EditorHistory,
} from '../lib/blueprint';
import AiPanel, { type CustomComponent } from './AiPanel';
import BlockPreview from './BlockPreview';
import PropsInspector from './PropsInspector';

type SaveState = 'saved' | 'dirty' | 'saving';

export default function BlueprintEditor({ id }: { id: string }) {
  const [history, setHistory] = useState<EditorHistory>();
  const [screenId, setScreenId] = useState<string>();
  const [selected, setSelected] = useState<number>();
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string>();
  const [customComponents, setCustomComponents] = useState<CustomComponent[]>([]);

  const refreshCustom = useCallback(async () => {
    try {
      setCustomComponents(await (await fetch(`${GATEWAY_URL}/api/components`)).json());
    } catch {
      /* gateway offline — custom palette stays empty */
    }
  }, []);

  useEffect(() => {
    void refreshCustom();
  }, [refreshCustom]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/api/blueprints/${id}`);
        if (!res.ok) throw new Error(`blueprint not found (HTTP ${res.status})`);
        const record = (await res.json()) as { spec: AppSpec };
        setHistory(initHistory(record.spec));
        setScreenId(record.spec.screens[0]?.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [id]);

  const spec = history?.present;
  const screen = useMemo(() => spec?.screens.find((s) => s.id === screenId), [spec, screenId]);

  const edit = useCallback((next: AppSpec) => {
    setHistory((h) => (h ? apply(h, next) : h));
    setSaveState('dirty');
  }, []);

  async function save() {
    if (!spec) return;
    setSaveState('saving');
    const res = await fetch(`${GATEWAY_URL}/api/blueprints/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec }),
    });
    setSaveState(res.ok ? 'saved' : 'dirty');
    if (!res.ok) setError(`save failed (HTTP ${res.status})`);
  }

  function exportSpec() {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${spec.app.name.replace(/\s+/g, '-').toLowerCase()}.spec.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!spec || !screenId) return <div className="error-box" style={{ color: 'var(--muted)' }}>Loading…</div>;

  return (
    <div className="editor-layout">
      <aside className="palette">
        <h2>Blocks</h2>
        {BUILTINS.map((m) => (
          <button
            key={m.ref}
            className="palette-item"
            title={m.description}
            onClick={() => {
              edit(addComponent(spec, screenId, { ref: m.ref, props: defaultPropsFor(m) }));
              setSelected(screen ? screen.components.length : 0);
            }}
          >
            ＋ {m.name}
          </button>
        ))}
        {customComponents.length > 0 && (
          <>
            <h2 style={{ marginTop: 14 }}>Custom (AI)</h2>
            {customComponents.map((c) => (
              <button
                key={c.manifest.ref}
                className="palette-item palette-custom"
                title={c.manifest.description}
                onClick={() => {
                  edit(addComponent(spec, screenId, { ref: c.manifest.ref, props: defaultPropsFor(c.manifest) }));
                  setSelected(screen ? screen.components.length : 0);
                }}
              >
                ✨ {c.manifest.name}
              </button>
            ))}
          </>
        )}
      </aside>

      <section className="canvas-center">
        <div className="editor-toolbar">
          <input
            className="app-name"
            value={spec.app.name}
            onChange={(e) => edit(renameApp(spec, e.target.value))}
            aria-label="App name"
          />
          <button onClick={() => setHistory((h) => (h ? undo(h) : h))} disabled={history!.past.length === 0}>
            ↩ Undo
          </button>
          <button onClick={() => setHistory((h) => (h ? redo(h) : h))} disabled={history!.future.length === 0}>
            ↪ Redo
          </button>
          <button onClick={exportSpec}>⤓ Export JSON</button>
          <button className="primary" onClick={save} disabled={saveState !== 'dirty'}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save'}
          </button>
        </div>

        <div className="screen-tabs">
          {spec.screens.map((s) => (
            <button
              key={s.id}
              className="screen-tab"
              data-active={s.id === screenId}
              onClick={() => {
                setScreenId(s.id);
                setSelected(undefined);
              }}
            >
              {s.title ?? s.id}
            </button>
          ))}
        </div>

        <div className="phone-frame-wrap">
          <div className="phone-frame">
            <div className="phone-screen-title">{screen?.title ?? screenId}</div>
            <div className="phone-body">
              {screen?.components.map((c, i) => (
                <div
                  key={i}
                  className="block-slot"
                  data-selected={selected === i}
                  onClick={() => setSelected(i)}
                >
                  <BlockPreview instance={c} />
                </div>
              ))}
              {screen?.components.length === 0 && (
                <div className="pv-empty">Empty screen — add blocks from the left.</div>
              )}
            </div>
            {spec.navigation.type === 'tabs' && (
              <div className="phone-tabbar">
                {spec.navigation.tabs.map((t) => (
                  <span key={t.id} data-active={t.screenId === screenId}>{t.label}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="inspector">
        <h2>Inspector</h2>
        {screen && selected !== undefined && screen.components[selected] ? (
          <PropsInspector
            instance={screen.components[selected]!}
            onChange={(key, value) => edit(updateProp(spec, screenId, selected, key, value))}
            onMove={(dir) => {
              edit(moveComponent(spec, screenId, selected, dir));
              setSelected(Math.max(0, Math.min((screen.components.length ?? 1) - 1, selected + dir)));
            }}
            onRemove={() => {
              edit(removeComponent(spec, screenId, selected));
              setSelected(undefined);
            }}
          />
        ) : (
          <p className="pv-label">Select a block in the preview to edit its props.</p>
        )}
        {screen && selected !== undefined && screen.components[selected] && !byRef(screen.components[selected]!.ref) && (
          <p className="pv-label">Custom component — props edited as free-form.</p>
        )}
        <AiPanel
          onGenerated={refreshCustom}
          onInsert={(c) => {
            edit(addComponent(spec, screenId, { ref: c.manifest.ref, props: defaultPropsFor(c.manifest) }));
            setSelected(screen ? screen.components.length : 0);
          }}
        />
      </aside>
    </div>
  );
}

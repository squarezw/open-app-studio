'use client';

import type { ComponentInstance } from '@oas/app-spec';

/** Lightweight HTML preview of a block instance inside the phone frame. */
export default function BlockPreview({ instance }: { instance: ComponentInstance }) {
  const p = instance.props ?? {};
  const kind = instance.ref.split('/').pop()!;

  switch (kind) {
    case 'button-primary':
      return <div className="pv-btn pv-btn-primary">{text(p.label, 'Button')}</div>;
    case 'button-secondary':
      return <div className="pv-btn pv-btn-secondary">{text(p.label, 'Button')}</div>;
    case 'text-block':
      return <p className="pv-text">{text(p.text, 'Text')}</p>;
    case 'search-bar':
      return <div className="pv-input">🔍 {text(p.placeholder, 'Search')}</div>;
    case 'text-input':
      return (
        <div>
          <div className="pv-label">{text(p.label, 'Label')}</div>
          <div className="pv-input">{p.keyboard === 'password' ? '••••••' : ' '}</div>
        </div>
      );
    case 'form-group': {
      const fields = Array.isArray(p.fields) ? (p.fields as Array<{ label?: string }>) : [];
      return (
        <div className="pv-stack">
          {(fields.length > 0 ? fields : [{ label: 'Field' }]).map((f, i) => (
            <div key={i}>
              <div className="pv-label">{f.label ?? `Field ${i + 1}`}</div>
              <div className="pv-input"> </div>
            </div>
          ))}
        </div>
      );
    }
    case 'list':
    case 'infinite-feed':
    case 'settings-list':
      return (
        <div className="pv-panel">
          {[1, 2, 3].map((i) => (
            <div key={i} className="pv-row">
              <span className="pv-thumb" />
              <span className="pv-row-body">
                <span className="pv-row-title">Item {i}</span>
                <span className="pv-row-sub">{text(p.items, '$items')}</span>
              </span>
              {kind === 'settings-list' && <span className="pv-toggle" data-on={i % 2 === 0} />}
            </div>
          ))}
        </div>
      );
    case 'cart-item-list':
      return (
        <div className="pv-panel">
          {[1, 2].map((i) => (
            <div key={i} className="pv-row">
              <span className="pv-thumb" />
              <span className="pv-row-body">
                <span className="pv-row-title">Item {i}</span>
                <span className="pv-row-sub">${i * 7}.00</span>
              </span>
              <span className="pv-stepper">− 1 ＋</span>
            </div>
          ))}
        </div>
      );
    case 'checkout-summary':
      return (
        <div className="pv-stack">
          <div className="pv-panel">
            <div className="pv-row"><span className="pv-row-title">Order items</span></div>
          </div>
          <div className="pv-price"><span>Total</span><b>$42.00</b></div>
          <div className="pv-btn pv-btn-primary">Pay now</div>
        </div>
      );
    case 'price-row':
      return (
        <div className="pv-price">
          <span>{text(p.label, 'Label')}</span>
          <b>{text(p.amount, '$0.00')}</b>
        </div>
      );
    case 'grid':
      return (
        <div className="pv-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="pv-cell">
              <span className="pv-cell-img" />
              <span className="pv-row-title">Item {i}</span>
            </div>
          ))}
        </div>
      );
    case 'carousel':
      return (
        <div className="pv-carousel">
          {[1, 2, 3].map((i) => (
            <div key={i} className="pv-cell" style={{ minWidth: 110 }}>
              <span className="pv-cell-img" />
              <span className="pv-row-title">Card {i}</span>
            </div>
          ))}
        </div>
      );
    case 'avatar-header':
      return (
        <div className="pv-avatar-header">
          <span className="pv-avatar" />
          <span className="pv-row-title">{text(p.name, 'Guest')}</span>
        </div>
      );
    case 'detail-header':
      return (
        <div className="pv-stack">
          <span className="pv-hero" />
          <span className="pv-row-title">{text(p.title, 'Title')}</span>
        </div>
      );
    case 'image':
      return <span className="pv-hero" />;
    case 'dialog':
      return (
        <div className="pv-dialog">
          <span className="pv-row-title">{text(p.title, 'Dialog')}</span>
          <span className="pv-row-sub">{text(p.message, '')}</span>
        </div>
      );
    case 'toast':
      return <div className="pv-toast">{text(p.message, 'Toast')}</div>;
    case 'empty-state':
      return <div className="pv-empty">{text(p.message, 'Nothing here yet')}</div>;
    case 'skeleton':
      return (
        <div className="pv-stack">
          {[1, 2, 3].map((i) => <span key={i} className="pv-skeleton" />)}
        </div>
      );
    default:
      return (
        <div className="pv-generic">
          <span className="pv-generic-name">{kind}</span>
          <span className="pv-row-sub">{summarize(p)}</span>
        </div>
      );
  }
}

function text(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value.startsWith('$') ? `⟨${value}⟩` : value;
  return fallback;
}

function summarize(props: Record<string, unknown>): string {
  const keys = Object.keys(props);
  return keys.length > 0 ? keys.join(' · ') : 'no props';
}

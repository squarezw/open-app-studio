import { XMLParser } from 'fast-xml-parser';
import type { Rect, UiNode } from '@oas/flow-graph';

interface RawNode {
  class?: string;
  'resource-id'?: string;
  text?: string;
  'content-desc'?: string;
  bounds?: string;
  clickable?: string;
  scrollable?: string;
  enabled?: string;
  focusable?: string;
  node?: RawNode | RawNode[];
}

const BOUNDS_RE = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

function parseBounds(raw: string | undefined): Rect | undefined {
  if (!raw) return undefined;
  const m = BOUNDS_RE.exec(raw);
  if (!m) return undefined;
  const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function toUiNode(raw: RawNode): UiNode {
  const childrenRaw = raw.node === undefined ? [] : Array.isArray(raw.node) ? raw.node : [raw.node];
  return {
    className: raw.class ?? 'unknown',
    ...(raw['resource-id'] ? { resourceId: raw['resource-id'] } : {}),
    ...(raw.text ? { text: raw.text } : {}),
    ...(raw['content-desc'] ? { contentDesc: raw['content-desc'] } : {}),
    ...(parseBounds(raw.bounds) ? { bounds: parseBounds(raw.bounds) } : {}),
    clickable: raw.clickable === 'true',
    scrollable: raw.scrollable === 'true',
    enabled: raw.enabled !== 'false',
    focusable: raw.focusable === 'true',
    children: childrenRaw.map(toUiNode),
  };
}

/** Parses `uiautomator dump` XML into a normalized UiNode tree. */
export function parseUiautomatorXml(xml: string): UiNode {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    parseTagValue: false,
  });
  const doc = parser.parse(xml) as { hierarchy?: { node?: RawNode | RawNode[] } };
  const rootRaw = doc.hierarchy?.node;
  if (!rootRaw) throw new Error('uiautomator dump: no <node> under <hierarchy>');
  const roots = Array.isArray(rootRaw) ? rootRaw : [rootRaw];
  if (roots.length === 1) return toUiNode(roots[0]!);
  return { className: 'hierarchy', enabled: true, children: roots.map(toUiNode) };
}

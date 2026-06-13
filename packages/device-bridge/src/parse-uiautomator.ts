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

/**
 * Parses Appium UiAutomator2 `getPageSource` XML. Unlike `uiautomator dump`
 * (generic `<node class=…>`), Appium names each element tag after its class
 * (e.g. `<android.widget.EditText resource-id=… text=… bounds=…>`), so we walk
 * with preserveOrder and read the `class` attribute. Same attribute names.
 */
export function parseAppiumSource(xml: string): UiNode {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    parseTagValue: false,
    preserveOrder: true,
  });
  const doc = parser.parse(xml) as OrderedNode[];
  const hierarchy = doc.find((n) => 'hierarchy' in n);
  if (!hierarchy) throw new Error('appium source: no <hierarchy> root');
  const roots = (hierarchy.hierarchy as OrderedNode[]).filter(isElement);
  if (roots.length === 1) return orderedToUiNode(roots[0]!);
  return { className: 'hierarchy', enabled: true, children: roots.map(orderedToUiNode) };
}

type OrderedNode = Record<string, unknown> & { ':@'?: Record<string, string> };

function isElement(n: OrderedNode): boolean {
  return Object.keys(n).some((k) => k !== ':@');
}

function orderedToUiNode(elem: OrderedNode): UiNode {
  const tag = Object.keys(elem).find((k) => k !== ':@') ?? 'unknown';
  const a = elem[':@'] ?? {};
  const childrenRaw = (elem[tag] as OrderedNode[] | undefined)?.filter(isElement) ?? [];
  return {
    className: a['class'] || tag,
    ...(a['resource-id'] ? { resourceId: a['resource-id'] } : {}),
    ...(a['text'] ? { text: a['text'] } : {}),
    ...(a['content-desc'] ? { contentDesc: a['content-desc'] } : {}),
    ...(parseBounds(a['bounds']) ? { bounds: parseBounds(a['bounds']) } : {}),
    clickable: a['clickable'] === 'true',
    scrollable: a['scrollable'] === 'true',
    enabled: a['enabled'] !== 'false',
    focusable: a['focusable'] === 'true',
    children: childrenRaw.map(orderedToUiNode),
  };
}

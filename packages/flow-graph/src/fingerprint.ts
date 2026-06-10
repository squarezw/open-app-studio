import { createHash } from 'node:crypto';
import type { UiNode } from './types.js';

/**
 * Structural layout hash: identifies a screen by element types and hierarchy,
 * ignoring text content, so content variants of one screen map to one node.
 *
 * Consecutive identical sibling subtrees collapse to a single entry — a feed
 * with 5 items and the same feed with 50 items produce the same fingerprint.
 */
export function fingerprint(root: UiNode): string {
  const digest = createHash('sha1').update(serialize(root, 0)).digest('hex');
  return `lh1:${digest}`;
}

function serialize(node: UiNode, depth: number): string {
  const own = [
    depth,
    node.className,
    node.resourceId ?? '',
    node.clickable ? 'c' : '',
    node.scrollable ? 's' : '',
  ].join('|');

  const childSerialized = node.children.map((c) => serialize(c, depth + 1));
  const collapsed: string[] = [];
  for (const s of childSerialized) {
    if (collapsed[collapsed.length - 1] !== s) collapsed.push(s);
  }
  return collapsed.length > 0 ? `${own}\n${collapsed.join('\n')}` : own;
}

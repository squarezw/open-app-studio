import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@oas/app-spec';
import { byRef } from '@oas/component-registry';
import {
  addComponent,
  apply,
  defaultPropsFor,
  initHistory,
  moveComponent,
  redo,
  removeComponent,
  undo,
  updateProp,
} from '../lib/blueprint.js';

const SPEC: AppSpec = {
  version: '0.1',
  app: { name: 'Demo' },
  navigation: { type: 'stack', initial: 'home' },
  screens: [
    {
      id: 'home',
      title: 'Home',
      components: [
        { ref: 'oas/text-block', props: { text: 'hello' } },
        { ref: 'oas/button-primary', props: { label: 'Go', onPress: { navigate: 'home' } } },
      ],
    },
  ],
};

describe('spec operations are immutable', () => {
  it('updates a prop without touching the original', () => {
    const next = updateProp(SPEC, 'home', 0, 'text', 'world');
    expect(next.screens[0]!.components[0]!.props!.text).toBe('world');
    expect(SPEC.screens[0]!.components[0]!.props!.text).toBe('hello');
  });

  it('adds, removes, and reorders components', () => {
    const added = addComponent(SPEC, 'home', { ref: 'oas/list', props: {} });
    expect(added.screens[0]!.components).toHaveLength(3);

    const removed = removeComponent(added, 'home', 0);
    expect(removed.screens[0]!.components.map((c) => c.ref)).toEqual(['oas/button-primary', 'oas/list']);

    const moved = moveComponent(SPEC, 'home', 0, 1);
    expect(moved.screens[0]!.components.map((c) => c.ref)).toEqual(['oas/button-primary', 'oas/text-block']);
    // out-of-range moves are no-ops
    expect(moveComponent(SPEC, 'home', 0, -1).screens[0]!.components[0]!.ref).toBe('oas/text-block');
  });
});

describe('history', () => {
  it('undo/redo walk the edit stack; new edits clear the future', () => {
    let h = initHistory(SPEC);
    h = apply(h, updateProp(h.present, 'home', 0, 'text', 'v1'));
    h = apply(h, updateProp(h.present, 'home', 0, 'text', 'v2'));
    expect(h.present.screens[0]!.components[0]!.props!.text).toBe('v2');

    h = undo(h);
    expect(h.present.screens[0]!.components[0]!.props!.text).toBe('v1');
    h = redo(h);
    expect(h.present.screens[0]!.components[0]!.props!.text).toBe('v2');

    h = undo(h);
    h = apply(h, updateProp(h.present, 'home', 0, 'text', 'branch'));
    expect(h.future).toHaveLength(0);
    expect(undo(undo(undo(h))).present.screens[0]!.components[0]!.props!.text).toBe('hello');
  });
});

describe('defaultPropsFor', () => {
  it('seeds required and defaulted props from the manifest', () => {
    const button = defaultPropsFor(byRef('oas/button-primary')!);
    expect(button.label).toBe('Primary Button');
    const list = defaultPropsFor(byRef('oas/list')!);
    expect(list.items).toBe('$data.items');
    const grid = defaultPropsFor(byRef('oas/grid')!);
    expect(grid.columns).toBe(2);
  });
});

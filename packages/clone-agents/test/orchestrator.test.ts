import { describe, expect, it } from 'vitest';
import { FakeDriver } from '@oas/device-bridge';
import { replayScript, type GraphEvent } from '@oas/flow-graph';
import { Orchestrator } from '../src/orchestrator.js';

describe('Orchestrator (fake demo shop)', () => {
  it('explores, annotates roles, and derives named flows', async () => {
    const orchestrator = new Orchestrator(new FakeDriver(), { appId: 'com.fakeshop', maxActions: 60 });
    const ifg = await orchestrator.run();

    // 6 screens: home, search, profile, settings, cart, checkout
    expect(ifg.nodes).toHaveLength(6);
    expect(ifg.frontier).toHaveLength(0);

    const roles = new Map(ifg.nodes.map((n) => [n.title, n.role]));
    expect(roles.get('FakeShop Home')).toBe('launch');
    expect(roles.get('Search products')).toBe('search');
    expect(roles.get('My Profile')).toBe('profile');
    expect(roles.get('Settings')).toBe('settings');
    expect(roles.get('Shopping Cart')).toBe('cart');
    expect(roles.get('Checkout — payment')).toBe('checkout');

    const flowNames = (ifg.flows ?? []).map((f) => f.name).sort();
    expect(flowNames).toContain('To Shopping Cart');
    expect(flowNames).toContain('To Checkout — payment');

    // Every derived flow must be replayable as Maestro YAML.
    for (const flow of ifg.flows ?? []) {
      const yaml = replayScript(ifg, flow);
      expect(yaml).toContain('- launchApp');
      expect(yaml).toContain('tapOn');
    }
    const checkoutFlow = ifg.flows!.find((f) => f.name === 'To Checkout — payment')!;
    expect(checkoutFlow.edgeIds).toHaveLength(2); // home → cart → checkout
  });

  it('streams graph events while exploring', async () => {
    const events: GraphEvent[] = [];
    const orchestrator = new Orchestrator(new FakeDriver(), { appId: 'com.fakeshop', maxActions: 60 });
    orchestrator.on('graph', (e: GraphEvent) => events.push(e));
    await orchestrator.run();

    const newNodes = events.filter((e) => e.type === 'node' && e.isNew);
    const newEdges = events.filter((e) => e.type === 'edge' && e.isNew);
    expect(newNodes).toHaveLength(6);
    expect(newEdges.length).toBeGreaterThanOrEqual(5);
  });

  it('stops when discovery stalls', async () => {
    // Stall threshold 2 on an app whose home screen has 3 branches:
    // exploration must end early without exhausting the whole app.
    const orchestrator = new Orchestrator(new FakeDriver(), {
      appId: 'com.fakeshop',
      maxActions: 60,
      stallThreshold: 2,
    });
    const logs: string[] = [];
    orchestrator.on('log', (m: string) => logs.push(m));
    const ifg = await orchestrator.run();
    expect(ifg.meta.coverage!.actions!).toBeLessThan(15);
  });

  it('supports cooperative stop()', async () => {
    const orchestrator = new Orchestrator(new FakeDriver(), { appId: 'com.fakeshop', maxActions: 1000 });
    orchestrator.on('graph', () => orchestrator.stop());
    const ifg = await orchestrator.run();
    expect(ifg.meta.coverage!.actions!).toBeLessThanOrEqual(2);
  });

  it('pauses and resumes', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const orchestrator = new Orchestrator(new FakeDriver(), { appId: 'com.fakeshop', maxActions: 60 });
    const done = orchestrator.run();
    orchestrator.pause(); // set before the first loop iteration (still launching)
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    await sleep(900); // past the launch tab-bar probe; main loop is now blocked
    expect(finished).toBe(false); // paused → not progressing to completion
    orchestrator.resume();
    const ifg = await done;
    expect(ifg.nodes).toHaveLength(6); // resumes and finishes the whole app
  });
});

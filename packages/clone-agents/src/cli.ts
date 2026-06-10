#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AdbDriver, FakeDriver, type DeviceDriver } from '@oas/device-bridge';
import { replayScript, type InteractionFlowGraph } from '@oas/flow-graph';
import { fetchStoreMetadata, parseStoreUrl, provisionalIfgFromMetadata } from './acquirer.js';
import { Orchestrator } from './orchestrator.js';

const HELP = `oas-spike — explore an app and emit an Interaction Flow Graph.

Usage:
  oas-spike --app <package>            explore an installed Android app (adb)
  oas-spike --url <store-url>          resolve a store link first:
                                         Play URL  → explore via adb
                                         App Store → provisional IFG from metadata
  oas-spike --app demo --driver fake   no-device demo on the built-in fake app

Options:
  --actions <n>     action budget (default 60)
  --stall <n>       stop after n actions with no new screen (default 50)
  --out <dir>       output directory (default runs/spike-<app>-<ts>)
  --serial <id>     adb device serial
  --driver <name>   adb | fake (default adb)

Output: <out>/ifg.json, <out>/screens/*.png, <out>/flows/*.yaml (Maestro replay)
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      url: { type: 'string' },
      actions: { type: 'string', default: '60' },
      stall: { type: 'string', default: '50' },
      out: { type: 'string' },
      serial: { type: 'string' },
      driver: { type: 'string', default: 'adb' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help || (!values.app && !values.url)) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  let appId = values.app;
  let appName: string | undefined;
  let storeUrl: string | undefined;

  if (values.url) {
    const ref = parseStoreUrl(values.url);
    storeUrl = ref.storeUrl;
    if (ref.platform === 'ios') {
      const meta = await fetchStoreMetadata(ref);
      const ifg = provisionalIfgFromMetadata(meta);
      const outDir = values.out ?? join('runs', `inferred-${meta.appId}`);
      await mkdir(outDir, { recursive: true });
      const ifgPath = join(outDir, 'ifg.json');
      await writeFile(ifgPath, JSON.stringify(ifg, null, 2));
      console.log(`iOS device exploration is not supported yet (see roadmap M4).`);
      console.log(`Wrote PROVISIONAL graph inferred from ${ifg.nodes.length} store screenshots → ${ifgPath}`);
      return;
    }
    appId = ref.appId;
    const meta = await fetchStoreMetadata(ref).catch(() => undefined);
    appName = meta?.name;
  }

  const outDir = values.out ?? join('runs', `spike-${appId}-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const driver: DeviceDriver =
    values.driver === 'fake' ? new FakeDriver() : new AdbDriver({ serial: values.serial });

  console.log(`Exploring ${appName ?? appId} (budget: ${values.actions} actions) → ${outDir}`);
  const orchestrator = new Orchestrator(driver, {
    appId: appId!,
    appName,
    storeUrl,
    maxActions: Number(values.actions),
    stallThreshold: Number(values.stall),
    outDir,
  });
  orchestrator.on('log', (m: string) => console.log(m));

  const ifg = await orchestrator.run();
  await writeOutputs(ifg, outDir);
}

async function writeOutputs(ifg: InteractionFlowGraph, outDir: string): Promise<void> {
  const ifgPath = join(outDir, 'ifg.json');
  await writeFile(ifgPath, JSON.stringify(ifg, null, 2));

  const flowsDir = join(outDir, 'flows');
  await mkdir(flowsDir, { recursive: true });
  for (const flow of ifg.flows ?? []) {
    await writeFile(join(flowsDir, `${flow.id}.yaml`), replayScript(ifg, flow));
  }

  const c = ifg.meta.coverage!;
  console.log('\n=== Exploration summary ===');
  console.log(`screens discovered : ${c.nodes}`);
  console.log(`transitions        : ${c.edges}`);
  console.log(`actions executed   : ${c.actions}`);
  console.log(`frontier (untried) : ${c.frontier}`);
  console.log(`named flows        : ${ifg.flows?.length ?? 0}`);
  for (const f of ifg.flows ?? []) console.log(`  - ${f.name} (${f.edgeIds.length} steps) → flows/${f.id}.yaml`);
  console.log(`graph written to   : ${ifgPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

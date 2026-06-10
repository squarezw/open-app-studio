#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AdbDriver } from '@oas/device-bridge';
import { explore } from './heuristic-explorer.js';

const HELP = `oas-spike — M0 exploration spike: walk an Android app, emit an Interaction Flow Graph.

Usage:
  oas-spike --app <package> [--actions 60] [--out runs/spike] [--serial <adb-serial>]

Requires: adb on PATH, one running emulator/device with the app installed.
Output:   <out>/ifg.json + <out>/screens/*.png
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      actions: { type: 'string', default: '60' },
      out: { type: 'string' },
      serial: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help || !values.app) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const appId = values.app!;
  const outDir = values.out ?? join('runs', `spike-${appId}-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const driver = new AdbDriver({ serial: values.serial });
  console.log(`Exploring ${appId} (budget: ${values.actions} actions) → ${outDir}`);

  const ifg = await explore(driver, {
    appId,
    maxActions: Number(values.actions),
    outDir,
    log: (m) => console.log(m),
  });

  const ifgPath = join(outDir, 'ifg.json');
  await writeFile(ifgPath, JSON.stringify(ifg, null, 2));

  const c = ifg.meta.coverage!;
  console.log('\n=== Exploration summary ===');
  console.log(`screens discovered : ${c.nodes}`);
  console.log(`transitions        : ${c.edges}`);
  console.log(`actions executed   : ${c.actions}`);
  console.log(`frontier (untried) : ${c.frontier}`);
  console.log(`graph written to   : ${ifgPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

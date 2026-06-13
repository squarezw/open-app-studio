#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { AdbDriver, AppiumDriver, FakeDriver, type DeviceDriver } from '@oas/device-bridge';
import { renderScorecard, runDeviceBenchmark } from './benchmark.js';

const HELP = `oas-bench — score a DeviceDriver against OAS's reliability pain cases.

Navigate the device to a representative screen (e.g. an address form with
text fields + dropdowns) FIRST, then run this for each driver to compare.

Usage:
  oas-bench --driver adb [--serial <id>] [--out bench/adb.md]
  oas-bench --driver appium [--appium-url http://127.0.0.1:4723] [--out bench/appium.md]
  oas-bench --driver fake        # smoke-test the harness with no device

Probes: dup-resourceId · keyboard-detect · text-replace · scroll-coverage · latency
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      driver: { type: 'string', default: 'adb' },
      serial: { type: 'string' },
      out: { type: 'string' },
      'appium-url': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const driver: DeviceDriver =
    values.driver === 'fake'
      ? new FakeDriver()
      : values.driver === 'appium'
        ? new AppiumDriver({ baseUrl: values['appium-url'], serial: values.serial, log: (m) => console.log(`[appium] ${m}`) })
        : new AdbDriver({ serial: values.serial, log: (m) => console.log(`[adb] ${m}`) });

  const card = await runDeviceBenchmark(driver, { log: (m) => console.log(m) });
  const md = renderScorecard(card, values.driver!);
  console.log('\n' + md);

  if (values.out) {
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, md);
    await writeFile(join(dirname(values.out), `${values.driver}.json`), JSON.stringify(card, null, 2));
    console.log(`written → ${values.out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { compileBlueprint, type AppSpec } from '@oas/app-spec';
import type { InteractionFlowGraph } from '@oas/flow-graph';
import { generateProject, writeProject } from './generate.js';

const HELP = `oas-codegen — generate a runnable Expo project from a clone run or an App Spec.

Usage:
  oas-codegen --ifg runs/spike/ifg.json --out build/my-app [--name "My App"]
  oas-codegen --spec spec.json --out build/my-app

Output: a standalone expo-router project (+ e2e/*.yaml Maestro flows when --ifg is used).
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      ifg: { type: 'string' },
      spec: { type: 'string' },
      out: { type: 'string' },
      name: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help || (!values.ifg && !values.spec) || !values.out) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  let spec: AppSpec;
  let ifg: InteractionFlowGraph | undefined;
  if (values.spec) {
    spec = JSON.parse(await readFile(values.spec!, 'utf8')) as AppSpec;
  } else {
    ifg = JSON.parse(await readFile(values.ifg!, 'utf8')) as InteractionFlowGraph;
    spec = compileBlueprint(ifg, { appName: values.name });
  }

  const files = generateProject(spec, { ifg });
  await writeProject(files, values.out!);

  console.log(`Generated ${files.length} files → ${values.out}`);
  console.log(`  screens : ${spec.screens.length}`);
  console.log(`  nav     : ${spec.navigation.type}`);
  console.log(`  e2e     : ${files.filter((f) => f.path.startsWith('e2e/')).length} Maestro flows`);
  console.log(`\nNext:\n  cd ${values.out}\n  npm install && npx expo start`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

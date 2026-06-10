import type { AppSpec } from '@oas/app-spec';
import type { InteractionFlowGraph } from '@oas/flow-graph';

/**
 * Re-targets the IFG's named flows at the GENERATED app: original selectors
 * (resource ids of the cloned app) are mapped to the generated UI's button
 * labels and tab labels. The output is Maestro YAML — the cloned app's
 * observed behavior becomes the rebuilt app's acceptance tests.
 */
export function e2eFlows(spec: AppSpec, ifg: InteractionFlowGraph): Map<string, string> {
  const out = new Map<string, string>();
  const screenOf = invertProvenance(spec);
  if (!screenOf) return out;

  const buttonLabel = new Map<string, string>();
  for (const screen of spec.screens) {
    for (const c of screen.components) {
      const onPress = c.props?.onPress as { navigate?: string } | undefined;
      const label = c.props?.label;
      if (c.ref.startsWith('oas/button') && onPress?.navigate && typeof label === 'string') {
        buttonLabel.set(`${screen.id}→${onPress.navigate}`, label);
      }
    }
  }
  const tabLabel = new Map<string, string>(
    spec.navigation.type === 'tabs' ? spec.navigation.tabs.map((t) => [t.screenId, t.label]) : [],
  );

  const edgeById = new Map(ifg.edges.map((e) => [e.id, e]));
  for (const flow of ifg.flows ?? []) {
    const lines = [`appId: ${spec.app.appId ?? spec.app.name}`, `# ${flow.name} — regenerated for the rebuilt app`, '---', '- launchApp'];
    let complete = true;
    for (const edgeId of flow.edgeIds) {
      const edge = edgeById.get(edgeId);
      const from = edge && screenOf.get(edge.from);
      const to = edge && screenOf.get(edge.to);
      if (!edge || !from || !to) {
        complete = false;
        lines.push(`# unmapped step: ${edgeId}`);
        continue;
      }
      if (edge.action.kind === 'back') {
        lines.push('- back');
        continue;
      }
      const label = buttonLabel.get(`${from}→${to}`) ?? tabLabel.get(to);
      if (label) {
        lines.push(`- tapOn: ${JSON.stringify(label)}`);
      } else {
        complete = false;
        lines.push(`# unmapped step: ${from} → ${to}`);
      }
    }
    if (!complete) lines.splice(1, 0, '# WARNING: contains unmapped steps — review before running');
    out.set(`${flow.id}.yaml`, `${lines.join('\n')}\n`);
  }
  return out;
}

function invertProvenance(spec: AppSpec): Map<string, string> | undefined {
  const source = spec.meta?.sourceNodeIds;
  if (!source) return undefined;
  return new Map(Object.entries(source).map(([screenId, nodeId]) => [nodeId, screenId]));
}

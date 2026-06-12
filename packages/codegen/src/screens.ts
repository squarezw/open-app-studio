import type { ScreenSpec } from '@oas/app-spec';
import { componentName, propsToJsx, usesBinding, usesRouter, usesSubmit } from './props.js';

/** Emits one expo-router screen file (app/<id>.tsx) from a ScreenSpec. */
export function screenFile(screen: ScreenSpec, customRefs: Set<string> = new Set()): string {
  const builtinNames = [
    ...new Set(screen.components.filter((c) => !customRefs.has(c.ref)).map((c) => componentName(c.ref))),
  ].sort();
  const customNames = [
    ...new Set(screen.components.filter((c) => customRefs.has(c.ref)).map((c) => componentName(c.ref))),
  ].sort();
  const needsResolve = screen.components.some((c) => usesBinding(c.props));
  const needsRouter = screen.components.some((c) => usesRouter(c.props));
  const needsSubmit = screen.components.some((c) => usesSubmit(c.props));

  const rnImports = [...(needsSubmit ? ['Alert'] : []), 'ScrollView'];
  const imports = [
    needsRouter ? `import { router } from 'expo-router';` : undefined,
    `import { ${rnImports.join(', ')} } from 'react-native';`,
    builtinNames.length > 0 ? `import { ${builtinNames.join(', ')} } from '../components/oas';` : undefined,
    ...customNames.map((name) => `import { ${name} } from '../components/custom/${name}';`),
    needsResolve ? `import { resolve } from '../state/app-data';` : undefined,
    `import { colors } from '../theme/tokens';`,
  ].filter(Boolean);

  const body = screen.components
    .map((c) => `      <${componentName(c.ref)}${propsToJsx(c.props)} />`)
    .join('\n');

  const submitHelper = needsSubmit
    ? `\nfunction submit() {\n  Alert.alert('${escapeSingle(screen.title ?? screen.id)}', 'Submitted. Wire this to your backend.');\n}\n`
    : '\n';

  return `${imports.join('\n')}
${submitHelper}
export default function ${pascal(screen.id)}() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
${body}
    </ScrollView>
  );
}
`;
}

function pascal(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function escapeSingle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

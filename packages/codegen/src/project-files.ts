import type { AppSpec } from '@oas/app-spec';

export function packageJson(spec: AppSpec): string {
  return `${JSON.stringify(
    {
      name: spec.app.appId?.split('.').pop() ?? 'oas-app',
      version: '0.1.0',
      main: 'expo-router/entry',
      scripts: {
        start: 'expo start',
        android: 'expo start --android',
        ios: 'expo start --ios',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        expo: '~52.0.0',
        'expo-constants': '~17.0.3',
        'expo-linking': '~7.0.3',
        'expo-router': '~4.0.9',
        'expo-status-bar': '~2.0.0',
        react: '18.3.1',
        'react-native': '0.76.5',
        'react-native-safe-area-context': '4.12.0',
        'react-native-screens': '~4.1.0',
      },
      devDependencies: {
        '@babel/core': '^7.25.0',
        '@types/react': '~18.3.12',
        typescript: '~5.3.3',
      },
      private: true,
    },
    null,
    2,
  )}\n`;
}

export function appJson(spec: AppSpec): string {
  const appId = spec.app.appId ?? 'dev.openappstudio.app';
  return `${JSON.stringify(
    {
      expo: {
        name: spec.app.name,
        slug: appId.split('.').pop() ?? 'oas-app',
        version: '0.1.0',
        scheme: 'oasapp',
        orientation: 'portrait',
        userInterfaceStyle: 'dark',
        newArchEnabled: true,
        ios: { bundleIdentifier: appId, supportsTablet: true },
        android: { package: appId },
        plugins: ['expo-router'],
      },
    },
    null,
    2,
  )}\n`;
}

export function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      extends: 'expo/tsconfig.base',
      compilerOptions: { strict: true },
      include: ['**/*.ts', '**/*.tsx', '.expo/types/**/*.ts', 'expo-env.d.ts'],
    },
    null,
    2,
  )}\n`;
}

export function layoutFile(spec: AppSpec): string {
  const screenIds = spec.screens.map((s) => s.id);
  const titles = new Map(spec.screens.map((s) => [s.id, s.title ?? s.id]));

  if (spec.navigation.type === 'tabs') {
    const tabScreens = new Set(spec.navigation.tabs.map((t) => t.screenId));
    const entries = [
      ...spec.navigation.tabs.map(
        (t) => `      <Tabs.Screen name="${t.screenId}" options={{ title: ${JSON.stringify(t.label)} }} />`,
      ),
      ...screenIds
        .filter((id) => !tabScreens.has(id))
        .map((id) => `      <Tabs.Screen name="${id}" options={{ title: ${JSON.stringify(titles.get(id))}, href: null }} />`),
      `      <Tabs.Screen name="index" options={{ href: null }} />`,
    ];
    return `import { Tabs } from 'expo-router';
import { colors } from '../theme/tokens';

export default function Layout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.panel },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
${entries.join('\n')}
    </Tabs>
  );
}
`;
  }

  const entries = screenIds.map(
    (id) => `      <Stack.Screen name="${id}" options={{ title: ${JSON.stringify(titles.get(id))} }} />`,
  );
  return `import { Stack } from 'expo-router';
import { colors } from '../theme/tokens';

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.panel },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
${entries.join('\n')}
    </Stack>
  );
}
`;
}

export function indexFile(spec: AppSpec): string {
  const initial = spec.navigation.type === 'tabs' ? spec.navigation.tabs[0]!.screenId : spec.navigation.initial;
  return `import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/${initial}" />;
}
`;
}

/** Demo seed data for every binding referenced by the spec, so the app renders content out of the box. */
export function appDataFile(spec: AppSpec): string {
  const bindings = collectBindings(spec);
  const entries = bindings.map((path) => `  ${JSON.stringify(path)}: ${JSON.stringify(seedFor(path))},`);
  return `/** Demo data seeds — replace with real data sources. */
export const appData: Record<string, unknown> = {
${entries.join('\n')}
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolve(path: string): any {
  return appData[path];
}
`;
}

function collectBindings(spec: AppSpec): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && value.startsWith('$')) found.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
  };
  for (const screen of spec.screens) for (const c of screen.components) visit(c.props);
  return [...found].sort();
}

function seedFor(path: string): unknown {
  const p = path.toLowerCase();
  if (/(items|feed|results|settings|profileitems|onboardingslides|markers|options|tabs)$/.test(p)) {
    const withAmount = p.includes('cart');
    const withToggle = p.includes('settings');
    return Array.from({ length: 6 }, (_, i) => ({
      id: `i${i + 1}`,
      title: `Demo item ${i + 1}`,
      subtitle: withToggle ? undefined : 'Replace me in state/app-data.ts',
      image: withToggle ? undefined : `https://picsum.photos/seed/oas${i}/96`,
      amount: withAmount ? `$${(i + 1) * 7}.00` : undefined,
      value: withToggle ? i % 2 === 0 : undefined,
    }));
  }
  if (/(total|amount|price)$/.test(p)) return '$42.00';
  if (/name$/.test(p)) return 'Ada Lovelace';
  if (/(avatar|image)/.test(p)) return 'https://picsum.photos/seed/oas/200';
  if (/url$/.test(p)) return 'https://openappstudio.dev';
  if (/(description|text)$/.test(p)) return 'Generated by Open App Studio — edit state/app-data.ts to change this copy.';
  return 'Demo value';
}

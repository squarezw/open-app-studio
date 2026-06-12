import ts from 'typescript';
import type { ComponentManifest } from '@oas/component-registry';

/**
 * Static sandbox for AI-generated components. Generated code reaches the user
 * only after passing every check; failures feed back into the repair loop.
 *
 * Checks: TSX parses · imports allowlisted (react / react-native / theme
 * tokens only) · no dynamic code or I/O primitives · exports a function named
 * after the manifest ref · manifest is well-formed.
 *
 * (Full semantic typecheck + headless render happen in the generated-project
 * context, where react-native's real types exist — roadmap M3 polish.)
 */

const ALLOWED_IMPORTS = new Set(['react', 'react-native', '../theme/tokens']);
const BANNED = [
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\.\w/,
  /\bglobalThis\b/,
  /\bDeno\b/,
];

const PATTERN_KINDS = new Set([
  'tabbar', 'navbar', 'drawer', 'list', 'grid', 'card', 'carousel', 'form', 'button',
  'input', 'picker', 'map', 'video', 'chart', 'dialog', 'toast', 'empty', 'other',
]);

export function sandboxCheck(manifest: ComponentManifest, tsx: string): string[] {
  const errors: string[] = [];

  // Manifest shape
  if (!/^custom\/[a-z0-9][a-z0-9-]*$/.test(manifest.ref ?? '')) {
    errors.push(`manifest.ref must match custom/<kebab-case>, got "${manifest.ref}"`);
  }
  if (!manifest.name) errors.push('manifest.name is required');
  if (!Array.isArray(manifest.patterns) || manifest.patterns.length === 0) {
    errors.push('manifest.patterns must list at least one pattern kind');
  } else {
    for (const p of manifest.patterns) {
      if (!PATTERN_KINDS.has(p)) errors.push(`unknown pattern kind "${p}"`);
    }
  }
  const propNames = (manifest.props ?? []).map((p) => p.name);
  if (new Set(propNames).size !== propNames.length) errors.push('manifest.props names must be unique');

  // Parse TSX
  const source = ts.createSourceFile('component.tsx', tsx, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const transpiled = ts.transpileModule(tsx, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  for (const d of transpiled.diagnostics ?? []) {
    errors.push(`TSX error: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }

  // Imports allowlist + named export check via AST
  const expectedName = componentName(manifest.ref ?? '');
  let exportsComponent = false;
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!ALLOWED_IMPORTS.has(spec)) {
        errors.push(`import "${spec}" is not allowed (only: ${[...ALLOWED_IMPORTS].join(', ')})`);
      }
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === expectedName &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      exportsComponent = true;
    }
  });
  if (!exportsComponent) {
    errors.push(`must contain: export function ${expectedName}(props) { … }`);
  }

  // Banned constructs
  for (const re of BANNED) {
    if (re.test(tsx)) errors.push(`banned construct: ${re.source}`);
  }

  return errors;
}

/** "custom/stat-ring" → "StatRing" */
export function componentName(ref: string): string {
  return (ref.split('/').pop() ?? '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

#!/usr/bin/env node

/**
 * Design Mode data-slot uniqueness checker
 *
 * Why:
 * - Taku Design Mode "apply/write-back" locates targets by searching TSX/JSX for `data-slot="<slot>"`.
 * - If a slot appears in multiple files (or multiple times in one file), write-back becomes ambiguous and will fail.
 * - If a slot is not a static string literal, write-back cannot locate it reliably and will fail.
 *
 * This script enforces:
 * - data-slot must be a static string literal in TSX/JSX
 * - each slot must be unique across scanned source files
 */

/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */

const fs = require('fs');
const path = require('path');

let ts;
try {
  ts = require('typescript');
} catch (error) {
  console.error('[slot-check] Missing dependency: typescript');
  console.error('[slot-check] Please run `pnpm install` and try again.');
  process.exit(1);
}

const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
};

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.next-edit',
  '.next-preview',
  '.git',
  '.turbo',
  '.vercel',
  'dist',
  'out',
  'build',
  'coverage',
]);

const ALLOWED_EXTS = new Set(['.tsx', '.jsx']);

function log(color, tag, message) {
  console.log(`${color}%s${colors.reset}`, tag, message);
}

function isInsideWorkspace(absPath, workspaceRoot) {
  return path.normalize(absPath).startsWith(path.normalize(workspaceRoot));
}

function walk(current, out, workspaceRoot) {
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(current, ent.name);
    if (!isInsideWorkspace(full, workspaceRoot)) continue;

    if (ent.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(ent.name)) continue;
      walk(full, out, workspaceRoot);
      continue;
    }

    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    out.push(full);
  }
}

function getAttrValueAsString(attr) {
  const init = attr.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const expr = init.expression;
    if (ts.isStringLiteral(expr)) return expr.text;
    if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  }
  return null;
}

function findJsxAttribute(opening, name) {
  const attrs = opening.attributes.properties;
  for (const p of attrs) {
    if (!ts.isJsxAttribute(p)) continue;
    if (p.name.getText() === name) return p;
  }
  return null;
}

function collectDataSlotOccurrences(filePath, fileText) {
  // quick filter: avoid parsing most files
  if (!fileText.includes('data-slot')) return { slots: [], dynamic: [] };

  const ext = path.extname(filePath).toLowerCase();
  const scriptKind = ext === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(filePath, fileText, ts.ScriptTarget.Latest, true, scriptKind);

  const slots = [];
  const dynamic = [];

  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const dataSlot = findJsxAttribute(node.openingElement, 'data-slot');
      if (dataSlot) recordAttr(dataSlot);
    } else if (ts.isJsxSelfClosingElement(node)) {
      const dataSlot = findJsxAttribute(node, 'data-slot');
      if (dataSlot) recordAttr(dataSlot);
    }

    ts.forEachChild(node, visit);
  };

  const recordAttr = (attr) => {
    const value = getAttrValueAsString(attr);
    const pos = attr.getStart(sf);
    const lc = ts.getLineAndCharacterOfPosition(sf, pos);
    const loc = { line: lc.line + 1, column: lc.character + 1 };

    if (typeof value === 'string' && value.trim()) {
      slots.push({ slot: value, loc });
      return;
    }

    dynamic.push({ loc });
  };

  visit(sf);
  return { slots, dynamic };
}

function formatLoc(relPath, loc) {
  return `${relPath}:${loc.line}:${loc.column}`;
}

function main() {
  const workspaceRoot = process.cwd();
  const srcRoot = path.join(workspaceRoot, 'src');
  if (!fs.existsSync(srcRoot)) {
    log(colors.yellow, '[slot-check]', 'No src/ directory found, skipping.');
    return;
  }

  const files = [];
  walk(srcRoot, files, workspaceRoot);

  const occurrences = new Map(); // slot -> [{ file, loc }]
  const dynamicIssues = []; // [{ file, loc }]
  let parsedFiles = 0;

  for (const abs of files) {
    let raw;
    try {
      raw = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }

    const res = collectDataSlotOccurrences(abs, raw);
    if (res.slots.length === 0 && res.dynamic.length === 0) continue;
    parsedFiles += 1;

    const rel = path.relative(workspaceRoot, abs);
    for (const entry of res.slots) {
      const list = occurrences.get(entry.slot) ?? [];
      list.push({ file: rel, loc: entry.loc });
      occurrences.set(entry.slot, list);
    }
    for (const d of res.dynamic) {
      dynamicIssues.push({ file: rel, loc: d.loc });
    }
  }

  const duplicates = [];
  for (const [slot, list] of occurrences.entries()) {
    if (list.length > 1) duplicates.push([slot, list]);
  }

  if (dynamicIssues.length > 0) {
    log(colors.red, '[slot-check] FAIL', 'Found non-literal data-slot attributes (write-back requires static literals):');
    for (const item of dynamicIssues.slice(0, 50)) {
      console.error(`  - ${formatLoc(item.file, item.loc)}`);
    }
    if (dynamicIssues.length > 50) console.error(`  ... and ${dynamicIssues.length - 50} more`);
    process.exit(1);
  }

  if (duplicates.length > 0) {
    log(colors.red, '[slot-check] FAIL', 'Duplicate data-slot values detected (must be unique for Design Mode write-back):');
    for (const [slot, list] of duplicates) {
      console.error(`- "${slot}" (${list.length} occurrences)`);
      for (const item of list) {
        console.error(`  - ${formatLoc(item.file, item.loc)}`);
      }
    }
    process.exit(1);
  }

  log(
    colors.green,
    '[slot-check] OK',
    `data-slot scan passed (files=${files.length}, parsed=${parsedFiles}, slots=${occurrences.size})`
  );
  log(
    colors.gray,
    '[slot-check]',
    'Tip: Use instance-specific slots in pages (e.g. button-roll/card-movie) to avoid write-back ambiguity.'
  );
}

main();


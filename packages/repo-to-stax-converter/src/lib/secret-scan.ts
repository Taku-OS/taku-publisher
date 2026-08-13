import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.next-edit',
  '.next-preview',
  'dist',
  'out',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
]);

const MAX_SECRET_SCAN_BYTES = 25 * 1024 * 1024;
const MAX_AST_SCAN_BYTES = 1024 * 1024;

const BUILD_DIRECTORIES = new Set(['.next', '.next-edit', '.next-preview', 'dist', 'out']);

export async function scanSecretLikeFiles(
  root: string,
  options: {
    includeBuildArtifacts?: boolean;
    ignoredDirectories?: readonly string[];
    approvedFileDigests?: Readonly<Record<string, string>>;
  } = {}
): Promise<string[]> {
  const found = new Set<string>();
  const ignoredDirectories = new Set([
    ...IGNORED_DIRECTORIES,
    ...(options.ignoredDirectories ?? []),
  ]);

  async function walk(relativeRoot: string): Promise<void> {
    const absoluteRoot = join(root, relativeRoot);
    const entries = await readdir(absoluteRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relativePath = join(relativeRoot, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        const ignored =
          ignoredDirectories.has(entry.name) &&
          !(options.includeBuildArtifacts && BUILD_DIRECTORIES.has(entry.name));
        if (!ignored) await walk(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSecretLikeFilename(entry.name)) found.add(relativePath);
      if (isKnownBinaryFilename(entry.name)) continue;
      const metadata = await lstat(join(root, relativePath)).catch(() => null);
      if (!metadata?.isFile()) continue;
      if (metadata.size > MAX_SECRET_SCAN_BYTES) {
        found.add(relativePath);
        continue;
      }
      const content = await readFile(join(root, relativePath));
      const approvedDigest = options.approvedFileDigests?.[relativePath];
      if (
        approvedDigest &&
        /^[a-f0-9]{64}$/.test(approvedDigest) &&
        createHash('sha256').update(content).digest('hex') === approvedDigest
      ) {
        continue;
      }
      if (
        looksTextual(content) &&
        containsSecretLikeText(content.toString('utf8'), { filePath: relativePath })
      ) {
        found.add(relativePath);
      }
    }
  }

  await walk('');
  return [...found].sort((a, b) => a.localeCompare(b));
}

function isSecretLikeFilename(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === '.env.example' || lower === '.example.env') return false;
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    ['.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519', 'credentials.json'].includes(lower) ||
    /\.(?:key|p12|pfx)$/.test(lower)
  );
}

function isKnownBinaryFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return /\.(?:png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|tgz|bz2|xz|7z|rar|woff2?|ttf|otf|mp[34]|mov|avi|webm|sqlite3?|db|wasm|node)$/.test(
    lower
  );
}

function looksTextual(content: Buffer): boolean {
  return !content.subarray(0, Math.min(content.length, 8192)).includes(0);
}

const KNOWN_CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk_live_[A-Za-z0-9]{16,}\b/,
];

const SECRET_NAME_MARKERS = [
  'PRIVATE_KEY',
  'ACCESS_KEY',
  'PASSWORD',
  'PASSWD',
  'API_KEY',
  'SECRET',
  'TOKEN',
];
const SECRET_NAME_PATTERN = new RegExp(
  `(?:^|_)(?:${SECRET_NAME_MARKERS.join('|')})(?:_|$)`
);

const FALLBACK_ASSIGNMENT_OPERATORS = [
  '>>>=',
  '**=',
  '&&=',
  '||=',
  '??=',
  '<<=',
  '>>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '=',
];

type SecretStorageKind = 'KEY' | 'PREFIX';

interface SecretStorageTarget {
  kind: SecretStorageKind;
  marker: string;
}

interface StaticTarget {
  name: string;
  start: number;
  end: number;
}

interface AstSecretAnalysis {
  found: boolean;
  safeNameRanges: StaticTarget[];
}

interface SecretScanOptions {
  filePath?: string;
  createSourceFile?: typeof ts.createSourceFile;
}

export function containsSecretLikeText(
  content: string,
  options: SecretScanOptions = {}
): boolean {
  if (KNOWN_CREDENTIAL_PATTERNS.some(pattern => pattern.test(content))) return true;

  if (options.filePath && isJavaScriptLikePath(options.filePath)) {
    if (Buffer.byteLength(content, 'utf8') > MAX_AST_SCAN_BYTES) {
      return containsSecretNameToken(content);
    }

    try {
      const createSourceFile = options.createSourceFile ?? ts.createSourceFile;
      const sourceFile = createSourceFile(
        options.filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        getScriptKind(options.filePath)
      );
      const analysis = analyzeSecretLikeAst(sourceFile);
      if (analysis.found) return true;
      if (containsSecretLikeComment(sourceFile)) return true;
      const parseDiagnostics = (
        sourceFile as ts.SourceFile & { parseDiagnostics?: unknown }
      ).parseDiagnostics;
      if (Array.isArray(parseDiagnostics) && parseDiagnostics.length === 0) return false;
      return containsSecretLikeTextFallback(
        content,
        getFallbackExcludedNameRanges(sourceFile, analysis.safeNameRanges)
      );
    } catch {
      return containsSecretNameToken(content);
    }
  }

  return containsSecretLikeTextFallback(content, new Map(), {
    allowPythonEnvironmentSymbolicReferences: options.filePath?.toLowerCase().endsWith('.py'),
    markdownPhysicalLinesAreBoundaries: /\.mdx?$/i.test(options.filePath ?? ''),
  });
}

function containsSecretLikeComment(sourceFile: ts.SourceFile): boolean {
  const content = sourceFile.text;
  const ranges = new Map<number, number>();
  const literalTextRanges: Array<{ start: number; end: number }> = [];

  function collect(commentRanges: readonly ts.CommentRange[] | undefined): void {
    for (const range of commentRanges ?? []) ranges.set(range.pos, range.end);
  }

  function visit(node: ts.Node): void {
    if (
      ts.isJsxText(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      literalTextRanges.push({ start: node.getStart(sourceFile), end: node.end });
    }
    collect(ts.getLeadingCommentRanges(content, node.pos));
    collect(ts.getTrailingCommentRanges(content, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  }

  visit(sourceFile);
  const mergedLiteralTextRanges = mergeTextRanges(literalTextRanges);
  const commentRanges = [...ranges]
    .map(([start, end]) => ({ start, end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let literalIndex = 0;
  for (const { start, end } of commentRanges) {
    while (
      literalIndex < mergedLiteralTextRanges.length &&
      mergedLiteralTextRanges[literalIndex].end <= start
    ) {
      literalIndex += 1;
    }
    const literalRange = mergedLiteralTextRanges[literalIndex];
    if (literalRange && literalRange.start < end && literalRange.end > start) continue;
    if (
      containsSecretLikeTextFallback(content.slice(start, end), new Map(), {
        commentsAreTrivia: false,
      })
    ) {
      return true;
    }
  }
  return false;
}

function mergeTextRanges(
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  const sorted = ranges.sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function isJavaScriptLikePath(filePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(filePath);
}

function getScriptKind(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:mjs|cjs|js)$/.test(lower)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function analyzeSecretLikeAst(sourceFile: ts.SourceFile): AstSecretAnalysis {
  let found = false;
  const safeNameRanges: StaticTarget[] = [];

  function inspect(
    target: StaticTarget | null,
    value: ts.Expression,
    operator = ts.SyntaxKind.EqualsToken
  ) {
    if (!target || !isSecretName(target.name)) return false;
    const storageTarget = getSecretStorageTarget(target.name);
    if (storageTarget) {
      const safe =
        operator === ts.SyntaxKind.EqualsToken &&
        isSafeSecretStorageExpression(storageTarget, value);
      if (safe) safeNameRanges.push(target);
      return !safe;
    }
    if (isExactSafeSecretExpression(value)) return false;
    return (
      containsPlausibleSecretLiteral(value) ||
      isAmbiguousMultilineSecretExpression(value, sourceFile) ||
      hasAmbiguousTrailingContinuation(value, sourceFile)
    );
  }

  function visit(node: ts.Node): void {
    if (found) return;

    if (ts.isVariableDeclaration(node) && node.initializer) {
      found = collectBindingTargets(node.name, sourceFile).some(target =>
        inspect(target, node.initializer!)
      );
    } else if (ts.isParameter(node) && node.initializer) {
      found = collectBindingTargets(node.name, sourceFile).some(target =>
        inspect(target, node.initializer!)
      );
    } else if (ts.isBindingElement(node) && node.initializer) {
      found = collectBindingElementTargets(node, sourceFile).some(target =>
        inspect(target, node.initializer!)
      );
    } else if (ts.isPropertyAssignment(node)) {
      found = inspect(getStaticTarget(node.name, sourceFile), node.initializer);
    } else if (ts.isShorthandPropertyAssignment(node) && node.objectAssignmentInitializer) {
      found = inspect(
        getStaticTarget(node.name, sourceFile),
        node.objectAssignmentInitializer
      );
    } else if (ts.isPropertyDeclaration(node) && node.initializer) {
      found = inspect(getStaticTarget(node.name, sourceFile), node.initializer);
    } else if (ts.isEnumMember(node) && node.initializer) {
      found = inspect(getStaticTarget(node.name, sourceFile), node.initializer);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const target = getStaticJsxAttributeTarget(node.name, sourceFile);
      if (ts.isStringLiteral(node.initializer)) {
        found = inspect(target, node.initializer);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        found = inspect(target, node.initializer.expression);
      } else if (!ts.isJsxExpression(node.initializer)) {
        found = inspect(target, node.initializer);
      }
    } else if (ts.isGetAccessorDeclaration(node) && node.body) {
      const target = getStaticTarget(node.name, sourceFile);
      found = collectReturnedExpressions(node.body).some(expression =>
        inspect(target, expression)
      );
    } else if (ts.isSetAccessorDeclaration(node)) {
      const target = getStaticTarget(node.name, sourceFile);
      found = node.parameters.some(parameter =>
        collectDefaultExpressions(parameter).some(expression => inspect(target, expression))
      );
    } else if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      found = collectAssignmentTargets(node.left, sourceFile).some(target =>
        inspect(target, node.right, node.operatorToken.kind)
      );
    } else if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const targets = collectForInitializerTargets(node.initializer, sourceFile);
      found = targets.some(target => inspect(target, node.expression));
    }

    if (!found) ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { found, safeNameRanges };
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function getStaticTarget(
  name: ts.PropertyName | ts.BindingName,
  sourceFile: ts.SourceFile
): StaticTarget | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    const quoted = ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name);
    return {
      name: name.text,
      start: name.getStart(sourceFile) + (quoted ? 1 : 0),
      end: name.end - (quoted ? 1 : 0),
    };
  }
  if (ts.isPrivateIdentifier(name)) {
    return {
      name: name.text.slice(1),
      start: name.getStart(sourceFile) + 1,
      end: name.end,
    };
  }
  if (ts.isComputedPropertyName(name)) {
    const expression = name.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return getStaticTarget(expression, sourceFile);
    }
  }
  return null;
}

function collectBindingTargets(name: ts.BindingName, sourceFile: ts.SourceFile): StaticTarget[] {
  if (ts.isIdentifier(name)) {
    const target = getStaticTarget(name, sourceFile);
    return target ? [target] : [];
  }
  return name.elements.flatMap(element => {
    if (ts.isOmittedExpression(element)) return [];
    return collectBindingElementTargets(element, sourceFile);
  });
}

function collectBindingElementTargets(
  element: ts.BindingElement,
  sourceFile: ts.SourceFile
): StaticTarget[] {
  const propertyTarget = element.propertyName
    ? getStaticTarget(element.propertyName, sourceFile)
    : null;
  return [
    ...(propertyTarget ? [propertyTarget] : []),
    ...collectBindingTargets(element.name, sourceFile),
  ];
}

function collectAssignmentTargets(
  expression: ts.Expression,
  sourceFile: ts.SourceFile
): StaticTarget[] {
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) {
    return collectAssignmentTargets(expression.expression, sourceFile);
  }
  if (ts.isIdentifier(expression)) {
    const target = getStaticTarget(expression, sourceFile);
    return target ? [target] : [];
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const target = getStaticTarget(expression.name, sourceFile);
    return target ? [target] : [];
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const argument = expression.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      const target = getStaticTarget(argument, sourceFile);
      return target ? [target] : [];
    }
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap(element => {
      if (ts.isOmittedExpression(element)) return [];
      if (ts.isSpreadElement(element)) {
        return collectAssignmentTargets(element.expression, sourceFile);
      }
      if (
        ts.isBinaryExpression(element) &&
        element.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        return collectAssignmentTargets(element.left, sourceFile);
      }
      return collectAssignmentTargets(element, sourceFile);
    });
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.flatMap(property => {
      if (ts.isShorthandPropertyAssignment(property)) {
        const target = getStaticTarget(property.name, sourceFile);
        return target ? [target] : [];
      }
      if (ts.isPropertyAssignment(property)) {
        const propertyTarget = getStaticTarget(property.name, sourceFile);
        return [
          ...(propertyTarget ? [propertyTarget] : []),
          ...collectAssignmentTargets(property.initializer, sourceFile),
        ];
      }
      if (ts.isSpreadAssignment(property)) {
        return collectAssignmentTargets(property.expression, sourceFile);
      }
      return [];
    });
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return collectAssignmentTargets(expression.left, sourceFile);
  }
  return [];
}

function collectForInitializerTargets(
  initializer: ts.ForInitializer,
  sourceFile: ts.SourceFile
): StaticTarget[] {
  if (ts.isVariableDeclarationList(initializer)) {
    return initializer.declarations.flatMap(declaration =>
      collectBindingTargets(declaration.name, sourceFile)
    );
  }
  return collectAssignmentTargets(initializer, sourceFile);
}

function getStaticJsxAttributeTarget(
  name: ts.JsxAttributeName,
  sourceFile: ts.SourceFile
): StaticTarget | null {
  return getStaticTarget(ts.isIdentifier(name) ? name : name.name, sourceFile);
}

function collectReturnedExpressions(body: ts.Block): ts.Expression[] {
  const expressions: ts.Expression[] = [];

  function visit(node: ts.Node): void {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(body);
  return expressions;
}

function collectDefaultExpressions(parameter: ts.ParameterDeclaration): ts.Expression[] {
  const expressions = parameter.initializer ? [parameter.initializer] : [];

  function collect(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) return;
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (element.initializer) expressions.push(element.initializer);
      collect(element.name);
    }
  }

  collect(parameter.name);
  return expressions;
}

function isSafeSecretStorageExpression(
  target: SecretStorageTarget,
  expression: ts.Expression
): boolean {
  if (isNonOptionalStaticPropertyAccess(expression)) return true;
  if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
    return false;
  }
  return isSafeSecretStorageLabel(target, expression.text);
}

function isNonOptionalStaticPropertyAccess(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression)) return false;
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken) return false;
    current = current.expression;
  }
  return ts.isIdentifier(current);
}

function isExactSafeSecretExpression(expression: ts.Expression): boolean {
  if (isExactEnvironmentReference(expression)) return true;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return isControlledPlaceholder(expression.text);
  }
  return false;
}

function isExactEnvironmentReference(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.questionDotToken) return false;
  const environment = expression.expression;
  if (!ts.isPropertyAccessExpression(environment) || environment.questionDotToken) return false;
  if (environment.name.text !== 'env') return false;
  if (ts.isIdentifier(environment.expression)) return environment.expression.text === 'process';
  return (
    ts.isMetaProperty(environment.expression) &&
    environment.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    environment.expression.name.text === 'meta'
  );
}

function containsPlausibleSecretLiteral(expression: ts.Expression): boolean {
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found = isPlausibleSecretLiteral(node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const staticText =
        node.head.text + node.templateSpans.map(span => span.literal.text).join('');
      if (isPlausibleSecretLiteral(staticText)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  return found;
}

function isAmbiguousMultilineSecretExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile
): boolean {
  const isAmbiguousOperator =
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    (ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.InKeyword ||
        expression.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword));
  if (!isAmbiguousOperator) return false;
  const text = sourceFile.text.slice(expression.getStart(sourceFile), expression.end);
  return text.includes('\n') || text.includes('\r');
}

function hasAmbiguousTrailingContinuation(
  expression: ts.Expression,
  sourceFile: ts.SourceFile
): boolean {
  const content = sourceFile.text;
  let cursor = expression.end;
  let crossedLine = false;
  while (cursor < content.length) {
    const character = content[cursor];
    if (character === '\r' || character === '\n') {
      crossedLine = true;
      cursor += 1;
      continue;
    }
    if (character === ' ' || character === '\t') {
      cursor += 1;
      continue;
    }
    if (content.startsWith('/*', cursor)) {
      const end = content.indexOf('*/', cursor + 2);
      if (end < 0) return true;
      const comment = content.slice(cursor, end + 2);
      crossedLine ||= comment.includes('\n') || comment.includes('\r');
      cursor = end + 2;
      continue;
    }
    if (content.startsWith('//', cursor)) {
      while (cursor < content.length && content[cursor] !== '\r' && content[cursor] !== '\n') {
        cursor += 1;
      }
      continue;
    }
    break;
  }
  return crossedLine && isFallbackExpressionContinuation(content, cursor);
}

function getFallbackExcludedNameRanges(
  sourceFile: ts.SourceFile,
  safeNameRanges: readonly StaticTarget[]
): ReadonlyMap<number, ReadonlySet<number>> {
  const excluded = new Map<number, Set<number>>();

  function exclude(target: StaticTarget | null): void {
    if (!target) return;
    const ends = excluded.get(target.start) ?? new Set<number>();
    ends.add(target.end);
    excluded.set(target.start, ends);
  }

  function excludeBindingName(name: ts.BindingName): void {
    for (const target of collectBindingTargets(name, sourceFile)) exclude(target);
  }

  for (const target of safeNameRanges) exclude(target);

  function visit(node: ts.Node): void {
    if (ts.isParameter(node) && !node.initializer) {
      excludeBindingName(node.name);
    } else if (ts.isVariableDeclaration(node) && node.type && !node.initializer) {
      excludeBindingName(node.name);
    } else if (ts.isPropertyDeclaration(node) && node.type && !node.initializer) {
      exclude(getStaticTarget(node.name, sourceFile));
    } else if (ts.isPropertySignature(node)) {
      exclude(getStaticTarget(node.name, sourceFile));
    } else if (ts.isBindingElement(node) && !node.initializer) {
      for (const target of collectBindingElementTargets(node, sourceFile)) exclude(target);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return excluded;
}

interface FallbackScanOptions {
  allowPythonEnvironmentSymbolicReferences?: boolean;
  commentsAreTrivia?: boolean;
  markdownPhysicalLinesAreBoundaries?: boolean;
}

interface PhysicalLine {
  end: number;
  newline: '' | '\n' | '\r' | '\r\n';
  nextStart: number;
  start: number;
}

interface PythonEnvironmentTargetRange {
  end: number;
  line: PhysicalLine;
  start: number;
}

interface PythonEnvironmentAnalysis {
  handledReadRanges: Array<{ start: number; end: number }>;
  targetRanges: PythonEnvironmentTargetRange[];
}

interface PythonEnvironmentOccurrence {
  isCode: boolean;
  lineIndex: number;
  nonCodeEnd?: number;
  start: number;
}

function containsSecretNameToken(content: string): boolean {
  let index = 0;
  while (index < content.length) {
    const code = content.charCodeAt(index);
    if (!isUppercaseAscii(code) || isIdentifierCode(content.charCodeAt(index - 1))) {
      index += 1;
      continue;
    }

    let nameEnd = index + 1;
    while (isUppercaseIdentifierCode(content.charCodeAt(nameEnd))) nameEnd += 1;
    if (!isIdentifierCode(content.charCodeAt(nameEnd))) {
      if (isSecretName(content.slice(index, nameEnd))) return true;
    }
    index = nameEnd;
  }
  return false;
}

function containsSecretLikeTextFallback(
  content: string,
  excludedNameRanges: ReadonlyMap<number, ReadonlySet<number>> = new Map(),
  options: FallbackScanOptions = {}
): boolean {
  const commentsAreTrivia = options.commentsAreTrivia ?? true;
  const pythonEnvironmentAnalysis = options.allowPythonEnvironmentSymbolicReferences
    ? analyzePythonEnvironmentOccurrences(content)
    : { handledReadRanges: [], targetRanges: [] };
  const pythonEnvironmentTargetRanges = pythonEnvironmentAnalysis.targetRanges;
  const pythonEnvironmentReadRanges = pythonEnvironmentAnalysis.handledReadRanges;
  let pythonEnvironmentTargetIndex = 0;
  let pythonEnvironmentReadIndex = 0;
  let index = 0;
  while (index < content.length) {
    const code = content.charCodeAt(index);
    if (!isUppercaseAscii(code) || isIdentifierCode(content.charCodeAt(index - 1))) {
      index += 1;
      continue;
    }

    let nameEnd = index + 1;
    while (isUppercaseIdentifierCode(content.charCodeAt(nameEnd))) nameEnd += 1;
    if (isIdentifierCode(content.charCodeAt(nameEnd))) {
      index = nameEnd;
      continue;
    }

    const name = content.slice(index, nameEnd);
    if (excludedNameRanges.get(index)?.has(nameEnd) || !isSecretName(name)) {
      index = nameEnd;
      continue;
    }

    while (
      pythonEnvironmentTargetIndex < pythonEnvironmentTargetRanges.length &&
      pythonEnvironmentTargetRanges[pythonEnvironmentTargetIndex].end <= index
    ) {
      pythonEnvironmentTargetIndex += 1;
    }
    const pythonEnvironmentTarget =
      pythonEnvironmentTargetRanges[pythonEnvironmentTargetIndex];
    if (
      pythonEnvironmentTarget &&
      pythonEnvironmentTarget.start <= index &&
      index < pythonEnvironmentTarget.end
    ) {
      const safeStatementEnd = getSafePythonEnvironmentStatementEnd(
        content,
        index,
        nameEnd,
        pythonEnvironmentTarget
      );
      if (safeStatementEnd === null) return true;
      index = safeStatementEnd;
      continue;
    }

    while (
      pythonEnvironmentReadIndex < pythonEnvironmentReadRanges.length &&
      pythonEnvironmentReadRanges[pythonEnvironmentReadIndex].end <= index
    ) {
      pythonEnvironmentReadIndex += 1;
    }
    const pythonEnvironmentRead = pythonEnvironmentReadRanges[pythonEnvironmentReadIndex];
    if (
      pythonEnvironmentRead &&
      pythonEnvironmentRead.start <= index &&
      index < pythonEnvironmentRead.end
    ) {
      index = nameEnd;
      continue;
    }

    const assignment = findFallbackAssignment(content, index, nameEnd, commentsAreTrivia);
    if (assignment.commentFinding) return true;
    if (!assignment.found) {
      index = Math.max(nameEnd, assignment.resumeAt);
      continue;
    }
    const value = readFallbackAssignmentValue(
      content,
      assignment.valueStart,
      commentsAreTrivia,
      options.markdownPhysicalLinesAreBoundaries ?? false
    );
    const storageTarget = getSecretStorageTarget(name);
    if (storageTarget) {
      if (
        assignment.operator !== '=' ||
        value.ambiguous ||
        !isSafeSecretStorageValue(storageTarget, value.value)
      ) {
        return true;
      }
    } else if (value.ambiguous || isPlausibleSecretValue(value.value)) {
      return true;
    }
    index = Math.max(nameEnd, value.end);
  }
  return false;
}

function analyzePythonEnvironmentOccurrences(content: string): PythonEnvironmentAnalysis {
  const lines = indexPhysicalLines(content);
  const occurrences = findPythonEnvironmentOccurrences(content, lines);
  const targetRanges: PythonEnvironmentTargetRange[] = [];
  const handledReadRanges: Array<{ start: number; end: number }> = [];
  let coveredUntil = 0;

  for (const occurrence of occurrences) {
    if (occurrence.start < coveredUntil) continue;
    const occurrenceLine = lines[occurrence.lineIndex];
    const occurrenceEnd = occurrence.isCode
      ? content.length
      : occurrence.nonCodeEnd ?? occurrenceLine.end;
    const statementStart = occurrence.isCode && /^[ \t]*$/.test(
      content.slice(occurrenceLine.start, occurrence.start)
    );
    let cursor = skipBroadPythonTargetTrivia(
      content,
      occurrence.start + 'os.environ'.length,
      occurrenceEnd
    );
    if (content[cursor] !== '[') continue;

    const targetStart = cursor + 1;
    let depth = 1;
    let quote: '"' | "'" | null = null;
    cursor = targetStart;
    while (cursor < occurrenceEnd && depth > 0) {
      const character = content[cursor];
      if (quote) {
        if (character === '\\') {
          cursor += Math.min(2, occurrenceEnd - cursor);
          continue;
        }
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '[') {
        depth += 1;
      } else if (character === ']') {
        depth -= 1;
      }
      cursor += 1;
    }

    if (depth > 0) {
      coveredUntil = occurrenceEnd;
      if (statementStart) {
        targetRanges.push({ start: targetStart, end: occurrenceEnd, line: occurrenceLine });
      } else {
        handledReadRanges.push({ start: targetStart, end: occurrenceEnd });
      }
      continue;
    }
    coveredUntil = cursor;

    const assignmentIntent =
      occurrence.isCode &&
      (statementStart
        ? hasPythonStatementAssignmentIntent(content, lines, occurrence.lineIndex, cursor)
        : hasImmediatePythonAssignmentIntent(content, occurrenceLine.end, cursor));
    if (assignmentIntent) {
      targetRanges.push({ start: targetStart, end: cursor - 1, line: occurrenceLine });
    } else {
      handledReadRanges.push({ start: targetStart, end: cursor - 1 });
    }
  }

  return { handledReadRanges, targetRanges };
}

function indexPhysicalLines(content: string): PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const character = content[cursor];
    if (character !== '\r' && character !== '\n') {
      cursor += 1;
      continue;
    }

    const newline =
      character === '\r' && content[cursor + 1] === '\n'
        ? '\r\n'
        : character;
    const nextStart = cursor + newline.length;
    lines.push({ start, end: cursor, nextStart, newline });
    start = nextStart;
    cursor = nextStart;
  }
  lines.push({ start, end: content.length, nextStart: content.length, newline: '' });
  return lines;
}

function findPythonEnvironmentOccurrences(
  content: string,
  lines: readonly PhysicalLine[]
): PythonEnvironmentOccurrence[] {
  const occurrences: PythonEnvironmentOccurrence[] = [];
  let quote: '"' | "'" | '\"\"\"' | "'''" | null = null;
  let lineIndex = 0;
  let cursor = 0;
  let continuedSingleQuote = false;
  let stringOccurrences: PythonEnvironmentOccurrence[] = [];

  const closeString = (end: number): void => {
    for (const occurrence of stringOccurrences) occurrence.nonCodeEnd = end;
    stringOccurrences = [];
  };

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (cursor >= line.end) {
      if (quote?.length === 1 && !continuedSingleQuote) {
        closeString(line.end);
        quote = null;
      }
      continuedSingleQuote = false;
      cursor = line.nextStart;
      lineIndex += 1;
      continue;
    }

    if (quote) {
      if (content.startsWith('os.environ', cursor)) {
        const occurrence = { start: cursor, lineIndex, isCode: false };
        occurrences.push(occurrence);
        stringOccurrences.push(occurrence);
        cursor += 'os.environ'.length;
        continue;
      }
      if (content[cursor] === '\\') {
        if (cursor + 1 >= line.end && line.newline !== '') {
          continuedSingleQuote = quote.length === 1;
          cursor = line.end;
        } else {
          cursor = Math.min(cursor + 2, line.end);
        }
        continue;
      }
      if (content.startsWith(quote, cursor)) {
        cursor += quote.length;
        closeString(cursor);
        quote = null;
      } else {
        cursor += 1;
      }
      continue;
    }

    if (content[cursor] === '#') {
      cursor += 1;
      while (cursor < line.end) {
        if (content.startsWith('os.environ', cursor)) {
          occurrences.push({
            start: cursor,
            lineIndex,
            isCode: false,
            nonCodeEnd: line.end,
          });
          cursor += 'os.environ'.length;
        } else {
          cursor += 1;
        }
      }
      continue;
    }
    const tripleQuote = content.slice(cursor, cursor + 3);
    if (tripleQuote === '\"\"\"' || tripleQuote === "'''") {
      quote = tripleQuote;
      stringOccurrences = [];
      cursor += 3;
      continue;
    }
    if (content[cursor] === '"' || content[cursor] === "'") {
      quote = content[cursor] as '"' | "'";
      stringOccurrences = [];
      cursor += 1;
      continue;
    }
    if (
      content.startsWith('os.environ', cursor) &&
      !isPythonIdentifierCharacter(content[cursor - 1] ?? '') &&
      content[cursor - 1] !== '.' &&
      !isPythonIdentifierCharacter(content[cursor + 'os.environ'.length] ?? '')
    ) {
      occurrences.push({ start: cursor, lineIndex, isCode: true });
      cursor += 'os.environ'.length;
      continue;
    }
    cursor += 1;
  }
  if (quote) closeString(content.length);
  return occurrences;
}

function skipBroadPythonTargetTrivia(
  content: string,
  start: number,
  end: number
): number {
  let cursor = start;
  while (cursor < end) {
    if (isBroadWhitespace(content[cursor] ?? '')) {
      cursor += 1;
      continue;
    }
    if (content[cursor] === '\\' && content[cursor + 1] === '\n') {
      cursor += 2;
      continue;
    }
    if (
      content[cursor] === '\\' &&
      content[cursor + 1] === '\r' &&
      content[cursor + 2] === '\n'
    ) {
      cursor += 3;
      continue;
    }
    break;
  }
  return cursor;
}

function hasPythonStatementAssignmentIntent(
  content: string,
  lines: readonly PhysicalLine[],
  startLineIndex: number,
  start: number
): boolean {
  let extensionDepth = 0;
  let cursor = start;
  for (let lineIndex = startLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    cursor = Math.max(cursor, line.start);
    while (cursor < line.end && isHorizontalPythonWhitespace(content[cursor] ?? '')) {
      cursor += 1;
    }
    if (cursor >= line.end || content[cursor] === '#') {
      cursor = line.nextStart;
      continue;
    }
    if (extensionDepth === 0) {
      if (isPythonComparisonAt(content, cursor)) return false;
      if (isStandalonePythonAssignmentAt(content, cursor)) return true;
      if (!isPythonTargetExtensionStart(content[cursor] ?? '')) return false;
    }

    let quote: '"' | "'" | null = null;
    while (cursor < line.end) {
      const character = content[cursor];
      if (quote) {
        if (character === '\\') {
          cursor += 2;
          continue;
        }
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '#') {
        break;
      } else if (isStandalonePythonAssignmentAt(content, cursor)) {
        return true;
      } else if ('([{'.includes(character)) {
        extensionDepth += 1;
      } else if (')]}'.includes(character)) {
        extensionDepth = Math.max(0, extensionDepth - 1);
      }
      cursor += 1;
    }
    cursor = line.nextStart;
  }
  return false;
}

function hasImmediatePythonAssignmentIntent(
  content: string,
  lineEnd: number,
  start: number
): boolean {
  let cursor = start;
  while (cursor < lineEnd && isHorizontalPythonWhitespace(content[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor < lineEnd && isStandalonePythonAssignmentAt(content, cursor);
}

function isStandalonePythonAssignmentAt(content: string, index: number): boolean {
  if (content[index] !== '=') return false;
  return content[index + 1] !== '=' && !'=!<>'.includes(content[index - 1] ?? '');
}

function isPythonComparisonAt(content: string, index: number): boolean {
  return (
    content.startsWith('==', index) ||
    content.startsWith('!=', index) ||
    content.startsWith('<=', index) ||
    content.startsWith('>=', index)
  );
}

function isPythonTargetExtensionStart(character: string): boolean {
  return character !== '' && `.,;()[]{}'"\\!?:+-*/%@&|^<>`.includes(character);
}

function isHorizontalPythonWhitespace(character: string): boolean {
  return (
    character !== '' &&
    /^\s$/u.test(character) &&
    character !== '\r' &&
    character !== '\n'
  );
}

function isPythonIdentifierCharacter(character: string): boolean {
  return /^[A-Za-z0-9_]$/.test(character);
}

const PYTHON_NON_REFERENCE_WORD = /^(?:False|None|True|and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|try|while|with|yield)$/;

function isSimplePythonSymbolicReference(value: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
    return false;
  }
  return value.split('.').every(segment => !PYTHON_NON_REFERENCE_WORD.test(segment));
}

function getSafePythonEnvironmentStatementEnd(
  content: string,
  nameStart: number,
  nameEnd: number,
  target: PythonEnvironmentTargetRange
): number | null {
  const { line } = target;
  if (line.newline === '\r') return null;
  const text = content.slice(line.start, line.end);
  const match = /^([ \t]*os\.environ[ \t]*\[[ \t]*(["']))([A-Z][A-Z0-9_]*)(\2[ \t]*\][ \t]*=[ \t]*)([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)([ \t]*)(#.*)?$/.exec(
    text
  );
  if (
    !match ||
    line.start + match[1].length !== nameStart ||
    line.start + match[1].length + match[3].length !== nameEnd ||
    !isSimplePythonSymbolicReference(match[5])
  ) {
    return null;
  }

  const comment = match[7];
  if (
    comment &&
    containsSecretLikeTextFallback(comment, new Map(), { commentsAreTrivia: false })
  ) {
    return null;
  }

  return line.nextStart;
}

function isBroadWhitespace(character: string): boolean {
  return character !== '' && /^\s$/u.test(character);
}

function findFallbackAssignment(
  content: string,
  nameStart: number,
  nameEnd: number,
  commentsAreTrivia: boolean
):
  | { found: true; operator: string; valueStart: number; commentFinding: false }
  | { found: false; resumeAt: number; commentFinding: boolean } {
  let cursor = nameEnd;
  const preceding = content[nameStart - 1];
  if (
    (preceding === '"' || preceding === "'" || preceding === '`') &&
    content[cursor] === preceding
  ) {
    cursor += 1;
  }
  let trivia = skipFallbackTrivia(content, cursor, commentsAreTrivia);
  if (trivia.commentFinding) {
    return { found: false, resumeAt: trivia.end, commentFinding: true };
  }
  cursor = trivia.end;
  if (content[cursor] === ']') {
    trivia = skipFallbackTrivia(content, cursor + 1, commentsAreTrivia);
    if (trivia.commentFinding) {
      return { found: false, resumeAt: trivia.end, commentFinding: true };
    }
    cursor = trivia.end;
  }

  if (content[cursor] === ':') {
    return {
      found: true,
      operator: ':',
      valueStart: cursor + 1,
      commentFinding: false,
    };
  }
  if (content[cursor] === '=' && (content[cursor + 1] === '=' || content[cursor + 1] === '>')) {
    return { found: false, resumeAt: cursor + 1, commentFinding: false };
  }
  for (const operator of FALLBACK_ASSIGNMENT_OPERATORS) {
    if (content.startsWith(operator, cursor)) {
      return {
        found: true,
        operator,
        valueStart: cursor + operator.length,
        commentFinding: false,
      };
    }
  }
  return { found: false, resumeAt: cursor, commentFinding: false };
}

function skipFallbackTrivia(
  content: string,
  start: number,
  commentsAreTrivia: boolean
): { end: number; commentFinding: boolean } {
  let cursor = start;
  while (cursor < content.length) {
    const character = content[cursor];
    if (isWhitespace(character)) {
      cursor += 1;
      continue;
    }
    if (commentsAreTrivia && content.startsWith('/*', cursor)) {
      const end = content.indexOf('*/', cursor + 2);
      const commentEnd = end < 0 ? content.length : end + 2;
      if (
        containsSecretLikeTextFallback(content.slice(cursor, commentEnd), new Map(), {
          commentsAreTrivia: false,
        })
      ) {
        return { end: commentEnd, commentFinding: true };
      }
      if (end < 0) return { end: content.length, commentFinding: false };
      cursor = end + 2;
      continue;
    }
    if (commentsAreTrivia && content.startsWith('//', cursor)) {
      let commentEnd = cursor + 2;
      while (
        commentEnd < content.length &&
        content[commentEnd] !== '\r' &&
        content[commentEnd] !== '\n'
      ) {
        commentEnd += 1;
      }
      if (
        containsSecretLikeTextFallback(content.slice(cursor, commentEnd), new Map(), {
          commentsAreTrivia: false,
        })
      ) {
        return { end: commentEnd, commentFinding: true };
      }
      cursor = commentEnd;
      continue;
    }
    break;
  }
  return { end: cursor, commentFinding: false };
}

function readFallbackAssignmentValue(
  content: string,
  start: number,
  commentsAreTrivia: boolean,
  markdownPhysicalLinesAreBoundaries: boolean
): { value: string; ambiguous: boolean; end: number } {
  let valueStart = start;
  while (content[valueStart] === ' ' || content[valueStart] === '\t') valueStart += 1;
  if (content[valueStart] === '\r' || content[valueStart] === '\n') {
    let next = valueStart;
    while (isWhitespace(content[next] ?? '')) next += 1;
    if (!['"', "'", '`'].includes(content[next] ?? '')) {
      return { value: '', ambiguous: false, end: valueStart + 1 };
    }
    valueStart = next;
  }
  if (
    content[valueStart] === '(' ||
    content.startsWith('/*', valueStart) ||
    content.startsWith('//', valueStart)
  ) {
    return { value: '', ambiguous: true, end: valueStart + 1 };
  }

  let quote: '"' | "'" | '`' | null = null;
  let cursor = valueStart;
  while (cursor < content.length) {
    const character = content[cursor];
    if (character === '\r' || character === '\n') {
      if (quote) {
        return {
          value: content.slice(valueStart, cursor).trim(),
          ambiguous: true,
          end: cursor + 1,
        };
      }
      if (markdownPhysicalLinesAreBoundaries) {
        let nextLine = cursor + 1;
        if (character === '\r' && content[nextLine] === '\n') nextLine += 1;
        while (content[nextLine] === ' ' || content[nextLine] === '\t') nextLine += 1;
        const dangerousContinuation =
          content[nextLine] !== '`' && isFallbackExpressionContinuation(content, nextLine);
        return {
          value: content.slice(valueStart, cursor).trim(),
          ambiguous: dangerousContinuation,
          end: nextLine,
        };
      }
      const trivia = skipFallbackTrivia(content, cursor, commentsAreTrivia);
      if (trivia.commentFinding) {
        return { value: '', ambiguous: true, end: trivia.end };
      }
      if (isFallbackExpressionContinuation(content, trivia.end)) {
        return {
          value: content.slice(valueStart, cursor).trim(),
          ambiguous: true,
          end: trivia.end + 1,
        };
      }
      return {
        value: content.slice(valueStart, cursor).trim(),
        ambiguous: false,
        end: trivia.end,
      };
    }
    if (quote) {
      if (character === '\\') {
        if (content[cursor + 1] === '\r' || content[cursor + 1] === '\n') {
          return {
            value: content.slice(valueStart, cursor).trim(),
            ambiguous: true,
            end: cursor + 1,
          };
        }
        cursor += 2;
        continue;
      }
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (
      !markdownPhysicalLinesAreBoundaries &&
      (character === ';' || character === ',' || character === '#' || character === '}')
    ) {
      break;
    }
    cursor += 1;
  }
  return {
    value: content.slice(valueStart, cursor).trim(),
    ambiguous: quote !== null,
    end: cursor,
  };
}

function isFallbackExpressionContinuation(content: string, start: number): boolean {
  const character = content[start] ?? '';
  if (character && '()[].?+-*/%&|^<>=!`'.includes(character)) return true;
  return ['in', 'instanceof', 'as', 'satisfies'].some(keyword =>
    startsWithFallbackWord(content, start, keyword)
  );
}

function startsWithFallbackWord(content: string, start: number, word: string): boolean {
  if (!content.startsWith(word, start)) return false;
  return !isIdentifierCode(content.charCodeAt(start + word.length));
}

function isSecretName(name: string): boolean {
  if (!name || !isUppercaseAscii(name.charCodeAt(0))) return false;
  for (let index = 1; index < name.length; index += 1) {
    if (!isUppercaseIdentifierCode(name.charCodeAt(index))) return false;
  }
  return SECRET_NAME_PATTERN.test(name);
}

function isUppercaseAscii(code: number): boolean {
  return code >= 65 && code <= 90;
}

function isUppercaseIdentifierCode(code: number): boolean {
  return isUppercaseAscii(code) || (code >= 48 && code <= 57) || code === 95;
}

function isIdentifierCode(code: number): boolean {
  return (
    isUppercaseIdentifierCode(code) ||
    (code >= 97 && code <= 122) ||
    code === 36
  );
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function getSecretStorageTarget(name: string): SecretStorageTarget | null {
  for (const marker of SECRET_NAME_MARKERS) {
    const match = name.match(new RegExp(`(?:^|_)${marker}_STORAGE_(KEY|PREFIX)$`));
    if (match) return { kind: match[1] as SecretStorageKind, marker };
  }
  return null;
}

function isSafeSecretStorageValue(target: SecretStorageTarget, value: string): boolean {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value)) {
    return true;
  }

  const labelMatch = value.match(/^(?:"([^"\\]*)"|'([^'\\]*)'|`([^`\\]*)`)$/);
  if (!labelMatch) return false;
  const label = labelMatch.slice(1).find(candidate => candidate !== undefined) ?? '';
  return isSafeSecretStorageLabel(target, label);
}

function isSafeSecretStorageLabel(target: SecretStorageTarget, label: string): boolean {
  const trailingDelimiter = target.kind === 'PREFIX' ? ':?' : '';
  const markerWords = target.marker.toLowerCase().split('_').join('[:_-]');
  return new RegExp(
    `^[a-z][a-z0-9]*(?:[:_-][a-z][a-z0-9]*)*[:_-]${markerWords}${trailingDelimiter}$`
  ).test(label);
}

function isPlausibleSecretValue(value: string): boolean {
  if (value.length < 12) return false;
  return !isSafeSecretPlaceholder(value);
}

function isPlausibleSecretLiteral(value: string): boolean {
  return value.length >= 12 && !isControlledPlaceholder(value);
}

function isSafeSecretPlaceholder(value: string): boolean {
  if (/^(?:process\.env|import\.meta\.env)\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    return true;
  }

  const literalMatch = value.match(/^(?:"([^"\\]*)"|'([^'\\]*)'|`([^`\\$]*)`|([^\s"'`]+))$/);
  if (!literalMatch) return false;
  const literal = literalMatch.slice(1).find(candidate => candidate !== undefined) ?? '';
  return isControlledPlaceholder(literal);
}

function isControlledPlaceholder(value: string): boolean {
  return /^(?:(?:placeholder|example|dummy|fake|redacted|change-me|changeme)(?:[-_:](?:value|token|secret|key|api[-_]?key|credential))?|your[-_](?:value|token|secret|key|api[-_]?key|credential)(?:[-_]here)?)$/.test(
    value.toLowerCase()
  );
}

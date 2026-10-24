import ts from 'typescript';

const CACHE_DIRECTIVE = /^use cache(?:: (\w+))?$/;
const REMOTE_WRAPPER_MODULE = '@/server/cache/remote';

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function cacheDirective(
  statements: readonly ts.Statement[],
): { variant: string } | undefined {
  for (const statement of statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return undefined;
    }
    const match = CACHE_DIRECTIVE.exec(statement.expression.text);
    if (match) return { variant: match[1] ?? 'default' };
  }
  return undefined;
}

function callsOf(root: ts.Node, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

function isLiteralText(node: ts.Node): boolean {
  return ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);
}

function exportedNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

function declaredName(fn: FunctionNode): string | undefined {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function hasExportModifier(fn: FunctionNode): boolean {
  const owner = ts.isVariableDeclaration(fn.parent)
    ? fn.parent.parent.parent
    : fn;
  return (
    ts.canHaveModifiers(owner) &&
    (ts.getModifiers(owner) ?? []).some(
      ({ kind }) => kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

/**
 * Reads a source file and lists every way it breaks the cache conventions (ADR 0001):
 * a cached function names one of the project's `cacheLife` profiles and tags its output through
 * the tag module, and a `'use cache: remote'` function is reachable only through the wrapper that
 * falls back to Postgres.
 */
export function cacheConventionViolations(
  fileName: string,
  source: string,
  profileNames: readonly string[],
): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const problems: string[] = [];
  const report = (node: ts.Node, message: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    problems.push(`${fileName}:${String(line + 1)} ${message}`);
  };

  const fileDirective = cacheDirective(file.statements);
  if (fileDirective) {
    report(
      file.statements[0] ?? file,
      "a file-level 'use cache' hides which function sets cacheLife; put the directive in each function",
    );
  }

  const exported = exportedNames(file);
  const importsWrapper = file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === REMOTE_WRAPPER_MODULE,
  );

  const visit = (node: ts.Node) => {
    if (isFunctionNode(node) && node.body && ts.isBlock(node.body)) {
      const directive = cacheDirective(node.body.statements);
      if (directive) {
        checkCachedFunction(node, directive.variant);
      }
    }
    ts.forEachChild(node, visit);
  };

  const checkCachedFunction = (fn: FunctionNode, variant: string) => {
    if (variant === 'private') {
      report(
        fn,
        "'use cache: private' reads the caller; cached code takes every input as an argument",
      );
    }

    const lives = callsOf(fn, 'cacheLife');
    if (lives.length === 0) {
      report(fn, 'cached function does not call cacheLife');
    }
    for (const call of lives) {
      const [profile] = call.arguments;
      if (
        !profile ||
        !ts.isStringLiteralLike(profile) ||
        !profileNames.includes(profile.text)
      ) {
        report(
          call,
          `cacheLife takes one of ${profileNames.join(', ')} as a string literal`,
        );
      }
    }

    const tagCalls = callsOf(fn, 'cacheTag');
    if (tagCalls.length === 0) {
      report(fn, 'cached function does not call cacheTag');
    }
    for (const call of tagCalls) {
      if (call.arguments.some(isLiteralText)) {
        report(call, 'cacheTag takes its tags from the tag module');
      }
    }

    if (variant === 'remote') {
      const name = declaredName(fn);
      if (name && (exported.has(name) || hasExportModifier(fn))) {
        report(
          fn,
          "a 'use cache: remote' function stays private to its file; export a function that calls it through readRemoteOrFallback",
        );
      }
      if (!importsWrapper) {
        report(
          fn,
          `a 'use cache: remote' function is read through readRemoteOrFallback from ${REMOTE_WRAPPER_MODULE}`,
        );
      }
    }
  };

  visit(file);
  return problems;
}

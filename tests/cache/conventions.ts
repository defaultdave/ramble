import ts from 'typescript';

const CACHE_DIRECTIVE = /^use cache(?:: (\w+))?$/;
const REMOTE_WRAPPER_MODULE = '@/server/cache/remote';
const WRAPPER_FUNCTION = 'readRemoteOrFallback';

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

function declaredName(fn: FunctionNode): string | undefined {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function isExportedHere(fn: FunctionNode): boolean {
  if (ts.isExportAssignment(fn.parent)) return true;
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

function isWrapperCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === WRAPPER_FUNCTION
  );
}

/** True when `node` sits inside the first argument (the remote read) of a wrapper call. */
function isInsideWrappedRead(node: ts.Node): boolean {
  let child = node;
  while (!ts.isSourceFile(child)) {
    const parent = child.parent;
    if (isWrapperCall(parent) && parent.arguments[0] === child) return true;
    child = parent;
  }
  return false;
}

function referencesTo(file: ts.SourceFile, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      const isDeclaration =
        (ts.isFunctionDeclaration(parent) ||
          ts.isFunctionExpression(parent) ||
          ts.isVariableDeclaration(parent)) &&
        parent.name === node;
      // `{ f: 1 }` and `x.f` use the same text for something else.
      const isOtherName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isDeclaration && !isOtherName) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
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

    if (variant === 'remote') checkRemoteFunction(fn);
  };

  const checkRemoteFunction = (fn: FunctionNode) => {
    if (!importsWrapper) {
      report(
        fn,
        `a 'use cache: remote' function is read through ${WRAPPER_FUNCTION} from ${REMOTE_WRAPPER_MODULE}`,
      );
    }
    if (
      ts.isMethodDeclaration(fn) ||
      ts.isPropertyAssignment(fn.parent) ||
      ts.isPropertyDeclaration(fn.parent)
    ) {
      report(
        fn,
        "a 'use cache: remote' function is a plain function in its file, not a method or object property",
      );
      return;
    }
    if (isExportedHere(fn)) {
      report(
        fn,
        `a 'use cache: remote' function stays private to its file; export a function that calls it through ${WRAPPER_FUNCTION}`,
      );
    }
    const name = declaredName(fn);
    if (!name) {
      // An inline function handed straight to the wrapper cannot be called any other way.
      if (!isInsideWrappedRead(fn)) {
        report(
          fn,
          `a 'use cache: remote' function has a name and is read only through ${WRAPPER_FUNCTION}`,
        );
      }
      return;
    }
    for (const reference of referencesTo(file, name)) {
      if (!isInsideWrappedRead(reference)) {
        report(
          reference,
          `'${name}' is a 'use cache: remote' function; read it only inside the first argument of ${WRAPPER_FUNCTION}`,
        );
      }
    }
  };

  visit(file);
  return problems;
}

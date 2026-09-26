import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

/**
 * Regression guard for the build-time crash seen in Docker:
 *
 *   Error: JWT_SECRET must be set in the runtime environment
 *   RUN npm run build
 *
 * `src/server.ts` is registered as the SSR entry (`angular.json` ->
 * `ssr.entry`), so the Angular builder IMPORTS it while building, in a child
 * process that has `NODE_ENV=production` set and none of the production
 * secrets (`.env` is excluded by `.dockerignore`). Anything that runs at module
 * scope therefore executes on every build.
 *
 * The assertions are static on purpose: importing the module for real would
 * boot the Express listener and the Mongo connection.
 */
const serverPath = resolve(process.cwd(), 'src/server.ts');
const serverSource = readFileSync(serverPath, 'utf8');

/**
 * Find every `throw` that would execute when this module is merely imported.
 *
 * Walks the AST from the top level and descends into control flow (if/try/
 * loops/switch) but deliberately does NOT enter function bodies, since a
 * function only runs when called. The original bug was exactly this shape:
 *
 *   if (!process.env.JWT_SECRET) {
 *     throw new Error('JWT_SECRET must be set in the runtime environment');
 *   }
 */
function findImportTimeThrows(): string[] {
  const sourceFile = ts.createSourceFile(serverPath, serverSource, ts.ScriptTarget.ESNext, true);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isThrowStatement(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push(`line ${line + 1}: ${node.getText(sourceFile).slice(0, 80)}`);
    }

    // Do not descend into anything that is only invoked when called.
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

describe('server startup guards must not run at import time', () => {
  it('has no throw that executes when the module is imported', () => {
    expect(findImportTimeThrows()).toEqual([]);
  });

  it('does not treat NODE_ENV=production as a reason to start the listener', () => {
    // The builder sets NODE_ENV=production in its build child process, so using
    // it to decide whether to own the listener both started a server mid-build
    // and ran the startup assertions that need real secrets.
    //
    // Only the gate itself is inspected: `NODE_ENV === 'production'` remains
    // legitimate elsewhere (cookie `secure` flags, dev-mode checks).
    const gate = serverSource.slice(
      serverSource.indexOf('function shouldStartServer'),
      serverSource.indexOf('if (shouldStartServer())')
    );

    expect(gate).toContain('isMainModule(import.meta.url)');
    expect(gate).toContain('START_SERVER_ON_IMPORT');
    expect(gate).not.toMatch(/NODE_ENV/);
  });

  it('gates the listener on isMainModule or an explicit opt-in', () => {
    expect(serverSource).toContain('if (shouldStartServer()) {');
  });

  it('still refuses to serve without JWT_SECRET', () => {
    // The check must survive: importing is safe, starting is not.
    expect(serverSource).toContain('assertJwtSecret');
    expect(serverSource).toContain('JWT_SECRET must be set in the runtime environment');
  });
});

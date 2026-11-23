// The browser test's server: smaltai's built dist/ and the pinned smaltdb and smaltts builds, as they are installed,
// with no bundler. Bare imports are rewritten to the files they name: a module worker can't use the page's import map
// in every browser (smaltts's test/browser/serve.mjs does the same). Cross-origin isolated, as smaltdb's worker would
// be in an app.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const MODULES = {
  smaltdb: '/node_modules/smaltdb/dist/smaltdb.js',
  'smaltdb/plan': '/node_modules/smaltdb/dist/plan.js',
  'smaltdb/language': '/node_modules/smaltdb/dist/language.js',
  'smaltdb/worker-runtime': '/node_modules/smaltdb/dist/worker-runtime.js',
  '@smaltworks/smaltts': '/node_modules/@smaltworks/smaltts/dist/index.js',
  '@smaltworks/smaltts/worker': '/node_modules/@smaltworks/smaltts/dist/worker.js',
  '@smaltworks/smaltai': '/dist/index.js',
  '@smaltworks/smaltai/store': '/dist/store.js',
};
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.map': 'application/json' };

/** `code` with its bare imports pointed at their files; any other bare import is an error. */
function rewrite(code, file) {
  // Import and export statements only, at the start of a line: not the examples in comments.
  return code.replace(/^(\s*(?:import|export)\b[^'";]*?\bfrom\s*|\s*import\s*)(['"])([^'"./][^'"]*)\2/gm, (all, lead, q, spec) => {
    const to = MODULES[spec];
    if (!to) throw new Error(`${file}: the browser test serves no module for ${spec}`);
    return `${lead}${q}${to}${q}`;
  });
}

export function serve(port = 0) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const file = normalize(join(root, decodeURIComponent(path === '/' ? '/test/browser/page.html' : path)));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end(`no ${path}`);
      return;
    }
    const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' };
    try {
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      const body = type === 'text/javascript' ? rewrite(readFileSync(file, 'utf8'), file) : readFileSync(file);
      res.writeHead(200, { ...headers, 'Content-Type': type }).end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

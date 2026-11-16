// architecture.test.js: the layering rules from docs/architecture.md, checked by machine.
// It reads every `import` in src/ and fails if an arrow points the wrong way ("nothing calls upwards").
// A picture in a document is a wish; this test is the enforcement.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

// All source files under src/, as paths relative to src/ (always with "/").
function listFiles(dir = SRC) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : /\.(js|jsx)$/.test(name) ? [path.relative(SRC, full).split(path.sep).join('/')] : [];
  });
}

// Every module a file imports: ["node:http", "../domain/errors.js", ...]. Comments are removed first, so a
// sentence in a comment that looks like an import can't confuse the check.
function importsOf(file) {
  const code = readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = [];
  for (const m of code.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of code.matchAll(/import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of code.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

// A relative import resolved to a path inside src/ ("domain/errors.js"); package imports stay as they are.
function resolveImport(file, specifier) {
  if (!specifier.startsWith('.')) return { external: specifier };
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return { internal: target };
}

const files = listFiles();
const layerOf = (file) => {
  if (file === 'domain/inventory.js' || file.startsWith('repositories/') || file.startsWith('db/')) return 'data';
  if (file.startsWith('domain/')) return 'rules';
  return file.split('/')[0];
};

test('the project has the layers the architecture document describes', () => {
  for (const folder of ['http', 'services', 'domain', 'repositories', 'db', 'lib']) assert.ok(existsSync(path.join(SRC, folder)), `src/${folder} is missing`);
  assert.ok(files.includes('http/router.js') && files.includes('http/app.js') && files.includes('domain/bookingStateMachine.js'));
});

test('every import resolves to a file that exists (no dead imports)', () => {
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target.internal && !/\.(css|svg)$/.test(target.internal)) assert.ok(files.includes(target.internal), `${file} imports ${specifier}, which does not exist`);
    }
  }
});

test('RULES (src/domain, pure) import only other rule files and Node built-ins: never data, services or http', () => {
  for (const file of files.filter((f) => layerOf(f) === 'rules')) {
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target.external) assert.ok(target.external.startsWith('node:'), `${file} imports the package "${specifier}"`);
      else assert.ok(layerOf(target.internal) === 'rules', `${file} (rules) imports ${target.internal} (${layerOf(target.internal)}): rules may only use rules`);
    }
  }
});

test('DATA (inventory, repositories and database connection) imports only data, rules and Node built-ins', () => {
  for (const file of files.filter((f) => layerOf(f) === 'data')) {
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target.external) assert.ok(target.external.startsWith('node:'), `${file} imports the package "${specifier}"`);
      else assert.ok(['data', 'rules'].includes(layerOf(target.internal)), `${file} imports ${target.internal}`);
    }
  }
});

test('SERVICES import services and rules; auth may use the isolated crypto primitives', () => {
  for (const file of files.filter((f) => layerOf(f) === 'services')) {
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target.external) assert.ok(target.external.startsWith('node:'), `${file} imports the package "${specifier}"`);
      else {
        const injectedServices = ['services', 'rules'].includes(layerOf(target.internal));
        const isolatedAuthPrimitive = file === 'services/authService.js'
          && ['lib/password.js', 'lib/token.js'].includes(target.internal);
        assert.ok(injectedServices || isolatedAuthPrimitive, `${file} (services) imports ${target.internal}: dependencies must be injected`);
      }
    }
  }
});

test('infrastructure adapters import no application layer', () => {
  for (const file of files.filter((f) => f.startsWith('lib/'))) {
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target.external) assert.ok(target.external.startsWith('node:'), `${file} imports the package "${specifier}"`);
      else assert.equal(target.internal.startsWith('lib/'), true, `${file} imports ${target.internal}`);
    }
  }
});

test('ROUTES (src/http) import only http and services, plus domain/errors.js to recognise errors: no rules, no data', () => {
  for (const file of files.filter((f) => layerOf(f) === 'http')) {
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target.external) {
        assert.ok(target.external.startsWith('node:'), `${file} imports the package "${specifier}": the server must use node: built-ins only`);
      } else {
        const allowed = layerOf(target.internal) === 'http' || layerOf(target.internal) === 'services' || target.internal === 'domain/errors.js';
        assert.ok(allowed, `${file} (routes) imports ${target.internal}: routes must go through services`);
      }
    }
  }
});

test('the React screen (src/ui) never imports the server code', () => {
  for (const file of files.filter((f) => layerOf(f) === 'ui')) {
    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target.internal) assert.ok(['ui', 'rules', 'data'].includes(layerOf(target.internal)), `${file} imports ${target.internal}`);
    }
  }
});

test('the server is built from Node itself: no outside packages are used by application code', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'package.json has runtime dependencies');
  for (const file of files.filter((f) => ['http', 'services', 'rules', 'data', 'lib'].includes(layerOf(f)) || f === 'config.js' || f === 'server.js')) {
    for (const specifier of importsOf(file)) assert.ok(specifier.startsWith('.') || specifier.startsWith('node:'), `${file} imports "${specifier}"`);
  }
});

test('route handlers contain no business rules or persistence: routes.js only calls services', () => {
  const source = readFileSync(path.join(SRC, 'http/routes.js'), 'utf8').replace(/\/\/.*$/gm, '');
  for (const forbidden of ['bookTickets', 'cancelBooking', 'transitionBooking', 'assertTransition', 'createStore', 'inventory', 'repository', 'paymentGateway']) {
    assert.ok(!source.includes(forbidden), `routes.js mentions ${forbidden}: that belongs in a service`);
  }
  assert.match(source, /services\./); // it does call a service
});

// ----- the document itself -----

const doc = readFileSync(path.join(ROOT, 'docs/architecture.md'), 'utf8');

test('docs/architecture.md has exactly the three diagrams: layers, data model, booking states', () => {
  const blocks = [...doc.matchAll(/```mermaid\s+(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['flowchart', 'erDiagram', 'stateDiagram-v2']);
});

test('the layer diagram shows routes -> services -> rules / data, and nothing pointing upwards', () => {
  const layers = doc.match(/```mermaid\s+flowchart TD([\s\S]*?)```/)[1];
  for (const arrow of ['client -->', 'routes -->', 'services -->', 'data -->']) assert.ok(layers.includes(arrow), `missing arrow: ${arrow}`);
  for (const upward of [/rules\s*-->/, /data\s*-->\|[^|]*\|\s*(services|routes)/, /services\s*-->\|[^|]*\|\s*routes/]) assert.doesNotMatch(layers, upward);
});

test('under the layer diagram, each of the four layers has one sentence saying what it may and may not do', () => {
  for (const layer of ['Routes', 'Services', 'Rules', 'Data']) {
    const line = doc.split('\n').find((l) => l.startsWith(`- **${layer}**`));
    assert.ok(line, `no sentence for ${layer}`);
    assert.match(line, /\bmay\b/);
    assert.match(line, /\bmay not\b/);
  }
});

test('the data model diagram names events, ticket tiers, bookings and users', () => {
  const er = doc.match(/```mermaid\s+erDiagram([\s\S]*?)```/)[1];
  for (const entity of ['EVENT {', 'TICKET_TIER {', 'BOOKING {', 'USER {']) assert.ok(er.includes(entity), entity);
});

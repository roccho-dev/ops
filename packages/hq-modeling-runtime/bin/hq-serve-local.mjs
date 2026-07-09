#!/usr/bin/env node
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

import { buildLocalStatus, buildServeLocalPlan } from '../lib/local-root.mjs';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8787' },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.root) {
  console.error('usage: hq-serve-local --root <path> [--host 127.0.0.1] [--port 8787] [--dry-run] [--json]');
  process.exit(2);
}

const plan = buildServeLocalPlan({ root: values.root, host: values.host, port: Number(values.port) });
if (!plan.ok) {
  if (values.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`hq serve local: FAIL errors=${plan.errors.join(',')}`);
  }
  process.exit(1);
}

if (values['dry-run']) {
  if (values.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`hq serve local: PASS root=${values.root} host=${values.host} port=${values.port}`);
  }
  process.exit(0);
}

const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(buildLocalStatus({ root: values.root, endpoint: { host: values.host } })));
});

server.listen(Number(values.port), values.host, () => {
  console.log(`hq serve local listening on ${values.host}:${values.port}`);
});

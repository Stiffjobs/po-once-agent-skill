const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scriptPath = path.join(__dirname, '../skills/po-once/scripts/po-once.cjs');
const source = fs.readFileSync(scriptPath, 'utf8');

async function run(args, response = { monitors: [], nextCursor: null, isDone: true }, status = 200) {
  const requests = [];
  const output = [];
  const errors = [];
  let exitCode = 0;
  const sandbox = {
    require,
    __filename: scriptPath,
    __dirname: path.dirname(scriptPath),
    URL,
    URLSearchParams,
    Buffer,
    setTimeout,
    clearTimeout,
    process: {
      argv: ['node', scriptPath, ...args],
      env: { PO_ONCE_AGENT_API_KEY: 'po_live_org_test_fixture' },
      cwd: () => __dirname,
      exit: (code) => { exitCode = code; },
    },
    console: {
      log: (value) => output.push(value),
      error: (value) => errors.push(value),
    },
    fetch: async (url, options) => {
      requests.push({ url: new URL(url), ...options });
      return { ok: status < 400, status, text: async () => JSON.stringify(response) };
    },
  };
  await vm.runInNewContext(source, sandbox, { filename: scriptPath });
  return { requests, output, errors, exitCode };
}

test('lists monitors with active filtering and encoded pagination', async () => {
  const response = { monitors: [{ id: 'monitor-a', autoReplyEnabled: false }], nextCursor: 'next', isDone: false };
  const cursor = 'opaque+/=& token';
  const result = await run(['keyword-monitors', '--active', '--limit', '2', '--cursor', cursor], response);
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.equal(request.method, 'GET');
  assert.equal(request.url.origin, 'https://dynamic-lapwing-647.convex.site');
  assert.equal(request.url.pathname, '/api/agent/v1/keyword-monitors');
  assert.deepEqual(Object.fromEntries(request.url.searchParams), { active: 'true', limit: '2', cursor });
  assert.deepEqual(JSON.parse(result.output.join('')), response);
});

test('includes all monitors by default or with active false and caps page size', async () => {
  const defaults = await run(['keyword-monitors']);
  assert.equal(defaults.requests[0].url.search, '');
  const result = await run(['keyword-monitors', '--active', 'false', '--limit', '500']);
  assert.deepEqual(Object.fromEntries(result.requests[0].url.searchParams), { active: 'false', limit: '100' });
});

test('preserves empty match pages and continuation cursors with all filters', async () => {
  const filters = ['keyword-matches', '--monitor-id', 'monitor-a', '--status', 'pending', '--post-age-hours', '24', '--limit', '1'];
  const first = await run(filters, { matches: [], nextCursor: 'next+/=', isDone: false });
  const page = JSON.parse(first.output.join(''));
  assert.deepEqual(page, { matches: [], nextCursor: 'next+/=', isDone: false });
  const second = await run([...filters, '--cursor', page.nextCursor], { matches: [{ id: 'match-a' }], nextCursor: null, isDone: true });
  assert.equal(second.requests.length, 1);
  assert.equal(second.requests[0].url.pathname, '/api/agent/v1/keyword-matches');
  assert.deepEqual(Object.fromEntries(second.requests[0].url.searchParams), {
    monitorId: 'monitor-a', status: 'pending', limit: '1', cursor: 'next+/=', postAgeHours: '24',
  });
  assert.equal(JSON.parse(second.output.join('')).isDone, true);
});

test('rejects malformed monitoring options before making a request', async () => {
  const invalid = [
    ['keyword-monitors', '--active', 'sometimes'],
    ['keyword-matches', '--status', 'draft'],
    ['keyword-matches', '--monitor-id'],
    ['keyword-matches', '--monitor-id', ''],
    ...['keyword-monitors', 'keyword-matches'].flatMap((command) => [
      [command, '--cursor'], [command, '--cursor', ' '], [command, '--limit'],
      ...['0', '-1', '1.5', '2abc', '1e2', '9007199254740992'].map((value) => [command, '--limit', value]),
    ]),
    ...['0', '-1', '1.5', '2abc'].map((value) => ['keyword-matches', '--post-age-hours', value]),
    ['keyword-matches', '--post-age-hours'],
  ];
  for (const args of invalid) {
    const result = await run(args);
    assert.equal(result.exitCode, 1, args.join(' '));
    assert.equal(result.requests.length, 0, args.join(' '));
    assert.equal(result.errors.length, 1, args.join(' '));
  }
});

test('surfaces organization rejection without retrying', async () => {
  const result = await run(['keyword-matches', '--monitor-id', 'other-org-monitor'], {
    error: { code: 'AGENT_KEYWORD_MATCHES_FAILED', message: 'Keyword monitor does not belong to this organization' },
  }, 403);
  assert.equal(result.exitCode, 1);
  assert.equal(result.requests.length, 1);
  assert.match(result.errors.join(''), /403.*AGENT_KEYWORD_MATCHES_FAILED/);
});

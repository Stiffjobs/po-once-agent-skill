const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scriptPath = path.join(__dirname, '../skills/po-once/scripts/po-once.cjs');
const source = fs.readFileSync(scriptPath, 'utf8');

const page = { contents: [], nextCursor: null, isDone: true };

async function run(args, response = page, status = 200) {
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

const postFlags = ['--content-id', 'content-a', '--accounts', 'profile-a,profile-b'];

test('lists saved content with filters, encoded pagination and a capped page size', async () => {
  const cursor = 'opaque+/=& token';
  const result = await run(['contents', '--query', ' product launch ', '--post-type', 'Image', '--limit', '500', '--cursor', cursor]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.equal(request.method, 'GET');
  assert.equal(request.url.pathname, '/api/agent/v1/contents');
  assert.deepEqual(Object.fromEntries(request.url.searchParams), {
    limit: '100',
    cursor,
    postType: 'image',
    search: 'product launch',
  });
  assert.deepEqual(JSON.parse(result.output.join('')), page);

  const defaults = await run(['contents']);
  assert.equal(defaults.requests[0].url.search, '');
});

test('gets one saved content by an encoded id', async () => {
  const result = await run(['contents:get', '--id', 'content/a'], { content: { id: 'content/a' }, media: [], posts: [], postsTruncated: false });
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests[0].method, 'GET');
  assert.equal(result.requests[0].url.pathname, '/api/agent/v1/contents/content%2Fa');
});

test('rejects malformed content options before making a request', async () => {
  for (const args of [
    ['contents', '--post-type', 'carousel'],
    ['contents', '--limit', '0'],
    ['contents:get'],
  ]) {
    const result = await run(args);
    assert.equal(result.requests.length, 0, args.join(' '));
    assert.notEqual(result.exitCode, 0, args.join(' '));
  }
});

test('posts the content to the accounts with no retry or per-account fields', async () => {
  const result = await run([
    'post', ...postFlags, '--mode', 'scheduled', '--schedule', '2030-01-02T03:04:05Z', '--timezone', 'Asia/Taipei',
    '--first-comment', 'Link in bio',
  ], { batchId: 'batch-a', postIds: ['post-a'] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests[0].method, 'POST');
  assert.equal(result.requests[0].url.pathname, '/api/agent/v1/posts');
  assert.deepEqual(JSON.parse(result.requests[0].body), {
    contentId: 'content-a',
    socialProfileIds: ['profile-a', 'profile-b'],
    mode: 'scheduled',
    scheduledTime: Date.parse('2030-01-02T03:04:05Z'),
    scheduledTimezone: 'Asia/Taipei',
    firstComment: 'Link in bio',
  });
});

test('edits only the given content fields, and --clear-title sends an empty title', async () => {
  const edit = await run(['contents:update', '--id', 'content/a', '--caption', 'New caption', '--profile-hint', 'warm']);
  assert.equal(edit.exitCode, 0);
  assert.equal(edit.requests[0].method, 'PATCH');
  assert.equal(edit.requests[0].url.pathname, '/api/agent/v1/contents/content%2Fa');
  assert.deepEqual(JSON.parse(edit.requests[0].body), { caption: 'New caption', profileHint: 'warm' });

  const clear = await run(['contents:update', '--id', 'content-a', '--clear-title']);
  assert.deepEqual(JSON.parse(clear.requests[0].body), { title: '' });
});

test('rejects empty or conflicting content edits before making a request', async () => {
  for (const args of [
    ['contents:update', '--id', 'content-a'],
    ['contents:update', '--id', 'content-a', '--caption', '   '],
    ['contents:update', '--id', 'content-a', '--title', 'T', '--clear-title'],
    ['contents:update', '--caption', 'no id'],
    ['contents:delete'],
  ]) {
    const result = await run(args);
    assert.equal(result.requests.length, 0, args.join(' '));
    assert.notEqual(result.exitCode, 0, args.join(' '));
  }
});

test('deletes content and surfaces a refusal while posts are active', async () => {
  const deleted = await run(['contents:delete', '--id', 'content-a'], { deletedContentId: 'content-a', deletedPostRecords: 2, freedBytes: 10 });
  assert.equal(deleted.exitCode, 0);
  assert.equal(deleted.requests[0].method, 'DELETE');
  assert.equal(deleted.requests[0].url.pathname, '/api/agent/v1/contents/content-a');

  const error = { error: { code: 'CONTENT_HAS_ACTIVE_POSTS', message: 'Cancel post-a first.' } };
  const refused = await run(['contents:delete', '--id', 'content-a'], error, 409);
  assert.equal(refused.requests.length, 1);
  assert.notEqual(refused.exitCode, 0);
  assert.match(refused.errors.join(''), /CONTENT_HAS_ACTIVE_POSTS/);
});

test('lists posts in a calendar window as Unix milliseconds', async () => {
  const result = await run(['posts', '--from', '2026-11-01T00:00:00+08:00', '--to', '1793635200000', '--status', 'scheduled'], { tasks: [] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests[0].url.pathname, '/api/agent/v1/posts');
  assert.deepEqual(Object.fromEntries(result.requests[0].url.searchParams), {
    status: 'scheduled',
    from: String(Date.parse('2026-11-01T00:00:00+08:00')),
    to: '1793635200000',
  });

  const toOnly = await run(['posts', '--to', '1793635200000']);
  assert.equal(toOnly.requests.length, 0);
  assert.notEqual(toOnly.exitCode, 0);
});

test('reads usage, post analytics, and profile post metrics', async () => {
  const usage = await run(['usage'], { plan: { name: 'pro' } });
  assert.equal(usage.requests[0].url.pathname, '/api/agent/v1/usage');

  const post = await run(['analytics:post', '--id', 'post/a'], { metrics: {} });
  assert.equal(post.requests[0].url.pathname, '/api/agent/v1/analytics/posts/post%2Fa');

  const posts = await run(['analytics:profile-posts', '--profile-id', 'profile-a', '--limit', '500', '--cursor', 'next'], { posts: [] });
  assert.equal(posts.requests[0].url.pathname, '/api/agent/v1/analytics/profile-posts');
  assert.deepEqual(Object.fromEntries(posts.requests[0].url.searchParams), { profileId: 'profile-a', limit: '50', cursor: 'next' });
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scriptPath = path.join(__dirname, '../skills/po-once/scripts/po-once.cjs');
const source = fs.readFileSync(scriptPath, 'utf8');

const page = { profile: { id: 'profile-a', provider: 'instagram' }, comments: [], nextCursor: null, hasMore: false };

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

test('discovers posts with encoded pagination and caps the page size', async () => {
  const response = { ...page, posts: [{ id: '18000000000000001' }], nextCursor: 'next+/=', hasMore: true };
  const result = await run(['comments:posts', '--profile-id', 'profile-a', '--limit', '500', '--cursor', 'prev+/=& x'], response);
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.equal(request.method, 'GET');
  assert.equal(request.url.pathname, '/api/agent/v1/comments/posts');
  assert.deepEqual(Object.fromEntries(request.url.searchParams), { profileId: 'profile-a', limit: '100', cursor: 'prev+/=& x' });
  assert.deepEqual(JSON.parse(result.output.join('')), response);
});

test('reads top-level comments and direct replies with Meta platform ids', async () => {
  const comments = await run(['comments', '--profile-id', 'profile-a', '--post-id', '123_456', '--limit', '20']);
  assert.equal(comments.exitCode, 0);
  assert.equal(comments.requests[0].url.pathname, '/api/agent/v1/comments');
  assert.deepEqual(Object.fromEntries(comments.requests[0].url.searchParams), { profileId: 'profile-a', postId: '123_456', limit: '20' });
  const replies = await run(['comments', '--profile-id', 'profile-a', '--post-id', '456', '--comment-id', '789', '--cursor', 'c1']);
  assert.deepEqual(Object.fromEntries(replies.requests[0].url.searchParams), { profileId: 'profile-a', postId: '456', commentId: '789', cursor: 'c1' });
});

test('rejects malformed comment options before making a request', async () => {
  const invalid = [
    ['comments:posts'],
    ['comments:posts', '--profile-id'],
    ['comments:posts', '--profile-id', ' '],
    ['comments', '--profile-id', 'profile-a'],
    ['comments', '--profile-id', 'profile-a', '--post-id'],
    ['comments', '--profile-id', 'profile-a', '--post-id', 'https://www.instagram.com/p/abc/'],
    ['comments', '--profile-id', 'profile-a', '--post-id', 'task_id'],
    ['comments', '--profile-id', 'profile-a', '--post-id', '456', '--comment-id', '../me'],
    ...['comments:posts', 'comments'].flatMap((command) => {
      const base = command === 'comments' ? [command, '--profile-id', 'profile-a', '--post-id', '456'] : [command, '--profile-id', 'profile-a'];
      return [
        [...base, '--cursor'], [...base, '--cursor', ' '], [...base, '--limit'],
        ...['0', '-1', '1.5', '2abc', '1e2'].map((value) => [...base, '--limit', value]),
      ];
    }),
  ];
  for (const args of invalid) {
    const result = await run(args);
    assert.equal(result.exitCode, 1, args.join(' '));
    assert.equal(result.requests.length, 0, args.join(' '));
    assert.equal(result.errors.length, 1, args.join(' '));
  }
});

test('surfaces provider and permission errors without retrying', async () => {
  const result = await run(['comments', '--profile-id', 'profile-a', '--post-id', '456'], {
    error: { code: 'COMMENTS_PERMISSION_REQUIRED', message: 'Meta denied comment access.' },
  }, 403);
  assert.equal(result.exitCode, 1);
  assert.equal(result.requests.length, 1);
  assert.match(result.errors.join(''), /403.*COMMENTS_PERMISSION_REQUIRED/);
});

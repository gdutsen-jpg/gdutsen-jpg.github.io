import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminWorker } from './src/worker.mjs';
import { createGitHubStore } from './src/github-store.mjs';

const base = 'https://album-admin.example';
const env = {
  ADMIN_ORIGIN: base,
  ALBUM_URL: 'http://www.wzqls.online/',
  GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-secret',
  GITHUB_OWNER_ID: '55',
  GITHUB_REPOSITORY_ID: '78',
  GITHUB_REPOSITORY: 'owner/pages',
  GITHUB_BRANCH: 'main',
  SESSION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
  ASSETS: { fetch: () => new Response('static') },
};
function request(worker, path, options, override = env) {
  return worker.fetch(new Request(base + path, options), override);
}

test('assets, readiness, and anonymous write access', async () => {
  const worker = createAdminWorker();
  const page = await request(worker, '/');
  assert.equal(await page.text(), 'static');
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  const inactive = await request(worker, '/api/session', {}, { ...env, GITHUB_CLIENT_SECRET: '' });
  assert.deepEqual(await inactive.json(), { ready: false, user: null, albumUrl: env.ALBUM_URL });
  assert.equal((await request(worker, '/api/content')).status, 401);
  const write = await request(worker, '/api/activities', { method: 'POST', headers: { Origin: base } });
  assert.equal(write.status, 401);
  assert.equal((await request(worker, '/api/memories', { method: 'POST' })).status, 403);
});

test('OAuth PKCE, owner and repository restrictions, encrypted session, and same-origin mutations', async () => {
  const requests = [];
  const mutations = [];
  const stagedPhoto = { id: 'staged-photo', name: 'photo.jpg', file: 'assets/photos/sample.jpg' };
  const stagedBlob = 'b'.repeat(40);
  let userId = 77;
  const installation = { id: 23, account: { id: 55 }, permissions: { contents: 'write' }, repository_selection: 'selected' };
  const repository = { id: 78, full_name: 'owner/pages', permissions: { push: true } };
  let installations = [installation];
  let repositories = [repository];
  const worker = createAdminWorker({
    fetcher: async (url, options) => {
      assert.equal(options.redirect, 'manual');
      requests.push({ url, options });
      if (url.endsWith('/access_token')) return Response.json({ access_token: 'ghu_test_bearer', expires_in: 28800 });
      if (url.endsWith('/user')) return Response.json({ id: userId, login: 'owner' });
      assert.equal(options.headers.Authorization, 'Bearer ghu_test_bearer');
      if (url === 'https://api.github.com/user/installations') {
        return Response.json({ total_count: installations.length, installations });
      }
      assert.equal(url, 'https://api.github.com/user/installations/23/repositories');
      return Response.json({ total_count: repositories.length, repositories });
    },
    makeStore: ({ token, repository, branch, regionIds, wheelDefaults }) => {
      assert.equal(wheelDefaults.cuisines.length, 16);
      assert.equal(Object.hasOwn(wheelDefaults, 'ingredients'), false);
      assert.equal(regionIds.world.has('JPN'), true);
      assert.equal(regionIds.china.has('CN-GD'), true);
      assert.equal(token, 'ghu_test_bearer');
      assert.equal(repository, 'owner/pages');
      assert.equal(branch, 'main');
      const save = (input) => {
        mutations.push(input);
        return { commit: 'abc', changed: true };
      };
      return {
        getContent: () => ({ activities: [], memories: [] }),
        addActivity: save,
        removeActivity: save,
        changeWheelOptions: save,
        updateVisited: save,
        addMemoryPhotos: save,
        setMemoryCover: save,
        stageMemoryPhoto: (input) => {
          mutations.push(input);
          return { photo: stagedPhoto, blobSha: stagedBlob };
        },
        addMemoryPhotoBatch: (input, staged) => {
          assert.deepEqual(staged, [{ photo: stagedPhoto, blobSha: stagedBlob }]);
          return save({ operationId: input.operationId, coverPhotoId: input.coverPhotoId });
        },
      };
    },
  });
  const start = await request(worker, '/auth/login');
  const auth = new URL(start.headers.get('Location'));
  assert.equal(auth.origin, 'https://github.com');
  assert.equal(auth.searchParams.get('redirect_uri'), base + '/auth/callback');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const oauthCookie = start.headers.getSetCookie()[0].split(';')[0];
  assert.match(start.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Lax/);
  const options = { headers: { Cookie: oauthCookie } };
  const callback = '/auth/callback?code=code&state=' + auth.searchParams.get('state');
  assert.equal((await request(worker, callback + '-wrong', options)).headers.get('Location'), '/?error=auth');
  assert.equal(requests.length, 0);
  assert.equal((await request(worker, callback, options)).headers.get('Location'), '/?error=forbidden');
  assert.equal(requests.length, 2);
  const exchange = requests[0].options.body;
  assert.equal(exchange.get('repository_id'), '78');
  const verifier = new TextEncoder().encode(exchange.get('code_verifier'));
  const challenge = new Uint8Array(await crypto.subtle.digest('SHA-256', verifier));
  assert.equal(Buffer.from(challenge).toString('base64url'), auth.searchParams.get('code_challenge'));
  userId = 55;
  const restrictedInstallations = [
    [],
    [{ ...installation, account: { id: 77 } }],
    [{ ...installation, permissions: { contents: 'read' } }],
    [{ ...installation, repository_selection: 'all' }],
    [installation, { ...installation, id: 24 }],
  ];
  for (const candidate of restrictedInstallations) {
    installations = candidate;
    assert.equal((await request(worker, callback, options)).headers.get('Location'), '/?error=repository');
  }
  installations = [installation];
  const restrictedRepositories = [
    [],
    [{ ...repository, id: 79 }],
    [{ ...repository, full_name: 'owner/wrong' }],
    [{ ...repository, permissions: { push: false } }],
    [repository, { ...repository, id: 79, full_name: 'owner/another' }],
  ];
  for (const candidate of restrictedRepositories) {
    repositories = candidate;
    assert.equal((await request(worker, callback, options)).headers.get('Location'), '/?error=repository');
  }
  repositories = [repository];
  const login = await request(worker, callback, options);
  assert.equal(login.headers.get('Location'), '/');
  const active = login.headers.getSetCookie().find((value) => value.startsWith('__Host-gomoku-session='));
  assert.match(active, /Max-Age=3600; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(active, /ghu_test_bearer/);
  const cookie = active.split(';')[0];
  const session = await request(worker, '/api/session', { headers: { Cookie: cookie } });
  assert.deepEqual(await session.json(), { ready: true, user: { login: 'owner' }, albumUrl: env.ALBUM_URL });
  assert.equal((await request(worker, '/api/content', { headers: { Cookie: cookie + 'tamper' } })).status, 401);
  const makeWrite = (origin, body, contentType = 'application/json') => ({
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': contentType },
    body,
  });
  assert.equal((await request(worker, '/api/activities', makeWrite('https://elsewhere.example', '{}'))).status, 403);
  assert.equal((await request(worker, '/api/activities', makeWrite(base, '{}', 'text/plain'))).status, 415);
  assert.equal((await request(worker, '/api/activities', makeWrite(base, '[]'))).status, 400);
  assert.equal((await request(worker, '/api/photos', makeWrite(base, 'x'.repeat(1_450_001)))).status, 413);
  assert.equal(mutations.length, 0);
  const activity = { name: '测试', operationId: 'browser-update-01' };
  assert.deepEqual(await (await request(worker, '/api/activities', makeWrite(base, JSON.stringify(activity)))).json(), { commit: 'abc', changed: true });
  const memory = { photos: [{ name: 'photo.jpg', dataUrl: 'data:image/jpeg;base64,ABCD' }] };
  assert.deepEqual(await (await request(worker, '/api/memories', makeWrite(base, JSON.stringify(memory)))).json(), { commit: 'abc', changed: true });
  assert.deepEqual(mutations, [activity, memory]);
  const visits = {
    operationId: 'browser-map-test01',
    changes: [{ map: 'world', id: 'JPN', visited: true }, { map: 'china', id: 'CN-GD', visited: false }],
  };
  const visitsBody = JSON.stringify(visits);
  assert.equal((await request(worker, '/api/visited', makeWrite('https://elsewhere.example', visitsBody))).status, 403);
  assert.equal((await request(worker, '/api/visited', { method: 'POST', headers: { Origin: base }, body: visitsBody })).status, 401);
  assert.equal((await request(worker, '/api/visited', makeWrite(base, visitsBody))).status, 200);
  assert.deepEqual(mutations.at(-1), visits);
  const remove = { name: activity.name, operationId: 'browser-remove-01' };
  assert.equal((await request(worker, '/api/activities/remove', makeWrite(base, JSON.stringify(remove)))).status, 200);
  assert.deepEqual(mutations.at(-1), remove);
  const wheelChange = { wheel: 'cuisines', action: 'add', name: '家常菜', operationId: 'browser-wheel-test1' };
  assert.equal((await request(worker, '/api/wheel-options', makeWrite('https://elsewhere.example', JSON.stringify(wheelChange)))).status, 403);
  assert.equal((await request(worker, '/api/wheel-options', { method: 'POST', headers: { Origin: base }, body: JSON.stringify(wheelChange) })).status, 401);
  assert.equal((await request(worker, '/api/wheel-options', makeWrite(base, JSON.stringify(wheelChange)))).status, 200);
  assert.deepEqual(mutations.at(-1), wheelChange);
  const stageInput = { name: 'photo.jpg', operationId: 'browser-photo-001', dataUrl: 'data:image/jpeg;base64,ABCD' };
  const stage = await request(worker, '/api/photos', makeWrite(base, JSON.stringify(stageInput)));
  assert.equal(stage.status, 200);
  const upload = await stage.json();
  assert.equal(upload.id, stagedPhoto.id);
  assert.equal(typeof upload.receipt, 'string');
  assert.doesNotMatch(upload.receipt, /assets\/photos/);
  const batch = { operationId: 'browser-batch-001', coverPhotoId: upload.id, photoReceipts: [upload.receipt] };
  const forged = { ...batch, photoReceipts: [upload.receipt + 'altered'] };
  assert.equal((await request(worker, '/api/memories', makeWrite(base, JSON.stringify(forged)))).status, 422);
  assert.deepEqual(mutations.at(-1), stageInput);
  assert.equal((await request(worker, '/api/memories', makeWrite(base, JSON.stringify(batch)))).status, 200);
  assert.deepEqual(mutations.at(-1), { operationId: batch.operationId, coverPhotoId: batch.coverPhotoId });
  const cover = { entryId: 'existing', photoId: upload.id, operationId: 'browser-cover-001' };
  assert.equal((await request(worker, '/api/memories/cover', makeWrite(base, JSON.stringify(cover)))).status, 200);
  assert.deepEqual(mutations.at(-1), cover);
  const logout = await request(worker, '/auth/logout', { method: 'POST', headers: { Origin: base, Cookie: cookie } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.getSetCookie()[0], /Max-Age=0/);
});

test('GitHub data requests reject redirects without forwarding their token', async () => {
  let requests = 0;
  const store = createGitHubStore({
    token: 'test-token',
    repository: 'owner/pages',
    fetcher: async (url, options) => {
      requests += 1;
      assert.equal(url, 'https://api.github.com/repos/owner/pages/git/ref/heads/main');
      assert.equal(options.redirect, 'manual');
      return Response.redirect('https://elsewhere.example');
    },
  });
  await assert.rejects(() => store.getContent(), { status: 502 });
  assert.equal(requests, 1);
});

test('retired ingredient data survives writes to an active wheel', async () => {
  const config = { activities: ['散步'], cuisines: ['粤菜'], ingredients: ['鱼', '鸡肉'], visited: { world: [], china: [] } };
  const baseSha = 'a'.repeat(40);
  const previousTree = 'b'.repeat(40);
  const nextTree = 'c'.repeat(40);
  const nextCommit = 'd'.repeat(40);
  let outgoingRequests = 0;
  let written;
  const store = createGitHubStore({
    token: 'test-token',
    repository: 'owner/pages',
    fetcher: async (url, options) => {
      outgoingRequests += 1;
      const endpoint = new URL(url).pathname.slice('/repos/owner/pages'.length);
      if (endpoint === '/git/ref/heads/main') return Response.json({ object: { sha: baseSha } });
      if (endpoint === '/contents/data/site-content.js') {
        return new Response('globalThis.GomokuPublishedContent = ' + JSON.stringify(config) + ';');
      }
      if (endpoint === '/git/commits/' + baseSha) return Response.json({ tree: { sha: previousTree } });
      if (endpoint === '/git/trees') {
        const { tree } = JSON.parse(options.body);
        written = JSON.parse(tree[0].content.slice('globalThis.GomokuPublishedContent = '.length).trim().slice(0, -1));
        return Response.json({ sha: nextTree });
      }
      if (endpoint === '/git/commits') return Response.json({ sha: nextCommit });
      assert.equal(endpoint, '/git/refs/heads/main');
      assert.equal(JSON.parse(options.body).force, false);
      return Response.json({ object: { sha: nextCommit } });
    },
  });
  const mutation = { action: 'add', name: '徽菜', operationId: 'wheel-option-0001' };
  await assert.rejects(store.changeWheelOptions({ ...mutation, wheel: 'ingredients' }), { status: 422 });
  assert.equal(outgoingRequests, 0);
  assert.deepEqual(await store.changeWheelOptions({ ...mutation, wheel: 'cuisines' }), { commit: nextCommit, changed: true });
  assert.deepEqual(written, { ...config, cuisines: ['粤菜', '徽菜'] });
});


import { createGitHubStore } from './github-store.mjs';
import { regionIds } from './region-ids.mjs';

const SESSION_COOKIE = '__Host-gomoku-session';
const OAUTH_COOKIE = '__Host-gomoku-oauth';
const OAUTH_SECONDS = 600;
const SESSION_SECONDS = 3600;
const MAX_REQUEST_BYTES = 1_450_000;
const MAX_BATCH_REQUEST_BYTES = 16 * 1024 * 1024;
const PHOTO_STAGE_SECONDS = 24 * 3600;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const wheelDefaults = {
  cuisines: [
    '粤菜', '川菜', '湘菜', '江浙菜', '西北菜', '云贵菜', '东北菜', '火锅',
    '烧烤烤肉', '海鲜', '小吃简餐', '自助餐', '日式料理', '韩式料理', '东南亚菜', '西餐',
  ],
  ingredients: [
    '鸡腿', '鸡翅', '鸡胸肉', '鸭肉', '五花肉', '猪排骨', '猪里脊', '牛腩',
    '牛腱子', '牛里脊', '羊腿肉', '羊排',
  ],
};
const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://raw.githubusercontent.com; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value) {
  const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bytes, (byte) => byte.charCodeAt(0));
}

function randomToken() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

function cookieValue(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  for (const item of cookies.split(';')) {
    const cookie = item.trim();
    if (cookie.startsWith(name + '=')) return cookie.slice(name.length + 1);
  }
  return '';
}

function cookie(name, value, maxAge) {
  return name + '=' + value + '; Max-Age=' + maxAge + '; Path=/; HttpOnly; Secure; SameSite=Lax';
}

async function seal(env, payload) {
  const key = await crypto.subtle.importKey('raw', decode(env.SESSION_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  return encode(iv) + '.' + encode(new Uint8Array(data));
}

async function unseal(env, value, kind, decryptionKey) {
  if (!value || value.length > 3200) return null;
  try {
    const [iv, data, extra] = value.split('.');
    if (!data || extra !== undefined || decode(iv).length !== 12) return null;
    const key = decryptionKey ?? await crypto.subtle.importKey('raw', decode(env.SESSION_KEY), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, key, decode(data));
    const payload = JSON.parse(decoder.decode(plain));
    return payload.kind === kind && payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function secureResponse(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value, status = 200) {
  return Response.json(value, { status });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

function isReady(env, url) {
  return url.protocol === 'https:' && url.origin === env.ADMIN_ORIGIN &&
    Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_KEY);
}

async function readJson(request, maxBytes = MAX_REQUEST_BYTES) {
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'Send the request as JSON.');
  }
  if (Number(request.headers.get('Content-Length')) > maxBytes) {
    throw new RequestError(413, 'The photo exceeds the upload size.');
  }
  if (!request.body) throw new RequestError(400, 'The request is empty.');
  const reader = request.body.getReader();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const parts = [];
  let byteCount = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel();
        throw new RequestError(413, 'The photo exceeds the upload size.');
      }
      parts.push(utf8.decode(value, { stream: true }));
    }
    parts.push(utf8.decode());
    const input = JSON.parse(parts.join(''));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid JSON object');
    return input;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'The request must be a valid JSON object.');
  } finally {
    reader.releaseLock();
  }
}

async function readPhotoReceipts(env, receipts) {
  if (!Array.isArray(receipts) || !receipts.length || receipts.some((receipt) => typeof receipt !== 'string')) {
    throw new RequestError(422, '请选择要发布的照片。');
  }
  const key = await crypto.subtle.importKey('raw', decode(env.SESSION_KEY), 'AES-GCM', false, ['decrypt']);
  const staged = await Promise.all(receipts.map((receipt) => unseal(env, receipt, 'photo', key)));
  if (staged.some((upload) => !upload)) {
    throw new RequestError(422, '照片暂存已过期，请重新选择照片。');
  }
  return staged.map(({ photo, blobSha }) => ({ photo, blobSha }));
}


async function beginLogin(env) {
  const verifier = randomToken();
  const state = randomToken();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: env.ADMIN_ORIGIN + '/auth/callback',
    state,
    code_challenge: encode(new Uint8Array(digest)),
    code_challenge_method: 'S256',
  }).toString();
  const ticket = await seal(env, {
    kind: 'oauth',
    state,
    verifier,
    expiresAt: Date.now() + OAUTH_SECONDS * 1000,
  });
  return redirect(url.toString(), [cookie(OAUTH_COOKIE, ticket, OAUTH_SECONDS)]);
}

async function hasRepositoryAccess(env, headers, fetcher) {
  const api = 'https://api.github.com/user/installations';
  const options = { headers, redirect: 'manual' };
  const installationResponse = await fetcher(api, options);
  if (!installationResponse.ok) return false;
  const { total_count: installationCount, installations } = await installationResponse.json();
  if (installationCount !== 1 || !Array.isArray(installations) || installations.length !== 1) return false;
  const [installation] = installations;
  if (String(installation?.account?.id) !== env.GITHUB_OWNER_ID ||
      installation.permissions?.contents !== 'write' || installation.repository_selection !== 'selected' ||
      !Number.isSafeInteger(installation.id) || installation.id <= 0 || installation.suspended_at) {
    return false;
  }

  const repositoryResponse = await fetcher(`${api}/${installation.id}/repositories`, options);
  if (!repositoryResponse.ok) return false;
  const { total_count: repositoryCount, repositories } = await repositoryResponse.json();
  if (repositoryCount !== 1 || !Array.isArray(repositories) || repositories.length !== 1) return false;
  const [repository] = repositories;
  return String(repository?.id) === env.GITHUB_REPOSITORY_ID && repository.full_name === env.GITHUB_REPOSITORY &&
    repository.permissions?.push === true;
}

async function completeLogin(request, url, env, fetcher) {
  const clear = cookie(OAUTH_COOKIE, '', 0);
  const denied = redirect('/?error=auth', [clear]);
  const state = await unseal(env, cookieValue(request, OAUTH_COOKIE), 'oauth');
  const code = url.searchParams.get('code');
  if (!state || !code || state.state !== url.searchParams.get('state')) return denied;

  try {
    const exchange = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        code_verifier: state.verifier,
        redirect_uri: env.ADMIN_ORIGIN + '/auth/callback',
        repository_id: env.GITHUB_REPOSITORY_ID,
      }),
    });
    if (!exchange.ok) return denied;
    const auth = await exchange.json();
    if (auth.error === 'bad_verification_code') return redirect('/?error=expired', [clear]);
    if (typeof auth.access_token !== 'string' || !auth.access_token.startsWith('ghu_')) return denied;
    const headers = {
      Authorization: 'Bearer ' + auth.access_token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gomoku-album-admin',
    };
    const userResponse = await fetcher('https://api.github.com/user', { headers, redirect: 'manual' });
    if (!userResponse.ok) return denied;
    const user = await userResponse.json();
    if (String(user.id) !== env.GITHUB_OWNER_ID || typeof user.login !== 'string') {
      return redirect('/?error=forbidden', [clear]);
    }
    if (!await hasRepositoryAccess(env, headers, fetcher)) {
      return redirect('/?error=repository', [clear]);
    }
    const lifetime = Number.isFinite(auth.expires_in) ? Math.min(auth.expires_in, SESSION_SECONDS) : SESSION_SECONDS;
    if (lifetime <= 0) return denied;
    const ticket = await seal(env, {
      kind: 'session',
      id: env.GITHUB_OWNER_ID,
      login: user.login,
      token: auth.access_token,
      expiresAt: Date.now() + lifetime * 1000,
    });
    return redirect('/', [clear, cookie(SESSION_COOKIE, ticket, lifetime)]);
  } catch {
    return denied;
  }
}

export function createAdminWorker({ fetcher = fetch, makeStore = createGitHubStore } = {}) {
  async function route(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const ready = isReady(env, url);

    if (method === 'GET' && pathname === '/auth/login') {
      return ready ? beginLogin(env) : redirect('/?error=auth');
    }
    if (method === 'GET' && pathname === '/auth/callback') {
      return ready ? completeLogin(request, url, env, fetcher) : redirect('/?error=auth');
    }
    if (pathname.startsWith('/auth/') || pathname.startsWith('/api/')) {
      if (method === 'POST' && (!ready || request.headers.get('Origin') !== env.ADMIN_ORIGIN)) {
        return json({ error: 'Open the secure album admin page to make changes.' }, 403);
      }
      if (method === 'POST' && pathname === '/auth/logout') {
        return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) } });
      }
      const session = ready ? await unseal(env, cookieValue(request, SESSION_COOKIE), 'session') : null;
      const authorized = session?.id === env.GITHUB_OWNER_ID && typeof session?.token === 'string';
      if (method === 'GET' && pathname === '/api/session') {
        return json({ ready, user: authorized ? { login: session.login } : null, albumUrl: env.ALBUM_URL });
      }
      if (!authorized) return json({ error: 'Sign in with GitHub to continue.' }, 401);
      const store = makeStore({ token: session.token, repository: env.GITHUB_REPOSITORY, branch: env.GITHUB_BRANCH, fetcher, regionIds, wheelDefaults });
      if (method === 'GET' && pathname === '/api/content') return json(await store.getContent());
      if (method === 'POST' && pathname === '/api/activities') return json(await store.addActivity(await readJson(request)));
      if (method === 'POST' && pathname === '/api/wheel-options') return json(await store.changeWheelOptions(await readJson(request)));
      if (method === 'POST' && pathname === '/api/visited') return json(await store.updateVisited(await readJson(request)));
      if (method === 'POST' && pathname === '/api/activities/remove') return json(await store.removeActivity(await readJson(request)));
      if (method === 'POST' && pathname === '/api/photos') {
        const { photo, blobSha } = await store.stageMemoryPhoto(await readJson(request));
        const receipt = await seal(env, {
          kind: 'photo',
          photo,
          blobSha,
          expiresAt: Date.now() + PHOTO_STAGE_SECONDS * 1000,
        });
        return json({ id: photo.id, receipt });
      }
      if (method === 'POST' && pathname === '/api/memories') {
        const input = await readJson(request, MAX_BATCH_REQUEST_BYTES);
        if (!Object.hasOwn(input, 'photoReceipts')) return json(await store.addMemoryPhotos(input));
        return json(await store.addMemoryPhotoBatch(input, await readPhotoReceipts(env, input.photoReceipts)));
      }
      if (method === 'POST' && pathname === '/api/memories/cover') return json(await store.setMemoryCover(await readJson(request)));
      return json({ error: 'This route is unavailable.' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
  return {
    async fetch(request, env) {
      try {
        return secureResponse(await route(request, env));
      } catch (error) {
        const status = error.status || error.statusCode;
        if ([400, 404, 409, 413, 415, 422].includes(status)) {
          return secureResponse(json({ error: error.message }, status));
        }
        if ([401, 403].includes(status)) {
          return secureResponse(json({ error: 'The GitHub session has expired or lacks repository access.' }, 401));
        }
        return secureResponse(json({ error: 'GitHub is unavailable. Try again in a moment.' }, 502));
      }
    },
  };
}

export default createAdminWorker();

const ALBUM_PATH = 'data/album.json';
const CONTENT_PATH = 'data/site-content.js';
const CONTENT_ASSIGNMENT = 'globalThis.GomokuPublishedContent';
const MAX_ENTRIES = 5000;
const MAX_PHOTOS_PER_ENTRY = 40;
const MAX_PHOTO_BYTES = 1024 * 1024;
const CATEGORIES = new Set(['日常', '约会', '旅行', '纪念日', '心动']);
const SHA = /^[a-f0-9]{40}$/;
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inputRecord(value) {
  if (!record(value)) throw error(400, '请提交有效的表单。');
  return value;
}

function inputText(value, { label, max, trim = true, required = false }) {
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) {
    throw error(422, `${label}最多可输入 ${max} 个字符。`);
  }
  if (required && !value.trim()) throw error(422, `请输入${label}。`);
  return trim ? value.trim() : value;
}

function operationKey(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(value)) {
    throw error(400, '提交编号无效，请刷新后再次提交。');
  }
  return value;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < '1900') {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}

function photoBytes(base64) {
  if (typeof Uint8Array.fromBase64 === 'function') {
    return Uint8Array.fromBase64(base64, { lastChunkHandling: 'strict' });
  }
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function bytesMatch(bytes, sequence, start = 0) {
  return sequence.every((byte, offset) => bytes[start + offset] === byte);
}

function asciiMatch(bytes, text, start = 0) {
  for (let offset = 0; offset < text.length; offset += 1) {
    if (bytes[start + offset] !== text.charCodeAt(offset)) return false;
  }
  return true;
}

const PHOTO_TYPES = {
  jpeg: {
    extension: 'jpg',
    matches: (bytes) => bytesMatch(bytes, [0xff, 0xd8, 0xff]),
  },
  png: {
    extension: 'png',
    matches: (bytes) => bytesMatch(bytes, [137, 80, 78, 71, 13, 10, 26, 10]),
  },
  webp: {
    extension: 'webp',
    matches: (bytes) => asciiMatch(bytes, 'RIFF') && asciiMatch(bytes, 'WEBP', 8),
  },
  gif: {
    extension: 'gif',
    matches: (bytes) => asciiMatch(bytes, 'GIF87a') || asciiMatch(bytes, 'GIF89a'),
  },
  avif: {
    extension: 'avif',
    matches: (bytes) => {
      if (!asciiMatch(bytes, 'ftyp', 4)) return false;
      const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
      if (boxSize < 16 || boxSize > bytes.length) return false;
      if (asciiMatch(bytes, 'avif', 8) || asciiMatch(bytes, 'avis', 8)) return true;
      for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
        if (asciiMatch(bytes, 'avif', offset) || asciiMatch(bytes, 'avis', offset)) return true;
      }
      return false;
    },
  },
};

async function preparePhoto(value, operationId) {
  const { dataUrl, name: inputName } = inputRecord(value);
  const name = inputText(inputName, { label: '照片名称', max: 255 });
  const match = typeof dataUrl === 'string' && /^data:image\/(jpeg|png|webp|gif|avif);base64,/.exec(dataUrl);
  if (!match) throw error(422, '照片格式应为 JPG、PNG、WebP、GIF 或 AVIF。');

  const base64 = dataUrl.slice(match[0].length);
  if (base64.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) throw error(413, '单张照片最多 1 MiB。');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw error(422, '照片编码无效，请重新选择照片。');
  }
  let bytes;
  try {
    bytes = photoBytes(base64);
  } catch {
    throw error(422, '照片编码无效，请重新选择照片。');
  }
  if (bytes.length > MAX_PHOTO_BYTES) throw error(413, '单张照片最多 1 MiB。');

  const type = PHOTO_TYPES[match[1]];
  if (bytes.length < 12 || !type.matches(bytes)) throw error(422, '照片内容与文件格式不符。');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    photo: { id: `published-${operationId}-1`, name, file: `assets/photos/${hash}.${type.extension}` },
    content: base64,
  };
}

function parseAlbum(source) {
  const message = 'GitHub 上的回忆档案格式有误。';
  let album;
  try {
    album = JSON.parse(source);
  } catch {
    throw error(502, message);
  }
  if (!record(album) || album.schemaVersion !== 1 || !record(album.settings) || !timestamp(album.updatedAt) ||
      !Array.isArray(album.entries) || !album.entries.every((entry) => record(entry) &&
        typeof entry.id === 'string' && typeof entry.title === 'string' && validDate(entry.date) && timestamp(entry.updatedAt) &&
        Array.isArray(entry.photos) && entry.photos.every((photo) => record(photo) &&
          typeof photo.id === 'string' && typeof photo.file === 'string'))) {
    throw error(502, message);
  }
  return album;
}

function parseContent(source) {
  const message = 'GitHub 上的转盘数据需要使用 JSON 格式。';
  const match = /^\s*globalThis\.GomokuPublishedContent\s*=\s*(\{[\s\S]*\})\s*;\s*$/.exec(source);
  if (!match) throw error(502, message);
  let content;
  try {
    content = JSON.parse(match[1]);
  } catch {
    throw error(502, message);
  }
  if (!record(content) || !Array.isArray(content.activities) ||
      !content.activities.every((activity) => typeof activity === 'string')) {
    throw error(502, message);
  }
  return content;
}

function gitSha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw error(502, 'GitHub 返回了无效的版本信息。');
  return value;
}

function gitBlob(path, payload) {
  return { path, mode: '100644', type: 'blob', ...payload };
}

export function createGitHubStore({ token, repository, branch = 'main', fetcher = fetch }) {
  if (typeof token !== 'string' || !token || typeof repository !== 'string' ||
      !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) || typeof branch !== 'string' || !branch ||
      branch.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw error(503, 'GitHub 同步尚未配置。');
  }
  const repoUrl = `https://api.github.com/repos/${repository}`;
  const branchPath = `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;

  async function request(path, { method = 'GET', body, raw = false, conflict = false } = {}) {
    const headers = {
      Accept: raw ? RAW_MEDIA_TYPE : 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Gomoku-Album-Admin',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetcher(`${repoUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw error(502, '暂时无法连接 GitHub，请稍后再试。');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (conflict && (response.status === 409 || response.status === 422)) return null;
      if (response.status === 429 || response.headers.get('X-RateLimit-Remaining') === '0' ||
          response.headers.has('Retry-After')) {
        throw error(503, 'GitHub 目前限制了更新频率，请稍后再试。');
      }
      if (response.status === 401 || response.status === 403) {
        throw error(502, 'GitHub 拒绝了这次操作，请检查同步应用的仓库权限。');
      }
      throw error(502, 'GitHub 暂时无法完成这次同步，请稍后再试。');
    }
    try {
      return raw ? await response.text() : await response.json();
    } catch {
      throw error(502, 'GitHub 返回了无法读取的响应。');
    }
  }

  async function readHead() {
    const branchRef = await request(`/git/ref/${branchPath}`);
    return gitSha(branchRef?.object?.sha);
  }

  async function readFile(path, head) {
    return request(`/contents/${path}?ref=${head}`, { raw: true });
  }

  async function writeFiles(fileChanges, message) {
    let head = await readHead();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const files = await fileChanges(head);
      if (!files.length) return { commit: head, changed: false };

      const previousCommit = await request(`/git/commits/${head}`);
      const tree = await request('/git/trees', {
        method: 'POST',
        body: { base_tree: gitSha(previousCommit?.tree?.sha), tree: files },
      });
      const commit = await request('/git/commits', {
        method: 'POST',
        body: { message, tree: gitSha(tree?.sha), parents: [head] },
      });
      const sha = gitSha(commit?.sha);
      const updated = await request(`/git/refs/${branchPath}`, {
        method: 'PATCH',
        body: { force: false, sha },
        conflict: true,
      });
      if (updated !== null) return { commit: sha, changed: true };

      // Reapply changes only after a competing write has advanced the branch.
      const newHead = await readHead();
      if (newHead === sha) return { commit: sha, changed: true };
      if (newHead === head) throw error(502, 'GitHub 拒绝更新发布分支，请检查分支设置。');
      head = newHead;
    }
    throw error(409, '仓库正在更新，请重试这次提交。');
  }

  async function getContent() {
    const head = await readHead();
    const [albumSource, contentSource] = await Promise.all([
      readFile(ALBUM_PATH, head),
      readFile(CONTENT_PATH, head),
    ]);
    const { activities } = parseContent(contentSource);
    const { entries } = parseAlbum(albumSource);
    const memories = entries.map(({ id, title, date, photos }) => ({ id, title, date, photoCount: photos.length }));
    memories.sort((left, right) => right.date.localeCompare(left.date));
    return { activities, memories };
  }

  async function addActivity(input) {
    const { operationId: operationInput, name: nameInput } = inputRecord(input);
    const operationId = operationKey(operationInput);
    const name = inputText(nameInput, { label: '活动名称', max: 60, required: true });
    if (/[\r\n]/.test(name)) throw error(422, '活动名称请写在一行内。');

    return writeFiles(async (head) => {
      const content = parseContent(await readFile(CONTENT_PATH, head));
      if (content.activities.some((activity) => activity.trim() === name)) return [];
      content.activities.push(name);
      const source = `${CONTENT_ASSIGNMENT} = ${JSON.stringify(content, null, 2)};\n`;
      return [gitBlob(CONTENT_PATH, { content: source })];
    }, `Add activity from album admin\n\nOperation: ${operationId}`);
  }

  async function addMemoryPhotos(input) {
    const { operationId: operationInput, entryId, date, title = '', story = '', location = '',
      category = '日常', photos } = inputRecord(input);
    const operationId = operationKey(operationInput);
    const isExisting = entryId !== undefined;
    let newEntry;
    if (isExisting) {
      inputText(entryId, { label: '回忆编号', max: 150, required: true });
      if (/\s|[\u0000-\u001f\u007f]/.test(entryId)) throw error(422, '回忆编号无效。');
    } else {
      if (!validDate(date)) throw error(422, '请选择 1900 年至 9999 年之间的有效日期。');
      if (!CATEGORIES.has(category)) throw error(422, '请选择有效的回忆分类。');
      newEntry = {
        id: `published-${operationId}`,
        date,
        title: inputText(title, { label: '回忆标题', max: 100 }),
        story: inputText(story, { label: '回忆内容', max: 10000, trim: false }),
        location: inputText(location, { label: '地点', max: 150 }),
        category,
        favorite: false,
        photos: [],
      };
    }
    if (!Array.isArray(photos) || photos.length !== 1) {
      throw error(422, '每次可上传一张照片。');
    }

    const { photo, content } = await preparePhoto(photos[0], operationId);
    let blobSha;
    return writeFiles(async (head) => {
      const album = parseAlbum(await readFile(ALBUM_PATH, head));
      const existing = album.entries.find((entry) => entry.id === (isExisting ? entryId : newEntry.id));
      if (isExisting && !existing) throw error(404, '找不到这条回忆，请刷新后重试。');
      if (!isExisting && existing) return [];
      if (!existing && album.entries.length >= MAX_ENTRIES) throw error(422, '回忆数量已达上限。');

      const entry = existing || { ...newEntry, photos: [] };
      if (entry.photos.some((item) => item.id === photo.id || item.file === photo.file)) return [];
      if (entry.photos.length >= MAX_PHOTOS_PER_ENTRY) {
        throw error(422, `每条回忆最多保存 ${MAX_PHOTOS_PER_ENTRY} 张照片。`);
      }

      const files = [];
      const fileAlreadyPublished = album.entries.some((memory) => memory.photos.some((item) => item.file === photo.file));
      if (!fileAlreadyPublished) {
        if (!blobSha) {
          const blob = await request('/git/blobs', { method: 'POST', body: { encoding: 'base64', content } });
          blobSha = gitSha(blob?.sha);
        }
        files.push(gitBlob(photo.file, { sha: blobSha }));
      }
      entry.photos.push(photo);
      const previousTimestamp = Math.max(album.updatedAt, entry.updatedAt ?? 0);
      const now = Math.max(Date.now(), previousTimestamp + 1);
      entry.updatedAt = now;
      if (!existing) album.entries.push(entry);
      album.revision = `published-${operationId}`;
      album.updatedAt = now;
      files.push(gitBlob(ALBUM_PATH, { content: `${JSON.stringify(album, null, 2)}\n` }));
      return files;
    }, `Add memory photos from album admin\n\nOperation: ${operationId}`);
  }

  return { getContent, addActivity, addMemoryPhotos };
}

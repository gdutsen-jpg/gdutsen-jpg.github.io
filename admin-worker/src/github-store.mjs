const ALBUM_PATH = 'data/album.json';
const CONTENT_PATH = 'data/site-content.js';
const CONTENT_ASSIGNMENT = 'globalThis.GomokuPublishedContent';
const MAX_ENTRIES = 5000;
const MAX_PHOTO_BYTES = 1024 * 1024;
const CATEGORIES = new Set(['日常', '约会', '旅行', '纪念日', '心动']);
const SHA = /^[a-f0-9]{40}$/;
const PHOTO_PATH = /^assets\/photos\/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$/;
const REGION_FORMATS = { world: /^[A-Z]{3}$/, china: /^CN-[A-Z]{2}$/ };
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

function identifier(value, label) {
  const id = inputText(value, { label, max: 150, trim: false, required: true });
  if (/\s|[\u0000-\u001f\u007f]/.test(id)) throw error(422, `${label}无效。`);
  return id;
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
        Array.isArray(entry.photos) && entry.photos.every((photo) => record(photo) && typeof photo.id === 'string' &&
          typeof photo.name === 'string' && typeof photo.file === 'string' && PHOTO_PATH.test(photo.file)))) {
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

function siteContentChange(content) {
  const source = `${CONTENT_ASSIGNMENT} = ${JSON.stringify(content, null, 2)};\n`;
  return gitBlob(CONTENT_PATH, { content: source });
}

function visitedList(visited, map) {
  return Array.isArray(visited?.[map]) ? visited[map] : [];
}

function regionSet(ids) {
  if (ids instanceof Set) return ids;
  return Array.isArray(ids) ? new Set(ids) : null;
}

function explicitCoverId(entry) {
  return entry.photos.find((photo) => photo.id === entry.coverPhotoId)?.id ?? null;
}

function albumChange(album, entry, operationId) {
  const timestamp = Math.max(Date.now(), Math.max(album.updatedAt, entry.updatedAt ?? 0) + 1);
  entry.updatedAt = timestamp;
  album.revision = `published-${operationId}`;
  album.updatedAt = timestamp;
  return gitBlob(ALBUM_PATH, { content: `${JSON.stringify(album, null, 2)}\n` });
}

export function createGitHubStore({ token, repository, branch = 'main', fetcher = fetch, regionIds }) {
  if (typeof token !== 'string' || !token || typeof repository !== 'string' ||
      !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) || typeof branch !== 'string' || !branch ||
      branch.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw error(503, 'GitHub 同步尚未配置。');
  }
  const repoUrl = `https://api.github.com/repos/${repository}`;
  const branchPath = `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
  const regions = { world: regionSet(regionIds?.world), china: regionSet(regionIds?.china) };

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
    const { activities, visited: configuredVisits } = parseContent(contentSource);
    const filterVisits = (map) => [...new Set(visitedList(configuredVisits, map))].filter((id) =>
      typeof id === 'string' && REGION_FORMATS[map].test(id) && (!regions[map] || regions[map].has(id)));
    const visited = { world: filterVisits('world'), china: filterVisits('china') };
    const { entries } = parseAlbum(albumSource);
    const rawRoot = `https://raw.githubusercontent.com/${repository.split('/').map(encodeURIComponent).join('/')}/${head}`;
    const memories = entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      date: entry.date,
      photoCount: entry.photos.length,
      coverPhotoId: explicitCoverId(entry),
      photos: entry.photos.map(({ id, name, file }) => ({
        id,
        name,
        url: `${rawRoot}/${file.split('/').map(encodeURIComponent).join('/')}`,
      })),
    }));
    memories.sort((left, right) => right.date.localeCompare(left.date));
    return { activities, memories, visited };
  }

  async function changeActivity(input, action) {
    const { operationId: operationInput, name: nameInput } = inputRecord(input);
    const operationId = operationKey(operationInput);
    const name = inputText(nameInput, { label: '活动名称', max: 60, required: true });
    if (/[\r\n]/.test(name)) throw error(422, '活动名称请写在一行内。');

    const remove = action === 'Remove';
    return writeFiles(async (head) => {
      const content = parseContent(await readFile(CONTENT_PATH, head));
      const otherActivities = content.activities.filter((activity) => activity.trim() !== name);
      const exists = otherActivities.length !== content.activities.length;
      if ((remove && !exists) || (!remove && exists)) return [];
      content.activities = remove ? otherActivities : [...content.activities, name];
      return [siteContentChange(content)];
    }, `${action} activity from album admin\n\nOperation: ${operationId}`);
  }

  function addActivity(input) {
    return changeActivity(input, 'Add');
  }

  function removeActivity(input) {
    return changeActivity(input, 'Remove');
  }

  async function updateVisited(input) {
    const { operationId: operationInput, changes } = inputRecord(input);
    const operationId = operationKey(operationInput);
    if (!regions.world?.size || !regions.china?.size) throw error(503, '地图地区数据尚未配置。');
    if (!Array.isArray(changes) || changes.length > regions.world.size + regions.china.size) {
      throw error(422, '请提交有效的地图修改。');
    }
    const requested = { world: new Map(), china: new Map() };
    for (const rawChange of changes) {
      const { map, id, visited } = inputRecord(rawChange);
      if ((map !== 'world' && map !== 'china') || typeof id !== 'string' || !REGION_FORMATS[map].test(id) ||
          !regions[map].has(id) || typeof visited !== 'boolean') {
        throw error(422, '地图或地区编号无效。');
      }
      const edits = requested[map];
      if (edits.has(id) && edits.get(id) !== visited) throw error(422, '同一个地区存在互相冲突的修改。');
      edits.set(id, visited);
    }

    return writeFiles(async (head) => {
      const content = parseContent(await readFile(CONTENT_PATH, head));
      const previous = record(content.visited) ? content.visited : {};
      const next = { world: [], china: [], ...previous };
      let changed = false;
      for (const [map, edits] of Object.entries(requested)) {
        const ids = new Set(visitedList(previous, map));
        let mapChanged = false;
        for (const [id, visited] of edits) {
          if (visited === ids.has(id)) continue;
          if (visited) ids.add(id);
          else ids.delete(id);
          mapChanged = true;
        }
        if (mapChanged) {
          next[map] = [...ids];
          changed = true;
        }
      }
      if (!changed) return [];
      content.visited = next;
      return [siteContentChange(content)];
    }, `Update visited regions from album admin\n\nOperation: ${operationId}`);
  }

  function memoryTarget(input) {
    const { operationId: operationInput, entryId, date, title = '', story = '', location = '',
      category = '日常' } = inputRecord(input);
    const operationId = operationKey(operationInput);
    if (entryId !== undefined) {
      return { operationId, targetId: identifier(entryId, '回忆编号'), newEntry: null };
    }
    if (!validDate(date)) throw error(422, '请选择 1900 年至 9999 年之间的有效日期。');
    if (!CATEGORIES.has(category)) throw error(422, '请选择有效的回忆分类。');
    const targetId = 'published-' + operationId;
    const newEntry = {
      id: targetId,
      date,
      title: inputText(title, { label: '回忆标题', max: 100 }),
      story: inputText(story, { label: '回忆内容', max: 10000, trim: false }),
      location: inputText(location, { label: '地点', max: 150 }),
      category,
      favorite: false,
      photos: [],
    };
    return { operationId, targetId, newEntry };
  }

  async function uploadBlob(content) {
    const blob = await request('/git/blobs', { method: 'POST', body: { encoding: 'base64', content } });
    return gitSha(blob?.sha);
  }

  async function stageMemoryPhoto(input) {
    const { operationId: operationInput } = inputRecord(input);
    const operationId = operationKey(operationInput);
    const { photo, content } = await preparePhoto(input, operationId);
    return { photo, blobSha: await uploadBlob(content) };
  }

  async function addMemoryPhotoBatch(input, stagedPhotos) {
    const target = memoryTarget(input);
    const coverInput = input.coverPhotoId ?? null;
    const coverPhotoId = coverInput === null ? null : identifier(coverInput, '封面照片编号');
    if (!Array.isArray(stagedPhotos) || !stagedPhotos.length) throw error(422, '请至少选择一张照片。');
    const candidates = stagedPhotos.map((candidate) => {
      const { photo, blobSha } = inputRecord(candidate);
      const { id, name, file } = inputRecord(photo);
      identifier(id, '照片编号');
      inputText(name, { label: '照片名称', max: 255 });
      if (typeof file !== 'string' || !PHOTO_PATH.test(file) || typeof blobSha !== 'string' || !SHA.test(blobSha)) {
        throw error(422, '照片凭据无效，请重新上传。');
      }
      return { photo: { id, name, file }, getBlobSha: () => blobSha };
    });
    return publishMemory(target, candidates, coverPhotoId);
  }

  async function addMemoryPhotos(input) {
    const target = memoryTarget(input);
    const { photos, setAsCover = false } = input;
    if (typeof setAsCover !== 'boolean') throw error(422, '封面选项无效。');
    if (!Array.isArray(photos) || photos.length !== 1) throw error(422, '每次可上传一张照片。');
    const { photo, content } = await preparePhoto(photos[0], target.operationId);
    let blobSha;
    const getBlobSha = async () => {
      if (!blobSha) blobSha = await uploadBlob(content);
      return blobSha;
    };
    return publishMemory(target, [{ photo, getBlobSha }], setAsCover ? photo.id : null);
  }

  async function publishMemory({ operationId, targetId, newEntry }, candidates, coverPhotoId) {
    const result = await writeFiles(async (head) => {
      const album = parseAlbum(await readFile(ALBUM_PATH, head));
      const existing = album.entries.find((entry) => entry.id === targetId);
      if (!newEntry && !existing) throw error(404, '找不到这条回忆，请刷新后重试。');
      if (existing && (newEntry || album.revision === 'published-' + operationId)) return [];
      if (newEntry && album.entries.length >= MAX_ENTRIES) throw error(422, '回忆数量已达上限。');

      const entry = existing || { ...newEntry, photos: [] };
      const beforeCount = entry.photos.length;
      const previousCover = explicitCoverId(entry);
      const byId = new Map(entry.photos.map((photo) => [photo.id, photo]));
      const byFile = new Map(entry.photos.map((photo) => [photo.file, photo]));
      const filesAlreadyPublished = new Set();
      for (const memory of album.entries) {
        for (const photo of memory.photos) filesAlreadyPublished.add(photo.file);
      }

      let selectedId = byId.get(coverPhotoId)?.id ?? null;
      const files = [];
      for (const { photo, getBlobSha } of candidates) {
        const matchingId = byId.get(photo.id);
        if (matchingId && matchingId.file !== photo.file) throw error(409, '发现重复的照片编号，请重新上传。');
        const storedPhoto = matchingId || byFile.get(photo.file);
        if (photo.id === coverPhotoId) selectedId = storedPhoto?.id ?? photo.id;
        if (storedPhoto) {
          byId.set(photo.id, storedPhoto);
          continue;
        }

        if (!filesAlreadyPublished.has(photo.file)) {
          files.push(gitBlob(photo.file, { sha: await getBlobSha() }));
          filesAlreadyPublished.add(photo.file);
        }
        entry.photos.push(photo);
        byId.set(photo.id, photo);
        byFile.set(photo.file, photo);
      }

      if (coverPhotoId && !selectedId) throw error(422, '封面必须是这条回忆中的照片。');
      if (entry.photos.length === beforeCount && (!selectedId || selectedId === previousCover)) return [];
      if (selectedId) entry.coverPhotoId = selectedId;
      if (!existing) album.entries.push(entry);
      files.push(albumChange(album, entry, operationId));
      return files;
    }, 'Add memory photos from album admin\n\nOperation: ' + operationId);
    return { ...result, entryId: targetId };
  }

  async function setMemoryCover(input) {
    const { operationId: operationInput, entryId: entryInput, photoId: photoInput } = inputRecord(input);
    const operationId = operationKey(operationInput);
    const entryId = identifier(entryInput, '回忆编号');
    const photoId = identifier(photoInput, '照片编号');
    return writeFiles(async (head) => {
      const album = parseAlbum(await readFile(ALBUM_PATH, head));
      const entry = album.entries.find((item) => item.id === entryId);
      if (!entry) throw error(404, '找不到这条回忆，请刷新后重试。');
      if (!entry.photos.some((photo) => photo.id === photoId)) throw error(404, '这条回忆中找不到这张照片。');
      if (explicitCoverId(entry) === photoId) return [];
      entry.coverPhotoId = photoId;
      return [albumChange(album, entry, operationId)];
    }, `Change memory cover from album admin\n\nOperation: ${operationId}`);
  }

  return { getContent, addActivity, removeActivity, updateVisited, stageMemoryPhoto, addMemoryPhotoBatch, addMemoryPhotos, setMemoryCover };
}

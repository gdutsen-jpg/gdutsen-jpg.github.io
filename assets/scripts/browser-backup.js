(() => {
  'use strict';

  const messagePrefix = 'gomoku-message-board-v1:';

  function parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function readLocalAlbum(albumId) {
    return new Promise(resolve => {
      let request;
      try {
        request = indexedDB.open('our-days-local-albums');
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = request.onblocked = () => resolve(null);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('albums')) {
          database.close();
          resolve(null);
          return;
        }
        try {
          const read = database.transaction('albums', 'readonly').objectStore('albums').get(albumId);
          read.onsuccess = () => {
            database.close();
            try {
              resolve(read.result ? globalThis.AlbumCore.validateAlbum(read.result) : null);
            } catch {
              resolve(null);
            }
          };
          read.onerror = () => {
            database.close();
            resolve(null);
          };
        } catch {
          database.close();
          resolve(null);
        }
      };
    });
  }

  function readExtras() {
    const messages = [];
    const visited = { world: [], china: [] };
    let activities = null;
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(messagePrefix)) continue;
        const entry = parseJSON(localStorage.getItem(key));
        if (typeof entry?.text === 'string' && typeof entry.name === 'string' &&
            typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)) {
          messages.push({
            id: key.slice(messagePrefix.length),
            name: entry.name,
            text: entry.text,
            createdAt: entry.createdAt,
          });
        }
      }
      for (const map of ['world', 'china']) {
        const ids = parseJSON(localStorage.getItem('gomoku-travel-map-' + map + '-v1'));
        if (Array.isArray(ids)) visited[map] = ids.filter(id => typeof id === 'string');
      }
      const saved = localStorage.getItem('gomoku-weekend-wheel-activities-v1');
      if (saved !== null) activities = saved.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    } catch {
      // Some browser modes block local storage. The album backup can still be recovered independently.
    }
    return { messages, visited, activities };
  }

  globalThis.readGomokuBrowserArchive = async function (albumId) {
    const album = await readLocalAlbum(albumId);
    const { messages, visited, activities } = readExtras();
    if (!album && !messages.length && !visited.world.length && !visited.china.length && activities === null) {
      return null;
    }
    return {
      format: 'gomoku-browser-archive',
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      album,
      messages,
      visited,
      activities,
    };
  };
})();

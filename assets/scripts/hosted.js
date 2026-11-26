(() => {
  'use strict';

  const photoFile = /^assets\/photos\/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$/;
  const scriptFiles = [
    'assets/scripts/core.js',
    'assets/scripts/app.js',
    'assets/scripts/daylight-theme.js',
    'data/site-content.js',
    'assets/scripts/browser-backup.js',
    'assets/scripts/weekend-wheel.js',
    'assets/maps/travel-map-data.js',
    'assets/scripts/travel-maps.js',
  ];
  const styleFile = 'assets/styles/site.css';
  const fontFile = 'assets/fonts/gomoku-pixel.woff2';
  const licenseFile = 'assets/fonts/OFL.txt';
  const pageTemplate = document.documentElement.outerHTML;
  const wrap = document.querySelector('.wrap');
  wrap.inert = true;

  async function readFile(file) {
    const url = new URL(file, document.baseURI);
    const response = await fetch(url, { mode: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error(`Could not read ${file} (${response.status}).`);
    return response;
  }

  async function readText(file) {
    return (await readFile(file)).text();
  }

  async function readDataUrl(file, mime) {
    const blob = await (await readFile(file)).blob();
    if (!blob.size) throw new Error(`${file} is empty.`);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob.slice(0, blob.size, mime));
    });
  }

  async function loadAlbum() {
    const source = await (await readFile('data/album.json')).json();
    if (!Array.isArray(source?.entries)) throw new Error('The archive has no record list.');
    const files = new Map();

    async function loadPhoto(photo) {
      const file = photo?.file;
      const match = typeof file === 'string' && photoFile.exec(file);
      if (!match) throw new Error('An archive photo has an invalid path.');
      if (!files.has(file)) {
        const mime = match[1] === 'jpg' ? 'image/jpeg' : `image/${match[1]}`;
        files.set(file, readDataUrl(file, mime));
      }
      return { id: photo.id, name: photo.name, dataUrl: await files.get(file) };
    }

    const entries = [];
    for (const entry of source.entries) {
      if (!Array.isArray(entry?.photos)) throw new Error('An archive record has no photo list.');
      const photos = await Promise.all(entry.photos.map(loadPhoto));
      entries.push({ ...entry, photos });
    }
    return globalThis.AlbumCore.validateAlbum({ ...source, entries });
  }

  globalThis.buildAlbumStandaloneDocument = async function () {
    const copy = new DOMParser().parseFromString(pageTemplate, 'text/html');
    const cover = copy.getElementById('first-meeting-cover').content.querySelector('img');
    const images = [...copy.querySelectorAll('img[src]'), cover];
    const icon = copy.querySelector('link[rel="icon"]');
    const iconImage = icon && images.find(image => image.getAttribute('src') === icon.getAttribute('href'));
    const [css, font, license, scripts] = await Promise.all([
      readText(styleFile),
      readDataUrl(fontFile, 'font/woff2'),
      readText(licenseFile),
      Promise.all(scriptFiles.map(readText)),
      Promise.all(images.map(async image => {
        const file = image.getAttribute('src');
        if (!file?.startsWith('assets/art/') || !file.endsWith('.png')) {
          throw new Error('An album illustration has an unexpected path.');
        }
        image.setAttribute('src', await readDataUrl(file, 'image/png'));
      })),
    ]);

    if (!css.includes('../fonts/gomoku-pixel.woff2') || /<\/style/i.test(css)) {
      throw new Error('The album stylesheet could not be copied.');
    }
    if (iconImage) icon.setAttribute('href', iconImage.getAttribute('src'));
    const style = copy.createElement('style');
    style.textContent = css.replaceAll('../fonts/gomoku-pixel.woff2', font);
    copy.querySelector(`link[rel="stylesheet"][href="${styleFile}"]`).replaceWith(style);
    copy.getElementById('embedded-font-license').content.querySelector('pre').textContent = license;

    copy.querySelectorAll('script[src]').forEach(script => script.remove());
    for (const source of scripts) {
      if (/<\/script/i.test(source)) throw new Error('An album script could not be copied.');
      const script = copy.createElement('script');
      script.textContent = source;
      copy.body.append(script);
    }
    copy.querySelector('.wrap').removeAttribute('inert');
    return '<!doctype html>\n' + copy.documentElement.outerHTML;
  };

  function loadApp() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptFiles[1];
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the album script.'));
      document.body.append(script);
    });
  }

  async function start() {
    const album = await loadAlbum();
    const embedded = document.getElementById('embedded-state');
    embedded.textContent = JSON.stringify(album).replace(/</g, '\\u003c');
    await loadApp();
  }

  start().catch(error => {
    const notice = document.getElementById('storage-notice');
    notice.textContent = `This album could not be loaded. ${error.message} Refresh the page to try again.`;
    notice.hidden = false;
    wrap.before(notice);
  });
})();

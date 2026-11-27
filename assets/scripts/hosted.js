(() => {
  'use strict';

  const photoFile = /^assets\/photos\/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$/;
  const scriptFiles = [
    'assets/scripts/core.js?v=20261127-cover',
    'assets/scripts/app.js?v=20261127-cover',
    'assets/scripts/daylight-theme.js?v=20261127-daylight-progress',
    'data/site-content.js?v=20261127-meat-types',
    'assets/scripts/browser-backup.js',
    'assets/scripts/weekend-wheel.js?v=20261127-two-wheels',
    'assets/maps/travel-map-data.js',
    'assets/scripts/travel-maps.js',
  ];
  const styleFiles = [
    'assets/styles/site.css?v=20261127-small-easel',
    'assets/styles/wheels.css?v=20261127-two-wheels',
    'assets/styles/daylight-bar.css?v=20261127-daylight-progress',
  ];
  const fonts = [
    { file: 'gomoku-pixel.woff2', license: 'OFL.txt' },
    { file: 'dm-sans-latin-400.woff2', license: 'dm-sans-OFL.txt' },
  ];
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

  globalThis.loadAlbumEmbeddedPhotos = async function (album) {
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
    for (const entry of album.entries) {
      const photos = await Promise.all(entry.photos.map(loadPhoto));
      entries.push({ ...entry, photos });
    }
    return globalThis.AlbumCore.validateAlbum({ ...album, entries });
  };

  globalThis.buildAlbumStandaloneDocument = async function () {
    const copy = new DOMParser().parseFromString(pageTemplate, 'text/html');
    const cover = copy.getElementById('first-meeting-cover').content.querySelector('img');
    const images = [...copy.querySelectorAll('img[src]'), cover];
    const icon = copy.querySelector('link[rel="icon"]');
    const iconImage = icon && images.find(image => image.getAttribute('src') === icon.getAttribute('href'));
    const [stylesheets, fontUrls, licenses, scripts] = await Promise.all([
      Promise.all(styleFiles.map(readText)),
      Promise.all(fonts.map(({ file }) => readDataUrl('assets/fonts/' + file, 'font/woff2'))),
      Promise.all(fonts.map(({ license }) => readText('assets/fonts/' + license))),
      Promise.all(scriptFiles.map(readText)),
      Promise.all(images.map(async image => {
        const file = image.getAttribute('src');
        if (!file?.startsWith('assets/art/') || !file.endsWith('.png')) {
          throw new Error('An album illustration has an unexpected path.');
        }
        image.setAttribute('src', await readDataUrl(file, 'image/png'));
      })),
    ]);

    if (iconImage) icon.setAttribute('href', iconImage.getAttribute('src'));
    const [siteStyle] = stylesheets;
    if (fonts.some(({ file }) => !siteStyle.includes('../fonts/' + file))) {
      throw new Error('The album fonts could not be copied.');
    }
    for (const [index, file] of styleFiles.entries()) {
      const css = stylesheets[index];
      const link = copy.querySelector('link[rel="stylesheet"][href="' + file + '"]');
      if (!link || /<\/style/i.test(css)) throw new Error('The album stylesheet could not be copied.');
      const style = copy.createElement('style');
      style.textContent = fonts.reduce((contents, { file: font }, fontIndex) => (
        contents.replaceAll('../fonts/' + font, fontUrls[fontIndex])
      ), css);
      link.replaceWith(style);
    }
    copy.getElementById('embedded-font-license').content.querySelector('pre').textContent = licenses.join('\n\n');

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
    const source = await (await readFile('data/album.json')).json();
    const album = globalThis.AlbumCore.validateAlbum(source, { photoFiles: true });
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

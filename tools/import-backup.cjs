'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { validateAlbum } = require('../assets/scripts/core.js');

const repoRoot = path.resolve(__dirname, '..');
const publishedAlbumId = 'gomoku-github-pages-shared';

function writeAtomically(destination, contents) {
  const temporary = destination + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, contents, { flag: 'wx' });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function archivePhoto({ id, name, dataUrl }) {
  const [header, payload] = dataUrl.split(',');
  const extension = header.slice('data:image/'.length, -';base64'.length).replace('jpeg', 'jpg');
  const bytes = Buffer.from(payload, 'base64');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const file = 'assets/photos/' + digest + '.' + extension;

  writeAtomically(path.join(repoRoot, file), bytes);
  return { id, name, file };
}

function importBackup(filename) {
  const input = JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (input?.format === 'our-days-backup' && input.version !== 1) {
    throw new Error('Unsupported full backup version.');
  }
  const album = validateAlbum(input?.format === 'our-days-backup' ? input.album : input);

  mkdirSync(path.join(repoRoot, 'assets', 'photos'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'data'), { recursive: true });

  const entries = album.entries.map(entry => ({
    ...entry,
    photos: entry.photos.map(archivePhoto),
  }));
  const snapshot = { ...album, albumId: publishedAlbumId, entries };
  writeAtomically(path.join(repoRoot, 'data', 'album.json'), JSON.stringify(snapshot, null, 2) + '\n');
  return { entries: entries.length, photos: entries.reduce((count, entry) => count + entry.photos.length, 0) };
}

try {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node tools/import-backup.cjs /path/to/full-backup.json');
  }
  const { entries, photos } = importBackup(process.argv[2]);
  console.log('Prepared ' + entries + ' memories and ' + photos + ' photos for publication.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

(function (root) {
  'use strict';

  const CATEGORIES = new Set(['日常', '约会', '旅行', '纪念日', '心动']);
  const DAY_MS = 86400000;
  const MAX_ENTRIES = 5000;
  const MAX_PHOTO_CHARS = 36 * 1024 * 1024;
  const MAX_TOTAL_PHOTO_CHARS = 400 * 1024 * 1024;

  function today() {
    const now = new Date();
    return String(now.getFullYear()).padStart(4, '0') + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  function leapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
    const monthDays = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= monthDays[month - 1];
  }

  function dayNumber(date) {
    if (!validDate(date)) throw new RangeError('Enter a valid date between the years 1900 and 9999.');
    return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
  }

  function daysBetween(start, end) {
    return dayNumber(end) - dayNumber(start);
  }

  function anniversary(startDate, todayString) {
    if (!validDate(startDate) || !validDate(todayString)) {
      throw new RangeError('Anniversaries require valid dates.');
    }
    const startYear = Number(startDate.slice(0, 4));
    const currentYear = Number(todayString.slice(0, 4));
    const month = Number(startDate.slice(5, 7));
    const day = Number(startDate.slice(8, 10));
    function inYear(year) {
      if (year > 9999) throw new RangeError('The next anniversary is outside the supported year range.');
      const actualDay = month === 2 && day === 29 && !leapYear(year) ? 28 : day;
      return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(actualDay).padStart(2, '0');
    }
    let year = Math.max(startYear, currentYear);
    let nextDate = inYear(year);
    if (nextDate < todayString) nextDate = inYear(++year);
    return { days: daysBetween(todayString, nextDate), years: year - startYear, date: nextDate };
  }

  function invalid(message) {
    throw new TypeError('Invalid backup: ' + message);
  }

  function object(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(label + ' must be an object.');
    return value;
  }

  function string(value, limit, label, required, trim) {
    if (typeof value !== 'string' || value.length > limit) invalid(label + ' must be text of no more than ' + limit + ' characters.');
    const result = trim ? value.trim() : value;
    if (required && !result.trim()) invalid(label + ' cannot be empty.');
    if (/\u0000/.test(result)) invalid(label + ' contains an unsupported character.');
    return result;
  }

  function identifier(value, label) {
    const result = string(value, 150, label, true, false);
    if (/\s|[\u0000-\u001f\u007f]/.test(result)) invalid(label + ' contains whitespace or control characters.');
    return result;
  }

  function timestamp(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) invalid(label + ' must be a valid timestamp.');
    return value;
  }

  function validateAlbum(input) {
    const album = object(input, 'Album');
    if (album.schemaVersion !== 1) invalid('This backup version is not supported.');
    const albumId = identifier(album.albumId, 'Album ID');
    const updatedAt = timestamp(album.updatedAt, 'Album update time');
    const revision = album.revision === undefined ? 'legacy-' + updatedAt : identifier(album.revision, 'Revision ID');
    const sourceSettings = object(album.settings, 'Album settings');
    const settings = {
      nameOne: string(sourceSettings.nameOne, 20, 'Your nickname', false, true),
      nameTwo: string(sourceSettings.nameTwo, 20, 'Your partner\'s nickname', false, true),
      contactDate: string(sourceSettings.contactDate === undefined ? '' : sourceSettings.contactDate, 10, 'Contact date', false, false),
      firstMetDate: string(sourceSettings.firstMetDate === undefined ? '' : sourceSettings.firstMetDate, 10, 'First meeting date', false, false),
      startDate: string(sourceSettings.startDate, 10, 'Relationship start date', false, false),
      message: string(sourceSettings.message, 200, 'Welcome message', false, false)
    };
    if (settings.contactDate !== '' && !validDate(settings.contactDate)) invalid('The contact date is invalid or outside the supported range.');
    if (settings.firstMetDate !== '' && !validDate(settings.firstMetDate)) invalid('The first meeting date is invalid or outside the supported range.');
    if (settings.startDate !== '' && !validDate(settings.startDate)) invalid('The relationship start date is invalid or outside the supported range.');
    if (!Array.isArray(album.entries) || album.entries.length > MAX_ENTRIES) invalid('Records must be an array with no more than ' + MAX_ENTRIES + ' entries.');
    const entryIds = new Set();
    let totalPhotoChars = 0;
    const entries = album.entries.map(function (rawEntry, index) {
      const label = 'Entry ' + (index + 1);
      const entry = object(rawEntry, label);
      const id = identifier(entry.id, label + ' ID');
      if (entryIds.has(id)) invalid('Duplicate entry IDs were found.');
      entryIds.add(id);
      if (!validDate(entry.date)) invalid(label + ' has an invalid date or a date outside the supported range.');
      if (!CATEGORIES.has(entry.category)) invalid(label + ' has an unsupported category.');
      if (typeof entry.favorite !== 'boolean') invalid(label + ' must have a true or false favorite flag.');
      if (!Array.isArray(entry.photos) || entry.photos.length > 40) invalid(label + ' must have an array of no more than 40 photos.');
      const photoIds = new Set();
      const photos = entry.photos.map(function (rawPhoto, photoIndex) {
        const photoLabel = 'Photo ' + (photoIndex + 1) + ' in ' + label;
        const photo = object(rawPhoto, photoLabel);
        const photoId = identifier(photo.id, photoLabel + ' ID');
        if (photoIds.has(photoId)) invalid(label + ' contains duplicate photo IDs.');
        photoIds.add(photoId);
        if (typeof photo.dataUrl !== 'string' || photo.dataUrl.length > MAX_PHOTO_CHARS) {
          invalid(photoLabel + ' is too large or has invalid image data.');
        }
        const comma = photo.dataUrl.indexOf(',');
        if (comma < 0 || !/^data:image\/(?:jpeg|png|webp|gif|avif);base64$/.test(photo.dataUrl.slice(0, comma))) {
          invalid(photoLabel + ' must be a JPG, PNG, WebP, GIF or AVIF image embedded in the backup.');
        }
        const payload = photo.dataUrl.slice(comma + 1);
        // A flat character-class regexp avoids stack overflow on multi-megabyte photos.
        if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
          invalid(photoLabel + ' has invalid image encoding.');
        }
        totalPhotoChars += photo.dataUrl.length;
        if (totalPhotoChars > MAX_TOTAL_PHOTO_CHARS) invalid('Total photo data exceeds 400 MB. Please keep your photos in smaller albums.');
        return { id: photoId, name: string(photo.name, 255, photoLabel + ' name', false, false), dataUrl: photo.dataUrl };
      });
      return {
        id: id,
        date: entry.date,
        title: string(entry.title, 100, label + ' title', false, true),
        story: string(entry.story, 10000, label + ' story', false, false),
        location: string(entry.location, 150, label + ' location', false, true),
        category: entry.category,
        favorite: entry.favorite,
        photos: photos,
        updatedAt: timestamp(entry.updatedAt, label + ' update time')
      };
    });
    return { schemaVersion: 1, albumId: albumId, revision: revision, settings: settings, entries: entries, updatedAt: updatedAt };
  }

  function mergeEntries(current, incoming) {
    if (!Array.isArray(current) || !Array.isArray(incoming)) throw new TypeError('Records to merge must be arrays.');
    const merged = new Map();
    for (const entry of current.concat(incoming)) {
      const previous = merged.get(entry.id);
      if (!previous || entry.updatedAt > previous.updatedAt) merged.set(entry.id, entry);
    }
    // An exact tie keeps the current version. Neither input array is changed.
    return Array.from(merged.values());
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  let fallbackCounter = 0;
  function newId() {
    const cryptoApi = root.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    // This identifier is only a local record key, never a password or access token.
    fallbackCounter += 1;
    return 'local-' + Date.now().toString(36) + '-' + fallbackCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  const api = Object.freeze({ today: today, validDate: validDate, dayNumber: dayNumber, daysBetween: daysBetween,
    anniversary: anniversary, validateAlbum: validateAlbum, mergeEntries: mergeEntries, escapeHTML: escapeHTML, newId: newId });
  root.AlbumCore = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(globalThis);

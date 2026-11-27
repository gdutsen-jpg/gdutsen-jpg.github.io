(() => {
'use strict';
const C = globalThis.AlbumCore;
const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const h = C.escapeHTML;
const originalHTML = '<!doctype html>\n' + document.documentElement.outerHTML;
const loadEmbeddedPhotos = globalThis.loadAlbumEmbeddedPhotos;
const state = C.validateAlbum(JSON.parse($('embedded-state').textContent), { photoFiles: Boolean(loadEmbeddedPhotos) });
const heroEyebrow = $('couple-eyebrow');
const defaultHeroEyebrow = heroEyebrow.textContent;
const heroDescription = $('hero-description');
const defaultHeroDescription = heroDescription.textContent;
const firstMeetingCover = $('first-meeting-cover')?.content.querySelector('img')?.getAttribute('src');
document.querySelector('.wrap').inert = true;
let view = 'wall', filter = '全部', query = '', direction = 'desc';
let lightboxPhotos = [], lightboxIndex = 0, toastTimer;
// Keep the original category keys so existing records and backups stay compatible.
const categoryLabels = Object.freeze({
  '全部': 'All', '日常': 'Daily', '约会': 'Dates', '旅行': 'Trips',
  '纪念日': 'Anniversaries', '心动': 'Little Sparks', '收藏': 'Favorites'
});
const categoryLanguageKey = 'our-days-category-language';
let categoryLanguage = 'en';
try {
  if (localStorage.getItem(categoryLanguageKey) === 'zh') categoryLanguage = 'zh';
} catch { /* This preference also works without browser storage. */ }
const categoryLabel = key => categoryLanguage === 'zh' ? key : (categoryLabels[key] || key);
const countLabel = (count, singular, plural = singular + 's') => `${count} ${count === 1 ? singular : plural}`;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8500 : 4500);
}
function showDialog(id) { if (!$(id).open) $(id).showModal(); }
function setStorageNotice(message) { $('storage-notice').textContent = message; $('storage-notice').hidden = !message; }
const calendarFormatter = new Intl.DateTimeFormat('en', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const weekdayFormatter = new Intl.DateTimeFormat('en', {weekday:'short',timeZone:'UTC'});
function readableDate(date) { const value=new Date(date+'T12:00:00Z');return `${calendarFormatter.format(value)} · ${weekdayFormatter.format(value)}`; }
function memoryTitle(entry) { return entry.title || 'A little memory'; }
function photoSource(photo) { return photo.file ?? photo.dataUrl; }
function coverIndex(entry) {
  const index = entry.photos.findIndex(photo => photo.id === entry.coverPhotoId);
  return index < 0 ? 0 : index;
}
function timelinePhotoIndexes(entry) {
  if (!entry.photos.length) return [];
  const cover = coverIndex(entry);
  const firstIndexes = entry.photos.slice(0,6).map((_,index) => index);
  return [cover, ...firstIndexes.filter(index => index !== cover)].slice(0,6);
}
function closeDialog(id) {
  const dialog = $(id);
  if (!dialog?.open) return;
  dialog.close();
  if (id === 'lightbox') {
    $('lightbox-image').removeAttribute('src');
    lightboxPhotos = [];
  }
}
function renderCategoryControls() {
  const isChinese = categoryLanguage === 'zh';
  $('category-language-toggle').setAttribute('aria-pressed', String(isChinese));
  document.querySelectorAll('[data-filter]').forEach(button => {
    const key = button.dataset.filter;
    button.textContent = (key === '收藏' ? '♡ ' : '') + categoryLabel(key);
    button.lang = isChinese ? 'zh-Hans' : 'en';
    button.classList.toggle('active', key === filter);
    button.setAttribute('aria-pressed', String(key === filter));
  });
}
$('category-language-toggle').addEventListener('click', () => {
  categoryLanguage = categoryLanguage === 'en' ? 'zh' : 'en';
  try {
    localStorage.setItem(categoryLanguageKey, categoryLanguage);
  } catch { /* Keep the selection in memory when storage is unavailable. */ }
  renderCategoryControls();
  renderRecords();
});
function render() {
  const s = state.settings;
  const hasCustomNames = (s.nameOne || s.nameTwo) && !(s.nameOne === '森' && s.nameTwo === '芷');
  heroEyebrow.textContent = hasCustomNames ? `${s.nameOne || 'You'}  &  ${s.nameTwo || 'Your person'}` : defaultHeroEyebrow;
  if (hasCustomNames) heroEyebrow.removeAttribute('lang');
  else heroEyebrow.lang = 'zh-Hans';
  heroDescription.textContent = s.message || defaultHeroDescription;
  heroDescription.classList.toggle('hero-flower-names', !s.message);
  if (s.message) heroDescription.removeAttribute('lang');
  else heroDescription.lang = 'zh-Hans';
  const totalPhotos = state.entries.reduce((n,e)=>n+e.photos.length,0);
  $('memory-count').innerHTML = `${state.entries.length}<small>${state.entries.length===1?'memory':'memories'}</small>`;
  $('photo-count').innerHTML = `${totalPhotos}<small>${totalPhotos===1?'photo':'photos'}</small>`;
  if (s.startDate) {
    const days = C.daysBetween(s.startDate,C.today());
    const dayCount=days >= 0 ? days + 1 : -days;
    $('days-value').innerHTML = `${dayCount}<small>${dayCount===1?'day':'days'}</small>`;
    $('days-label').textContent = days >= 0 ? `Together since ${readableDate(s.startDate)}` : `Until Together · ${readableDate(s.startDate)}`;
  } else {
    $('days-value').innerHTML = '—<small>days</small>';
    $('days-label').textContent = 'Together · Not set yet';
  }
  $('first-met-value').textContent = s.firstMetDate ? readableDate(s.firstMetDate) : 'Not set yet';
  $('contact-value').textContent = s.contactDate ? readableDate(s.contactDate) : 'Not set yet';
  $('anniversary-summary').hidden = !s.startDate;
  if (s.startDate) {
    const days = C.daysBetween(s.startDate,C.today());
    if (days >= 0) {
      const next = C.anniversary(s.startDate,C.today());
      $('anniversary-value').textContent = next.days === 0 ? (next.years === 0 ? 'Together from today ♡' : `Happy anniversary · ${countLabel(next.years,'year')} ♡`) : `${countLabel(next.days,'day')} to go`;
      $('anniversary-label').textContent = next.days === 0 ? 'A little more love, every day' : `${next.years}-year anniversary · ${readableDate(next.date)}`;
    } else { $('anniversary-value').textContent = `${countLabel(-days,'day')} until Together`; $('anniversary-label').textContent = readableDate(s.startDate); }
  } else {
    $('anniversary-value').textContent = ''; $('anniversary-label').textContent = '';
  }
  $('timeline-tab').classList.toggle('active',view==='timeline'); $('timeline-tab').setAttribute('aria-selected',String(view==='timeline'));
  $('wall-tab').classList.toggle('active',view==='wall'); $('wall-tab').setAttribute('aria-selected',String(view==='wall'));
  $('records').setAttribute('aria-labelledby',view==='timeline'?'timeline-tab':'wall-tab');
  renderCategoryControls();
  renderRecords();
}
function filteredEntries() {
  const q = query.trim().toLocaleLowerCase();
  return state.entries.filter(e => (filter==='全部' || (filter==='收藏'?e.favorite:e.category===filter)) && (!q || [e.title,e.story,e.location,e.date].some(v=>v.toLocaleLowerCase().includes(q))))
    .sort((a,b)=>direction==='asc'?a.date.localeCompare(b.date)||a.updatedAt-b.updatedAt:b.date.localeCompare(a.date)||b.updatedAt-a.updatedAt);
}
function renderRecords() {
  const entries = filteredEntries();
  if (!entries.length) {
    const emptyAll = !state.entries.length;
    $('records').innerHTML = emptyAll
      ? `<div class="empty">${icon('photo')}<h3>No published memories yet.</h3></div>`
      : `<div class="empty">${icon('search')}<h3>No memories found.</h3><p>Try another word or category and take another look.</p><button class="btn primary" data-action="reset">${icon('book')}See all memories</button></div>`;
    return;
  }
  let content = `<p class="result-count">${countLabel(entries.length,'memory','memories')} to keep${query||filter!=='全部'?' · Filtered results':''}</p>`;
  if (view === 'wall') {
    const memoriesWithPhotos = entries.filter(entry => entry.photos.length);
    if (!memoriesWithPhotos.length) {
      $('records').innerHTML = `<div class="empty">${icon('photo')}<h3>A story today, a photo whenever.</h3><p>View the written memories on the timeline.</p><button class="btn" data-action="timeline">Back to the timeline</button></div>`; return;
    }
    const coverEntryId = state.entries.find(entry => entry.title === '光明初遇' && entry.date === '2026-11-22')?.id;
    const cards = memoriesWithPhotos.map(entry => {
      const index = coverIndex(entry);
      const illustrated = firstMeetingCover && entry.id === coverEntryId && !entry.coverPhotoId;
      const thumbnail = illustrated ? firstMeetingCover : photoSource(entry.photos[index]);
      const title = h(memoryTitle(entry));
      const extraPhotos = entry.photos.length - 1;
      return `<article class="wall-card">
        <button class="photo-button" data-action="photo" data-id="${h(entry.id)}" data-index="${index}" aria-label="View ${title}, photo ${index + 1}">
          <img src="${h(thumbnail)}" alt="${title}" loading="lazy" decoding="async">
          ${extraPhotos ? `<span class="photo-more">+${extraPhotos}</span>` : ''}
        </button>
        <div class="wall-caption">${title}</div>
        <p class="wall-date">${readableDate(entry.date)} · ${h(categoryLabel(entry.category))}</p>
      </article>`;
    });
    content = `<div class="photo-wall">${cards.join('')}</div>`;
  } else {
    let year = '';
    for (const e of entries) {
      const currentYear = e.date.slice(0,4);
      if (currentYear !== year) { if (year) content += '</div>'; content += `<h3 class="year-heading">${currentYear}</h3><div class="timeline">`; year=currentYear; }
      const pictures = timelinePhotoIndexes(e);
      content += `<article class="memory"><div class="memory-top"><div class="memory-meta"><time datetime="${e.date}">${readableDate(e.date)}</time><span class="tag">${h(categoryLabel(e.category))}</span></div></div><h3>${h(memoryTitle(e))}</h3>${e.story?`<p class="memory-text">${h(e.story)}</p>`:''}${e.location?`<div class="memory-location">${icon('pin')}${h(e.location)}</div>`:''}${pictures.length?`<div class="memory-pictures ${pictures.length===1?'single':''}">${pictures.map((i,position)=>`<button class="photo-button" data-action="photo" data-id="${h(e.id)}" data-index="${i}" aria-label="View ${h(memoryTitle(e))}, photo ${i+1}"><img src="${h(photoSource(e.photos[i]))}" alt="${h(memoryTitle(e))}, photo ${i+1}" loading="lazy" decoding="async">${position===pictures.length-1&&e.photos.length>pictures.length?`<span class="photo-more">+${e.photos.length-pictures.length}</span>`:''}</button>`).join('')}</div>`:''}</article>`;
    }
    content += '</div>';
  }
  $('records').innerHTML = content;
}
function openPhoto(entryId,index) {
  const entries=filteredEntries();
  const selectedEntry=state.entries.find(e=>e.id===entryId);
  lightboxPhotos=view==='wall'?entries.flatMap(e=>e.photos.map(p=>({...p,entryId:e.id,title:memoryTitle(e),date:e.date}))):(selectedEntry?.photos||[]).map(p=>({...p,title:memoryTitle(selectedEntry),date:selectedEntry.date}));
  if(view==='wall') {const entry=entries.find(e=>e.id===entryId),photo=entry?.photos[index];lightboxIndex=lightboxPhotos.findIndex(p=>p.entryId===entryId&&p.id===photo?.id);}else lightboxIndex=index;
  if(!lightboxPhotos.length||lightboxIndex<0)return;
  renderLightbox();showDialog('lightbox');
}
function renderLightbox() {
  const p=lightboxPhotos[lightboxIndex];if(!p)return;
  $('lightbox-title').textContent=p.title;$('lightbox-image').src=photoSource(p);$('lightbox-image').alt=p.name||p.title;
  $('lightbox-count').textContent=`${readableDate(p.date)} · ${lightboxIndex+1} / ${lightboxPhotos.length}`;
  $('previous-photo').hidden=lightboxPhotos.length<=1;$('next-photo').hidden=lightboxPhotos.length<=1;
}
function movePhoto(by){lightboxIndex=(lightboxIndex+by+lightboxPhotos.length)%lightboxPhotos.length;renderLightbox();}
$('previous-photo').addEventListener('click',()=>movePhoto(-1));$('next-photo').addEventListener('click',()=>movePhoto(1));
document.addEventListener('keydown',event=>{if($('lightbox').open){if(event.key==='ArrowLeft'){event.preventDefault();movePhoto(-1);}if(event.key==='ArrowRight'){event.preventDefault();movePhoto(1);}}});
function safeFilename(name){return name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)||'Falling in Love with Gomoku';}
function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function filenameBase(){return safeFilename(state.settings.nameOne&&state.settings.nameTwo?`${state.settings.nameOne} and ${state.settings.nameTwo} - Our Days`:'Falling in Love with Gomoku');}
function makeBackup(album){return{format:'our-days-backup',version:1,exportedAt:new Date().toISOString(),album};}
function markExported(name){$('export-message').textContent=`Requested a download of “${name}”. Check your browser downloads to confirm it was saved, and keep the latest copy.`;$('export-message').hidden=false;toast('Your file is ready. Check your browser downloads to confirm it was saved.');}
function archiveAlbum() { return loadEmbeddedPhotos ? loadEmbeddedPhotos(state) : state; }
async function exportJSON() {
  const button = $('export-json');
  button.disabled = true;
  try {
    const album = await archiveAlbum();
    const name = `${filenameBase()}_Backup_${C.today()}.json`;
    downloadBlob(new Blob([JSON.stringify(makeBackup(album))],{type:'application/json;charset=utf-8'}),name);
    markExported(name);
  } catch (error) {
    toast(`Could not create the backup: ${error.message}`,true);
  } finally {
    button.disabled = false;
  }
}
function downloadStandalone(template, album){
  const json=JSON.stringify(album).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const html=template.replace(/(<script id="embedded-state" type="application\/json">)[\s\S]*?(<\/script>)/,(_match,start,end)=>start+json+end);
  const name=`${filenameBase()}_Keepsake_${C.today()}.html`;downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),name);markExported(name);
}
async function exportHTML() {
  const button = $('export-html');
  button.disabled = true;
  try {
    const build = globalThis.buildAlbumStandaloneDocument;
    const [template, album] = await Promise.all([build ? build(originalHTML) : originalHTML, archiveAlbum()]);
    downloadStandalone(template, album);
  } catch (error) {
    toast(`Could not create the standalone page: ${error.message}`,true);
  } finally {
    button.disabled = false;
  }
}
$('export-json').addEventListener('click',exportJSON);$('export-html').addEventListener('click',exportHTML);
$('download-photo').addEventListener('click',async () => {
  const p = lightboxPhotos[lightboxIndex];
  if (!p) return;
  const index = lightboxIndex + 1;
  try {
    if (p.file) {
      const response = await fetch(new URL(p.file, document.baseURI), { mode: 'same-origin', redirect: 'error' });
      if (!response.ok) throw new Error(`The photo returned HTTP ${response.status}.`);
      const extension = p.file.split('.').pop();
      downloadBlob(await response.blob(), `${safeFilename(p.title)}_${index}.${extension}`);
      return;
    }
    const [header,base64] = p.dataUrl.split(',');
    const bytes = Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const mime = header.match(/data:([^;]+)/)[1];
    const extension = mime.split('/')[1].replace('jpeg','jpg');
    downloadBlob(new Blob([bytes],{type:mime}),`${safeFilename(p.title)}_${index}.${extension}`);
  } catch (error) {
    toast(`Could not download the photo: ${error.message}`,true);
  }
});
function openBackup(){
  $('backup-summary').textContent=`This book holds ${countLabel(state.entries.length,'memory','memories')} and ${countLabel(state.entries.reduce((n,e)=>n+e.photos.length,0),'photo')}. Save a copy to keep them close, wherever life takes you.`;
  $('export-message').hidden=true;
  showDialog('backup-dialog');
}
const browserExportButton = $('export-browser-records');
browserExportButton.addEventListener('click', async () => {
  browserExportButton.disabled = true;
  try {
    const archive = await globalThis.readGomokuBrowserArchive(state.albumId);
    if (!archive) { toast('No browser records were found at this address.'); return; }
    const name = `${filenameBase()}_Browser_Records_${C.today()}.json`;
    downloadBlob(new Blob([JSON.stringify(archive)], { type: 'application/json;charset=utf-8' }), name);
    markExported(name);
  } catch (error) {
    toast(`Could not export browser records: ${error.message}`, true);
  } finally {
    browserExportButton.disabled = false;
  }
});
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) { closeDialog(close.dataset.close); return; }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  switch (action.dataset.action) {
    case 'photo': openPhoto(action.dataset.id, Number(action.dataset.index)); break;
    case 'reset':
      filter = '全部';
      query = '';
      $('search').value = '';
      render();
      break;
    case 'timeline': setView('timeline'); break;
  }
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog.id); });
});
$('backup-button').addEventListener('click', openBackup);
$('help-button').addEventListener('click', () => showDialog('help-dialog'));
$('browse-button').addEventListener('click',()=>$('stories').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
function setView(next){view=next;render();}
$('timeline-tab').addEventListener('click',()=>setView('timeline'));$('wall-tab').addEventListener('click',()=>setView('wall'));
[$('timeline-tab'),$('wall-tab')].forEach(tab=>tab.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setView(view==='timeline'?'wall':'timeline');$(view==='timeline'?'timeline-tab':'wall-tab').focus();}}));
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;render();}));
$('search').addEventListener('input',()=>{query=$('search').value;renderRecords();});$('sort-order').addEventListener('change',()=>{direction=$('sort-order').value;renderRecords();});

try {
  $('save-status').innerHTML = icon('book') + '<span>Published archive</span>';
  render();
} catch (error) {
  setStorageNotice(`This album could not finish loading: ${error.message} Refresh the page and try again.`);
} finally {
  document.querySelector('.wrap').inert = false;
}
})();

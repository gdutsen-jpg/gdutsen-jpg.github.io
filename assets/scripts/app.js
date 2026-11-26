(() => {
'use strict';
const C = globalThis.AlbumCore;
const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const h = C.escapeHTML;
const originalHTML = '<!doctype html>\n' + document.documentElement.outerHTML;
const seed = C.validateAlbum(JSON.parse($('embedded-state').textContent));
const heroEyebrow = $('couple-eyebrow');
const defaultHeroEyebrow = heroEyebrow.textContent;
const heroDescription = $('hero-description');
const defaultHeroDescription = heroDescription.textContent;
const firstMeetingCover = $('first-meeting-cover')?.content.querySelector('img')?.getAttribute('src');
document.querySelector('.wrap').inert = true;
let state = seed, db = null, volatile = false, hasUnexported = false, busy = false;
let view = 'wall', filter = '全部', query = '', direction = 'desc';
let editorId = null, draftPhotos = [], pendingPhotos = false, pendingImport = null, pendingDelete = null, deletedEntry = null;
let lightboxPhotos = [], lightboxIndex = 0, toastTimer, editorBaseline = '', settingsBaseline = '';
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
const requestedMilestones = Object.freeze({contactDate:'2026-11-14',firstMetDate:'2026-11-22',startDate:''});

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8500 : 4500);
}
function showDialog(id) { if (!$(id).open) $(id).showModal(); }
function setStorageNotice(message) { $('storage-notice').textContent = message; $('storage-notice').hidden = !message; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validTimestamp() { return Date.now(); }
const calendarFormatter = new Intl.DateTimeFormat('en', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const weekdayFormatter = new Intl.DateTimeFormat('en', {weekday:'short',timeZone:'UTC'});
function readableDate(date) { const value=new Date(date+'T12:00:00Z');return `${calendarFormatter.format(value)} · ${weekdayFormatter.format(value)}`; }
function memoryTitle(entry) { return entry.title || 'A little memory'; }
function editorSignature() { return JSON.stringify([$('entry-title').value,$('entry-date').value,$('entry-category').value,$('entry-story').value,$('entry-location').value,$('entry-favorite').checked,draftPhotos.map(p=>p.id)]); }
function settingsSignature() { return JSON.stringify([$('name-one').value,$('name-two').value,$('contact-date').value,$('first-met-date').value,$('start-date').value,$('couple-message').value]); }
function needsMilestoneSetup(settings) { return !Object.prototype.hasOwnProperty.call(settings,'contactDate') && !Object.prototype.hasOwnProperty.call(settings,'firstMetDate'); }
function closeDialog(id) {
  if (id === 'entry-dialog') {
    if (pendingPhotos || busy) return toast('Your photos are still being processed or saved. Please wait.');
    if (editorSignature() !== editorBaseline && !confirm('This memory has unsaved changes. Discard them?')) return;
  }
  if (id === 'settings-dialog' && (busy || (settingsSignature() !== settingsBaseline && !confirm('Your settings have unsaved changes. Discard them?')))) return;
  $(id).close();
  if (id === 'entry-dialog') { draftPhotos = []; $('photo-input').value = ''; }
  if (id === 'lightbox') { $('lightbox-image').removeAttribute('src'); lightboxPhotos = []; }
}

async function openDatabase() {
  if (!('indexedDB' in globalThis)) throw new Error('This browser does not support local storage.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('our-days-local-albums', 1);
    const timeout = setTimeout(() => reject(new Error('The browser did not respond to the local storage request.')), 7000);
    request.onupgradeneeded = () => request.result.createObjectStore('albums', {keyPath:'albumId'});
    request.onsuccess = () => { clearTimeout(timeout); resolve(request.result); };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onblocked = () => { clearTimeout(timeout); reject(new Error('Another window is using local storage.')); };
  });
}
function readAlbum() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('albums','readonly');
    const request = tx.objectStore('albums').get(seed.albumId);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not read your saved memories.'));
  });
}
function writeAlbum(next, expectedRevision) {
  return new Promise((resolve,reject) => {
    let conflict = false;
    const tx = db.transaction('albums','readwrite');
    const store = tx.objectStore('albums');
    const read = store.get(next.albumId);
    read.onsuccess = () => {
      if (expectedRevision !== null && read.result && read.result.revision !== expectedRevision) {
        conflict = true; tx.abort(); return;
      }
      store.put(next);
    };
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(new Error(conflict ? 'Another window has updated this album. Keep a copy of your draft, then refresh this page and try again to avoid overwriting newer memories.' : 'Could not save locally. Your browser may be out of storage. Export a backup or a standalone page before trying again.'));
  });
}
async function commit(next) {
  next.revision = C.newId();
  next.updatedAt = validTimestamp();
  const checked = C.validateAlbum(next);
  if (db) await writeAlbum(checked,state.revision);
  state = checked;
  hasUnexported = true;
  render();
}
function saveStatus() {
  $('save-status').innerHTML = icon(volatile?'file':'check') + `<span>${volatile ? 'Auto-save unavailable · Please export your memories' : 'Saved in this browser · Back up regularly'}</span>`;
  $('undo-delete').disabled = !deletedEntry;
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
  for (const option of $('entry-category').options) {
    option.textContent = categoryLabel(option.value);
    option.lang = isChinese ? 'zh-Hans' : 'en';
  }
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
    $('days-label').innerHTML = '<button data-action="settings">Together · Not set yet</button>';
  }
  $('first-met-value').textContent = s.firstMetDate ? readableDate(s.firstMetDate) : 'Not set yet';
  $('contact-value').textContent = s.contactDate ? readableDate(s.contactDate) : 'Not set yet';
  if(s.contactDate){
    const contactDays=C.daysBetween(s.contactDate,C.today());
    $('contact-label').textContent=contactDays>=0?`Contact · ${countLabel(contactDays+1,'day')}`:`Contact · in ${countLabel(-contactDays,'day')}`;
  }else $('contact-label').textContent='Contact';
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
  renderRecords(); saveStatus();
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
    $('records').innerHTML = `<div class="empty">${icon(emptyAll?'photo':'search')}<h3>${emptyAll?'Your first memory is waiting.':'No memories found.'}</h3><p>${emptyAll?'A photo, a feeling, a little piece of us. Start here.':'Try another word or category and take another look.'}</p><button class="btn primary" data-action="${emptyAll?'new':'reset'}">${icon(emptyAll?'plus':'book')}${emptyAll?'Add our first memory':'See all memories'}</button></div>`;
    return;
  }
  let content = `<p class="result-count">${countLabel(entries.length,'memory','memories')} to keep${query||filter!=='全部'?' · Filtered results':''}</p>`;
  if (view === 'wall') {
    const photos = entries.flatMap(e=>e.photos.map((photo,i)=>({entry:e,photo,index:i})));
    if (!photos.length) {
      $('records').innerHTML = `<div class="empty">${icon('photo')}<h3>A story today, a photo whenever.</h3><p>These memories do not have photos yet. Edit a memory on the timeline to add some.</p><button class="btn" data-action="timeline">Back to the timeline</button></div>`; return;
    }
    const coverEntryId = state.entries.find(entry => entry.title === '光明初遇' && entry.date === '2026-11-22')?.id;
    const cards = photos.map(({entry, photo, index}) => {
      const illustrated = firstMeetingCover && entry.id === coverEntryId && index === 0;
      const thumbnail = illustrated ? firstMeetingCover : photo.dataUrl;
      const title = h(memoryTitle(entry));
      return `<article class="wall-card">
        <button class="photo-button" data-action="photo" data-id="${h(entry.id)}" data-index="${index}" aria-label="View ${title}, photo ${index + 1}">
          <img src="${h(thumbnail)}" alt="${title}" loading="lazy" decoding="async">
        </button>
        <div class="wall-caption">${title}</div>
        <p class="wall-date">${readableDate(entry.date)} · ${h(categoryLabel(entry.category))}</p>
      </article>`;
    });
    content = `<p class="result-count">${countLabel(photos.length,'photo')} · From ${countLabel(entries.filter(entry=>entry.photos.length).length,'memory','memories')}</p><div class="photo-wall">${cards.join('')}</div>`;
  } else {
    let year = '';
    for (const e of entries) {
      const currentYear = e.date.slice(0,4);
      if (currentYear !== year) { if (year) content += '</div>'; content += `<h3 class="year-heading">${currentYear}</h3><div class="timeline">`; year=currentYear; }
      const pictures = e.photos.slice(0,6);
      content += `<article class="memory"><div class="memory-top"><div class="memory-meta"><time datetime="${e.date}">${readableDate(e.date)}</time><span class="tag">${h(categoryLabel(e.category))}</span></div><div class="action-row"><button class="icon-btn ${e.favorite?'active':''}" data-action="favorite" data-id="${h(e.id)}" aria-label="${e.favorite?'Unfavorite':'Favorite'}: ${h(memoryTitle(e))}" aria-pressed="${e.favorite}">${icon('heart')}</button><button class="icon-btn" data-action="edit" data-id="${h(e.id)}" aria-label="Edit: ${h(memoryTitle(e))}">${icon('settings')}</button><button class="icon-btn" data-action="delete" data-id="${h(e.id)}" aria-label="Delete: ${h(memoryTitle(e))}">${icon('trash')}</button></div></div><h3>${h(memoryTitle(e))}</h3>${e.story?`<p class="memory-text">${h(e.story)}</p>`:''}${e.location?`<div class="memory-location">${icon('pin')}${h(e.location)}</div>`:''}${pictures.length?`<div class="memory-pictures ${pictures.length===1?'single':''}">${pictures.map((p,i)=>`<button class="photo-button" data-action="photo" data-id="${h(e.id)}" data-index="${i}" aria-label="View ${h(memoryTitle(e))}, photo ${i+1}"><img src="${h(p.dataUrl)}" alt="${h(memoryTitle(e))}, photo ${i+1}" loading="lazy" decoding="async">${i===5&&e.photos.length>6?`<span class="photo-more">+${e.photos.length-6}</span>`:''}</button>`).join('')}</div>`:''}</article>`;
    }
    content += '</div>';
  }
  $('records').innerHTML = content;
}
function openEntry(id = null) {
  const entry = state.entries.find(e=>e.id===id);
  editorId = entry?.id || null;
  $('entry-form').reset(); $('entry-message').textContent=''; $('upload-status').textContent='';
  $('entry-dialog-title').textContent = entry?'Edit this memory':'Keep this moment';
  $('entry-title').value = entry?.title || ''; $('entry-date').value = entry?.date || C.today();
  $('entry-category').value = entry?.category || '日常'; $('entry-story').value = entry?.story || '';
  $('entry-location').value = entry?.location || ''; $('entry-favorite').checked = !!entry?.favorite;
  draftPhotos = entry?clone(entry.photos):[]; renderDraftPhotos(); editorBaseline = editorSignature();
  showDialog('entry-dialog');
}
function renderDraftPhotos() {
  $('upload-thumbs').innerHTML = draftPhotos.map((p,i)=>`<div class="upload-thumb"><img src="${h(p.dataUrl)}" alt="${h(p.name)}"><button type="button" data-remove-photo="${i}" aria-label="Remove photo ${i+1}">${icon('close')}</button>${i===0?'<span>Cover photo</span>':''}</div>`).join('');
}
function fileAsDataURL(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this photo.'));reader.readAsDataURL(file);}); }
async function preparePhoto(file) {
  if (file.size>25*1024*1024) throw new Error('The file is larger than 25 MB.');
  if (!/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type)) throw new Error('Unsupported format. Please convert it to JPG or PNG.');
  const data = await fileAsDataURL(file);
  const img = await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Your browser could not open this image. Please convert it to JPG or PNG.'));i.src=data;});
  if (!img.naturalWidth||!img.naturalHeight) throw new Error('This photo has invalid dimensions.');
  const ratio=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
  const context=canvas.getContext('2d');if(!context)throw new Error('Could not process this photo.');
  context.drawImage(img,0,0,canvas.width,canvas.height);
  const dataUrl=canvas.toDataURL('image/webp',.9);
  canvas.width=canvas.height=1;
  return {id:C.newId(),name:file.name.slice(0,200),dataUrl};
}
async function addPhotos(fileList) {
  if (pendingPhotos || busy) return;
  const files=Array.from(fileList);if(!files.length)return;
  const available=40-draftPhotos.length;
  if(available<=0)return toast('Each memory can hold up to 40 photos.',true);
  pendingPhotos=true;$('save-entry').disabled=true;$('photo-input').disabled=true;
  const errors=[];
  try {
    for(let i=0;i<Math.min(files.length,available);i++) {
      $('upload-status').textContent=`Preparing photo ${i+1} of ${Math.min(files.length,available)}…`;
      try {draftPhotos.push(await preparePhoto(files[i]));renderDraftPhotos();}catch(error){errors.push(`${files[i].name}: ${error.message}`);}
    }
    if(files.length>available)errors.push(`${countLabel(files.length-available,'photo')} could not be added because of the 40-photo limit.`);
    $('upload-status').textContent=errors.length?errors.join('; '):`${countLabel(draftPhotos.length,'photo')} ready. Save this memory to keep them together.`;
  } finally {pendingPhotos=false;$('save-entry').disabled=false;$('photo-input').disabled=false;$('photo-input').value='';}
}
$('entry-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||pendingPhotos)return;
  const title=$('entry-title').value.trim(),date=$('entry-date').value;
  if(!C.validDate(date)){$('entry-message').textContent='Please enter a valid date.';return;}
  busy=true;$('entry-form').inert=true;$('save-entry').disabled=true;$('entry-message').textContent='Saving…';
  try {
    const next=clone(state),entry={id:editorId||C.newId(),title,date,category:$('entry-category').value,story:$('entry-story').value.trim(),location:$('entry-location').value.trim(),favorite:$('entry-favorite').checked,photos:clone(draftPhotos),updatedAt:validTimestamp()};
    const at=next.entries.findIndex(e=>e.id===editorId);if(at>=0)next.entries[at]=entry;else next.entries.push(entry);
    await commit(next);$('entry-dialog').close();draftPhotos=[];toast(volatile?'Your memory is kept in this session. Please export a backup.':'A little moment, safely kept.');
  }catch(error){$('entry-message').textContent=error.message;}finally{busy=false;$('entry-form').inert=false;$('save-entry').disabled=false;}
});
function openSettings() {
  const s=state.settings;$('name-one').value=s.nameOne;$('name-two').value=s.nameTwo;$('contact-date').value=s.contactDate;$('first-met-date').value=s.firstMetDate;$('start-date').value=s.startDate;$('couple-message').value=s.message;
  $('settings-message').textContent='';settingsBaseline=settingsSignature();showDialog('settings-dialog');
}
$('settings-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const contactDate=$('contact-date').value,firstMetDate=$('first-met-date').value,date=$('start-date').value;
  if([contactDate,firstMetDate,date].some(value=>value&&!C.validDate(value))){$('settings-message').textContent='Please enter valid milestone dates or leave them blank.';return;}
  busy=true;$('settings-form').inert=true;$('save-settings').disabled=true;
  try {const next=clone(state);next.settings={nameOne:$('name-one').value.trim(),nameTwo:$('name-two').value.trim(),contactDate,firstMetDate,startDate:date,message:$('couple-message').value.trim()};await commit(next);$('settings-dialog').close();toast('Your little universe is up to date.');}
  catch(error){$('settings-message').textContent=error.message;}finally{busy=false;$('settings-form').inert=false;$('save-settings').disabled=false;}
});
async function favorite(id) {
  if(busy)return;busy=true;
  try{const next=clone(state),e=next.entries.find(e=>e.id===id);if(!e)return;e.favorite=!e.favorite;e.updatedAt=validTimestamp();await commit(next);}catch(error){toast(error.message,true);}finally{busy=false;}
}
function requestDelete(id) {
  const entry=state.entries.find(e=>e.id===id);if(!entry)return;
  pendingDelete=id;$('delete-description').textContent=`“${memoryTitle(entry)}” and its ${countLabel(entry.photos.length,'photo')} will be removed from this memory book.`;
  showDialog('delete-dialog');
}
$('confirm-delete').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('confirm-delete').disabled=true;
  try{const next=clone(state),entry=next.entries.find(e=>e.id===pendingDelete);if(!entry)return;next.entries=next.entries.filter(e=>e.id!==pendingDelete);await commit(next);deletedEntry=entry;saveStatus();$('delete-dialog').close();toast('Memory removed. You can undo this in Help & saving.');}
  catch(error){toast(error.message,true);}finally{busy=false;$('confirm-delete').disabled=false;}
});
$('undo-delete').addEventListener('click',async()=>{
  if(!deletedEntry||busy)return;busy=true;
  try{const next=clone(state);if(next.entries.some(e=>e.id===deletedEntry.id))throw new Error('This memory is already here, so it was not added again.');next.entries.push({...clone(deletedEntry),updatedAt:validTimestamp()});await commit(next);deletedEntry=null;saveStatus();toast('Your memory is back where it belongs.');}
  catch(error){toast(error.message,true);}finally{busy=false;}
});
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
  $('lightbox-title').textContent=p.title;$('lightbox-image').src=p.dataUrl;$('lightbox-image').alt=p.name||p.title;
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
function makeBackup(){return{format:'our-days-backup',version:1,exportedAt:new Date().toISOString(),album:state};}
function markExported(name){hasUnexported=false;$('export-message').textContent=`Requested a download of “${name}”. Check your browser downloads to confirm it was saved, and keep the latest copy.`;$('export-message').hidden=false;toast('Your file is ready. Check your browser downloads to confirm it was saved.');}
function exportJSON(){try{const name=`${filenameBase()}_Backup_${C.today()}.json`;downloadBlob(new Blob([JSON.stringify(makeBackup())],{type:'application/json;charset=utf-8'}),name);markExported(name);}catch(error){toast(`Could not create the backup: ${error.message}`,true);}}
function downloadStandalone(template){
  const json=JSON.stringify(state).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const html=template.replace(/(<script id="embedded-state" type="application\/json">)[\s\S]*?(<\/script>)/,(_match,start,end)=>start+json+end);
  const name=`${filenameBase()}_Keepsake_${C.today()}.html`;downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),name);markExported(name);
}
function exportHTML(){
  const reportError=error=>toast(`Could not create the standalone page: ${error.message}`,true);
  const build=globalThis.buildAlbumStandaloneDocument;
  if(!build){
    try{downloadStandalone(originalHTML);}catch(error){reportError(error);}
    return;
  }
  const button=$('export-html');
  button.disabled=true;
  build(originalHTML).then(downloadStandalone).catch(reportError).finally(()=>{button.disabled=false;});
}
$('export-json').addEventListener('click',exportJSON);$('export-html').addEventListener('click',exportHTML);
$('download-photo').addEventListener('click',()=>{
  const p=lightboxPhotos[lightboxIndex];if(!p)return;
  const [header,base64]=p.dataUrl.split(','),bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),mime=header.match(/data:([^;]+)/)[1],extension=mime.split('/')[1].replace('jpeg','jpg');
  downloadBlob(new Blob([bytes],{type:mime}),`${safeFilename(p.title)}_${lightboxIndex+1}.${extension}`);
});
function openBackup(){
  $('backup-summary').textContent=`This book holds ${countLabel(state.entries.length,'memory','memories')} and ${countLabel(state.entries.reduce((n,e)=>n+e.photos.length,0),'photo')}. Save a copy to keep them close, wherever life takes you.`;
  $('export-message').hidden=true;
  const restore=$('restore-snapshot');if(restore)restore.hidden=seed.revision===state.revision||!(seed.entries.length||seed.settings.contactDate||seed.settings.firstMetDate||seed.settings.startDate||seed.settings.nameOne||seed.settings.nameTwo||seed.settings.message);
  showDialog('backup-dialog');
}
$('import-json').addEventListener('click',()=>{$('backup-input').value='';$('backup-input').click();});
$('backup-input').addEventListener('change',async()=>{
  const file=$('backup-input').files[0];if(!file)return;
  try {
    if(file.size>600*1024*1024)throw new Error('This backup is larger than the 600 MB import limit. Open your exported standalone page instead.');
    const data=JSON.parse(await file.text());
    if(data.format!=='our-days-backup'||data.version!==1)throw new Error('This backup format is not supported. Choose a JSON file created with Export full backup.');
    pendingImport=C.validateAlbum(data.album);prepareImport('This backup');
  }catch(error){toast(`Could not import: ${error.message}`,true);}
});
function prepareImport(source){
  $('import-summary').textContent=`${source} contains ${countLabel(pendingImport.entries.length,'memory','memories')} and ${countLabel(pendingImport.entries.reduce((n,e)=>n+e.photos.length,0),'photo')}. Choose how to add them to this book.`;
  $('import-form').reset();$('import-message').textContent='';$('backup-dialog').close();showDialog('import-dialog');
}
$('import-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!pendingImport||busy)return;
  const mode=new FormData($('import-form')).get('import-mode');
  if(mode==='replace'&&state.entries.length&&!confirm('Replacing will remove all current memories and settings. Have you saved a backup, and do you want to replace them with the imported content?'))return;
  busy=true;$('confirm-import').disabled=true;
  try{
    const next=clone(state);
    if(mode==='replace'){next.entries=clone(pendingImport.entries);next.settings=clone(pendingImport.settings);}
    else next.entries=C.mergeEntries(next.entries,pendingImport.entries);
    await commit(next);pendingImport=null;deletedEntry=null;filter='全部';query='';$('search').value='';render();$('import-dialog').close();toast('Your memories are back in the book.');
  }catch(error){$('import-message').textContent=error.message;}finally{busy=false;$('confirm-import').disabled=false;}
});
document.addEventListener('click',event=>{
  const close=event.target.closest('[data-close]');if(close){closeDialog(close.dataset.close);return;}
  const action=event.target.closest('[data-action]');if(!action)return;
  const id=action.dataset.id;
  switch(action.dataset.action){case'new':openEntry();break;case'settings':openSettings();break;case'edit':openEntry(id);break;case'favorite':favorite(id);break;case'delete':requestDelete(id);break;case'photo':openPhoto(id,Number(action.dataset.index));break;case'reset':filter='全部';query='';$('search').value='';render();break;case'timeline':setView('timeline');break;}
});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('cancel',event=>{event.preventDefault();closeDialog(d.id);}));
$('upload-thumbs').addEventListener('click',event=>{const b=event.target.closest('[data-remove-photo]');if(b&&!pendingPhotos&&!busy){draftPhotos.splice(Number(b.dataset.removePhoto),1);renderDraftPhotos();}});
$('photo-input').addEventListener('change',()=>addPhotos($('photo-input').files));
$('dropzone').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('photo-input').click();}});
['dragover','dragenter'].forEach(type=>$('dropzone').addEventListener(type,event=>{event.preventDefault();$('dropzone').classList.add('dragover');}));
['dragleave','drop'].forEach(type=>$('dropzone').addEventListener(type,event=>{event.preventDefault();$('dropzone').classList.remove('dragover');if(type==='drop')addPhotos(event.dataTransfer.files);}));
// Prevent dragging an image from navigating away and losing an unsaved draft.
document.addEventListener('dragover',event=>event.preventDefault());document.addEventListener('drop',event=>event.preventDefault());
$('settings-button').addEventListener('click',openSettings);$('backup-button').addEventListener('click',openBackup);
$('help-button').addEventListener('click',()=>{saveStatus();showDialog('help-dialog');});
$('browse-button').addEventListener('click',()=>$('stories').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
function setView(next){view=next;render();}
$('timeline-tab').addEventListener('click',()=>setView('timeline'));$('wall-tab').addEventListener('click',()=>setView('wall'));
[$('timeline-tab'),$('wall-tab')].forEach(tab=>tab.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setView(view==='timeline'?'wall':'timeline');$(view==='timeline'?'timeline-tab':'wall-tab').focus();}}));
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;render();}));
$('search').addEventListener('input',()=>{query=$('search').value;renderRecords();});$('sort-order').addEventListener('change',()=>{direction=$('sort-order').value;renderRecords();});
window.addEventListener('beforeunload',event=>{
  const editing=$('entry-dialog').open&&editorSignature()!==editorBaseline;
  const setting=$('settings-dialog').open&&settingsSignature()!==settingsBaseline;
  if((volatile&&hasUnexported)||pendingPhotos||busy||editing||setting){event.preventDefault();event.returnValue='';}
});
async function init(){
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  try{
    db=await openDatabase();
    const local=await readAlbum();
    if(local){
      state=C.validateAlbum(local);
      if(needsMilestoneSetup(local.settings)){
        const expectedRevision=local.revision;
        state=C.validateAlbum({...state,settings:{...state.settings,...requestedMilestones},revision:C.newId(),updatedAt:validTimestamp()});
        hasUnexported=true;
        await writeAlbum(state,expectedRevision);
      }
    }else await writeAlbum(seed,null);
    // Re-read after a committed write, so storage availability is checked before showing success.
    const checked=await readAlbum();if(!checked)throw new Error('The browser could not save your memories.');
  }catch(error){db?.close();db=null;volatile=true;setStorageNotice('Auto-save is unavailable in this browser. After adding memories, use Save & backup to export a standalone page or full backup before closing, so you do not lose them.');}
  const restore=document.createElement('button');restore.id='restore-snapshot';restore.className='backup-option';restore.hidden=true;restore.innerHTML=icon('book')+'<span><strong>Restore the snapshot in this page</strong><small>Merge or restore the records from this album snapshot when this browser already has a saved album.</small></span>';
  restore.addEventListener('click',()=>{pendingImport=clone(seed);prepareImport('This page snapshot');});document.querySelector('.backup-options').append(restore);
  render();
  document.querySelector('.wrap').inert = false;
  if(db)db.onversionchange=()=>{db.close();db=null;volatile=true;setStorageNotice('Local storage has disconnected. Export your current memories or reopen this page.');saveStatus();};
}
init().catch(error=>{document.querySelector('.wrap').inert=false;setStorageNotice(`This page could not finish loading: ${error.message} Keep the original file and try opening it in Edge or Chrome.`);});
})();

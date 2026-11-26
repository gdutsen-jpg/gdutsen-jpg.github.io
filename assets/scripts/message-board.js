(() => {
  'use strict';

  const board = document.querySelector('#message-board');
  if (!board) return;

  const form = board.querySelector('#message-form');
  const name = board.querySelector('#message-name');
  const editor = board.querySelector('#message-text');
  const submit = board.querySelector('#message-submit');
  const cancel = board.querySelector('#message-cancel');
  const status = board.querySelector('#message-status');
  const list = board.querySelector('#message-list');
  const empty = board.querySelector('#message-empty');
  const postLabel = submit.textContent;
  const storagePrefix = 'gomoku-message-board-v1:';
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const messages = new Map();
  let editingId = null;

  function readMessage(value) {
    try {
      const message = JSON.parse(value);
      if (message && typeof message.name === 'string' && message.name.length <= 30 &&
          typeof message.text === 'string' && message.text.trim() && message.text.length <= 500 &&
          typeof message.createdAt === 'number' && Number.isFinite(new Date(message.createdAt).getTime())) {
        return message;
      }
    } catch { /* Ignore an invalid saved message. */ }
    return null;
  }

  function loadMessages() {
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(storagePrefix)) continue;
        const message = readMessage(localStorage.getItem(key));
        if (message) messages.set(key.slice(storagePrefix.length), message);
      }
    } catch {
      status.textContent = 'Saved messages could not be loaded in this browser.';
    }
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function makeAction(label, action) {
    const button = makeElement('button', 'btn ghost', label);
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  function renderMessages() {
    const fragment = document.createDocumentFragment();
    const newestFirst = [...messages].sort(([, left], [, right]) => right.createdAt - left.createdAt);
    for (const [id, message] of newestFirst) {
      const entry = makeElement('li', 'message-entry');
      const meta = makeElement('div', 'message-meta');
      const time = makeElement('time', '', dateFormat.format(message.createdAt));
      time.dateTime = new Date(message.createdAt).toISOString();
      if (message.name) meta.append(makeElement('strong', '', message.name));
      meta.append(time);

      const actions = makeElement('div', 'message-entry-actions');
      actions.append(makeAction('Edit', () => startEdit(id)), makeAction('Delete', () => deleteMessage(id)));
      entry.append(meta, makeElement('p', 'message-content', message.text), actions);
      fragment.append(entry);
    }
    list.replaceChildren(fragment);
    if (empty) empty.hidden = messages.size !== 0;
  }

  function startEdit(id) {
    const message = messages.get(id);
    if (!message) return;

    editingId = id;
    if (name) name.value = message.name;
    editor.value = message.text;
    submit.textContent = 'Save changes';
    if (cancel) cancel.hidden = false;
    status.textContent = 'Editing message.';
    editor.focus();
  }

  function resetEditor() {
    editingId = null;
    form.reset();
    submit.textContent = postLabel;
    if (cancel) cancel.hidden = true;
  }

  function cancelEdit() {
    resetEditor();
    status.textContent = '';
    editor.focus();
  }

  function saveChange(id, message, notice) {
    const key = storagePrefix + id;
    try {
      if (message) localStorage.setItem(key, JSON.stringify(message));
      else localStorage.removeItem(key);
      status.textContent = notice;
    } catch {
      status.textContent = 'This change is available for this visit. The browser could not save it.';
    }
    if (message) messages.set(id, message);
    else messages.delete(id);
    renderMessages();
  }

  function deleteMessage(id) {
    if (!messages.has(id) || !window.confirm('Delete this message from this browser?')) return;
    if (editingId === id) resetEditor();
    saveChange(id, null, 'Message deleted.');
    editor.focus();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = editor.value.trim();
    const author = name?.value.trim() ?? '';
    if (!text || text.length > 500 || author.length > 30) {
      status.textContent = 'Write a message of up to 500 characters and a name of up to 30 characters.';
      editor.focus();
      return;
    }

    const existing = messages.get(editingId);
    const id = editingId ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const message = { name: name ? author : (existing?.name ?? ''), text, createdAt: existing?.createdAt ?? Date.now() };
    resetEditor();
    saveChange(id, message, existing ? 'Message updated.' : 'Message posted.');
    editor.focus();
  });

  cancel?.addEventListener('click', cancelEdit);
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape' && editingId !== null) cancelEdit();
  });

  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage) return;
    if (event.key === null) messages.clear();
    else if (event.key.startsWith(storagePrefix)) {
      const id = event.key.slice(storagePrefix.length);
      const message = readMessage(event.newValue);
      if (message) messages.set(id, message);
      else messages.delete(id);
    } else return;
    if (editingId !== null && !messages.has(editingId)) resetEditor();
    renderMessages();
  });

  loadMessages();
  renderMessages();
})();

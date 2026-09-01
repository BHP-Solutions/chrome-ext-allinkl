import { SERVICES } from './services.js';
import * as V from './vault.js';

/* ---------- kleine Helfer ---------- */

const $ = sel => document.querySelector(sel);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(message, bad = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/** Zweistufige Bestätigung direkt auf dem Button. */
function armConfirm(button, confirmLabel, onConfirm, hint) {
  const original = button.textContent;
  let armed = false;
  let timer;
  button.addEventListener('click', () => {
    if (armed) {
      clearTimeout(timer);
      armed = false;
      button.textContent = original;
      onConfirm();
      return;
    }
    armed = true;
    button.textContent = confirmLabel;
    if (hint) toast(hint);
    timer = setTimeout(() => { armed = false; button.textContent = original; }, 4000);
  });
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} kopiert.`);
  } catch {
    toast('Kopieren fehlgeschlagen.', true);
  }
}

/* ---------- Zustand ---------- */

const state = {
  items: [],
  settings: { ...V.DEFAULT_SETTINGS },
  query: '',
  filter: 'all',
  editing: null
};

const VIEWS = ['#view-locked', '#view-list', '#view-edit', '#view-settings'];
function show(view) {
  for (const v of VIEWS) $(v).hidden = (v !== view);
}

/* ---------- Liste ---------- */

function matches(entry, q) {
  if (!q) return true;
  const hay = `${entry.description} ${entry.username} ${entry.notes} ${SERVICES[entry.service]?.label || ''}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(part => hay.includes(part));
}

function sortEntries(a, b) {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  if (state.settings.sortBy === 'lastUsed' && a.lastUsed !== b.lastUsed) {
    return (b.lastUsed || 0) - (a.lastUsed || 0);
  }
  return a.description.localeCompare(b.description, 'de', { sensitivity: 'base' });
}

function renderList() {
  const list = $('#list');
  list.textContent = '';

  const q = state.query.trim().toLowerCase();
  const visible = state.items.filter(e =>
    (state.filter === 'all' || e.service === state.filter) && matches(e, q)
  );

  $('#empty').hidden = state.items.length > 0;
  if (state.items.length && !visible.length) {
    list.append(h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, 'Keine Treffer'),
      h('p', { class: 'muted' }, 'Andere Suche oder anderen Dienst wählen.')
    ));
    return;
  }

  const groups = V.groupByService(visible);
  for (const [serviceId, entries] of groups) {
    if (!entries.length) continue;
    const svc = SERVICES[serviceId];
    if (!svc) continue;

    // Beim Suchen immer aufklappen, damit Treffer sichtbar sind.
    const collapsed = !q && state.settings.collapsed?.[serviceId] === true;

    const block = h('div', {
      class: `group-block${collapsed ? ' collapsed' : ''}`,
      style: `--svc-color:${svc.accent}`
    });

    block.append(h('button', {
      class: 'group-header',
      type: 'button',
      title: svc.full,
      onclick: () => toggleGroup(serviceId)
    },
      h('span', { class: 'caret' }, '▼'),
      h('span', { class: 'group-name' }, svc.label),
      h('span', { class: 'group-count' }, String(entries.length))
    ));

    const items = h('div', { class: 'group-items' });
    for (const entry of entries.sort(sortEntries)) items.append(renderCard(entry, svc));
    block.append(items);
    list.append(block);
  }
}

function renderCard(entry, svc) {
  const star = h('button', {
    class: `star${entry.favorite ? ' on' : ''}`,
    type: 'button',
    title: entry.favorite ? 'Favorit entfernen' : 'Als Favorit markieren',
    onclick: async ev => {
      ev.stopPropagation();
      entry.favorite = !entry.favorite;
      await V.upsertEntry(entry);
      renderList();
    }
  }, entry.favorite ? '★' : '☆');

  const main = h('button', {
    class: 'card-main',
    type: 'button',
    title: `Bei ${svc.label} anmelden`,
    onclick: () => doLogin(entry)
  },
    h('span', { class: 'card-name' }, entry.description || '(ohne Beschreibung)'),
    h('span', { class: 'card-sub' }, entry.username || '—')
  );

  const actions = h('div', { class: 'card-actions' },
    h('button', {
      class: 'icon-btn', type: 'button', title: 'Benutzer kopieren',
      onclick: ev => { ev.stopPropagation(); copy(entry.username, 'Benutzer'); }
    }, '\u{1F464}'),
    h('button', {
      class: 'icon-btn', type: 'button', title: 'Passwort kopieren',
      onclick: ev => { ev.stopPropagation(); copy(entry.password, 'Passwort'); }
    }, '\u{1F511}'),
    h('button', {
      class: 'icon-btn', type: 'button', title: 'Bearbeiten',
      onclick: ev => { ev.stopPropagation(); openEdit(entry); }
    }, '✎')
  );

  return h('div', { class: 'card', dataset: { id: entry.id } }, star, main, actions);
}

async function toggleGroup(serviceId) {
  const collapsed = { ...(state.settings.collapsed || {}) };
  collapsed[serviceId] = !collapsed[serviceId];
  state.settings = await V.setSettings({ collapsed });
  renderList();
}

/* ---------- Login auslösen ---------- */

async function doLogin(entry) {
  const svc = SERVICES[entry.service];
  toast(`${svc.label} wird geöffnet …`);
  V.touchEntry(entry.id).catch(() => {});

  const payload = {
    service: entry.service,
    username: entry.username,
    password: entry.password,
    autoSubmit: state.settings.autoSubmit,
    openInNewTab: state.settings.openInNewTab
  };

  try {
    const res = await chrome.runtime.sendMessage({ type: 'login', payload });
    // Wird ein neuer Tab aktiviert, ist das Popup an dieser Stelle meist schon zu.
    if (res && !res.ok) toast(res.message || 'Login fehlgeschlagen.', true);
    else if (res && res.ok) window.close();
  } catch {
    /* Popup wurde geschlossen – der Service Worker arbeitet weiter. */
  }
}

/* ---------- Bearbeiten ---------- */

function serviceLabels(serviceId) {
  const svc = SERVICES[serviceId] || SERVICES.kas;
  $('#f-user-label').textContent = `${svc.userLabel} *`;
  $('#f-pass-label').textContent = `${svc.passLabel} *`;
  $('#f-username').placeholder =
    serviceId === 'members' ? '123456'
    : serviceId === 'kas' ? 'beispiel.de oder w0123456'
    : serviceId === 'webmail' ? 'name@beispiel.de'
    : 'ftp-benutzer';
}

function openEdit(entry) {
  state.editing = entry ? { ...entry } : V.emptyEntry(state.filter === 'all' ? 'kas' : state.filter);
  const e = state.editing;

  $('#edit-title').textContent = entry ? 'Zugang bearbeiten' : 'Neuer Zugang';
  $('#edit-delete').hidden = !entry;
  $('#f-description').value = e.description;
  $('#f-service').value = e.service;
  $('#f-username').value = e.username;
  $('#f-password').value = e.password;
  $('#f-password').type = 'password';
  $('#f-notes').value = e.notes;
  $('#edit-error').hidden = true;
  serviceLabels(e.service);

  show('#view-edit');
  $('#f-description').focus();
}

async function saveEdit(ev) {
  ev.preventDefault();
  const e = state.editing;
  e.description = $('#f-description').value.trim();
  e.service = $('#f-service').value;
  e.username = $('#f-username').value.trim();
  e.password = $('#f-password').value;
  e.notes = $('#f-notes').value.trim();

  if (!e.description || !e.username || !e.password) {
    const err = $('#edit-error');
    err.textContent = 'Beschreibung, Benutzer und Passwort sind Pflichtfelder.';
    err.hidden = false;
    return;
  }

  await V.upsertEntry(e);
  state.items = await V.getItems();
  state.editing = null;
  renderList();
  show('#view-list');
  toast('Gespeichert.');
}

/* ---------- Einstellungen ---------- */

async function openSettings() {
  const s = state.settings;
  $('#s-newtab').checked = s.openInNewTab;
  $('#s-submit').checked = s.autoSubmit;
  $('#s-sort').value = s.sortBy;
  $('#mp-error').hidden = true;
  $('#io-msg').textContent = '';

  const encrypted = await V.isEncrypted();
  $('#mp-state').textContent = encrypted
    ? 'Aktiv – die Zugänge sind verschlüsselt gespeichert.'
    : 'Nicht gesetzt – die Zugänge liegen unverschlüsselt im Chrome-Profil.';
  $('#mp-set').hidden = encrypted;
  $('#mp-remove').hidden = !encrypted;

  show('#view-settings');
}

async function saveMasterPassword() {
  const pw = $('#mp-new').value;
  const pw2 = $('#mp-new2').value;
  const err = $('#mp-error');
  err.hidden = true;

  if (pw.length < 8) {
    err.textContent = 'Mindestens 8 Zeichen.';
    err.hidden = false;
    return;
  }
  if (pw !== pw2) {
    err.textContent = 'Die Eingaben stimmen nicht überein.';
    err.hidden = false;
    return;
  }

  await V.setMasterPassword(pw);
  $('#mp-new').value = '';
  $('#mp-new2').value = '';
  $('#btn-lock').hidden = false;
  await openSettings();
  toast('Verschlüsselung aktiviert.');
}

/* ---------- Export / Import ---------- */

async function exportJson() {
  const items = await V.getItems();
  const payload = {
    format: 'allinkl-zugaenge',
    version: 1,
    exportedAt: new Date().toISOString(),
    items
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = h('a', { href: url, download: `all-inkl-zugaenge-${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  $('#io-msg').textContent = `${items.length} Zugänge exportiert.`;
}

async function importJson(file) {
  const msg = $('#io-msg');
  try {
    const raw = JSON.parse(await file.text());
    const incoming = Array.isArray(raw) ? raw : raw.items;
    if (!Array.isArray(incoming)) throw new Error('Unerwartetes Format');

    const items = await V.getItems();
    const byId = new Map(items.map(i => [i.id, i]));
    let added = 0, updated = 0;

    for (const rawEntry of incoming) {
      const entry = V.normalizeEntry(rawEntry);
      if (!entry.username || !entry.password) continue;
      if (byId.has(entry.id)) { byId.set(entry.id, entry); updated++; }
      else { byId.set(entry.id, entry); added++; }
    }

    await V.saveItems([...byId.values()]);
    state.items = await V.getItems();
    renderList();
    msg.textContent = `${added} neu, ${updated} aktualisiert.`;
  } catch (err) {
    msg.textContent = `Import fehlgeschlagen: ${err.message}`;
  }
}

/* ---------- Start ---------- */

async function loadAndRenderList() {
  state.items = await V.getItems();
  $('#btn-lock').hidden = !(await V.isEncrypted());
  renderList();
  show('#view-list');
  $('#search').focus();
}

async function init() {
  state.settings = await V.getSettings();

  if (!(await V.isUnlocked())) {
    show('#view-locked');
    $('#unlock-password').focus();
  } else {
    await loadAndRenderList();
  }

  /* Sperrbildschirm */
  $('#unlock-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = $('#unlock-error');
    err.hidden = true;
    try {
      await V.unlock($('#unlock-password').value);
      $('#unlock-password').value = '';
      await loadAndRenderList();
    } catch {
      err.textContent = 'Master-Passwort falsch.';
      err.hidden = false;
    }
  });

  /* Liste */
  $('#search').addEventListener('input', ev => {
    state.query = ev.target.value;
    renderList();
  });
  $('#search').addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    const first = $('#list .card-main');
    if (first) first.click();
  });

  $('#service-filter').addEventListener('click', ev => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.service;
    for (const c of $('#service-filter').children) c.classList.toggle('chip-active', c === chip);
    renderList();
  });

  $('#btn-new').addEventListener('click', () => openEdit(null));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-lock').addEventListener('click', async () => {
    await V.lock();
    state.items = [];
    show('#view-locked');
    $('#unlock-password').focus();
  });

  /* Bearbeiten */
  $('#edit-form').addEventListener('submit', saveEdit);
  $('#edit-back').addEventListener('click', () => show('#view-list'));
  $('#edit-cancel').addEventListener('click', () => show('#view-list'));
  $('#f-service').addEventListener('change', ev => serviceLabels(ev.target.value));
  $('#f-pass-toggle').addEventListener('click', () => {
    const input = $('#f-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  armConfirm($('#edit-delete'), 'Wirklich löschen?', async () => {
    await V.deleteEntry(state.editing.id);
    state.items = await V.getItems();
    state.editing = null;
    renderList();
    show('#view-list');
    toast('Gelöscht.');
  });

  /* Einstellungen */
  $('#settings-back').addEventListener('click', () => { renderList(); show('#view-list'); });
  $('#s-newtab').addEventListener('change', async ev => {
    state.settings = await V.setSettings({ openInNewTab: ev.target.checked });
  });
  $('#s-submit').addEventListener('change', async ev => {
    state.settings = await V.setSettings({ autoSubmit: ev.target.checked });
  });
  $('#s-sort').addEventListener('change', async ev => {
    state.settings = await V.setSettings({ sortBy: ev.target.value });
  });
  $('#mp-save').addEventListener('click', saveMasterPassword);
  armConfirm($('#mp-remove'), 'Wirklich aufheben?', async () => {
    await V.removeMasterPassword();
    $('#btn-lock').hidden = true;
    await openSettings();
    toast('Verschlüsselung aufgehoben.');
  });

  $('#btn-export').addEventListener('click', exportJson);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', ev => {
    const file = ev.target.files?.[0];
    if (file) importJson(file);
    ev.target.value = '';
  });
  armConfirm($('#btn-wipe'), 'Wirklich alles löschen?', async () => {
    await V.saveItems([]);
    state.items = [];
    renderList();
    toast('Alle Zugänge gelöscht.');
  });

  /* Tastatur */
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (!$('#view-locked').hidden) return;          // gesperrt: nichts tun
    if (!$('#view-list').hidden) { window.close(); return; }
    renderList();
    show('#view-list');                              // aus Bearbeiten/Einstellungen zurück
  });
}

init();

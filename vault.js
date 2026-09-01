// Speicher- und Kryptoschicht.
//
// Ohne Master-Passwort liegen die Einträge im Klartext in chrome.storage.local
// (nur für diese Extension lesbar, aber unverschlüsselt auf der Platte).
// Mit Master-Passwort wird der komplette Datensatz per AES-GCM verschlüsselt;
// der abgeleitete Schlüssel liegt dann in chrome.storage.session und damit nur
// im Arbeitsspeicher – nach Chrome-Neustart muss neu entsperrt werden.

const VAULT_KEY = 'vault';
const SETTINGS_KEY = 'settings';
const SESSION_KEY = 'unlockedKey';

const PBKDF2_ITERATIONS = 310000;

export const DEFAULT_SETTINGS = {
  openInNewTab: true,   // Klick öffnet den Login in einem neuen Tab
  autoSubmit: true,     // Formular direkt absenden
  sortBy: 'description', // 'description' | 'lastUsed'
  collapsed: {}          // { [serviceId]: true } – eingeklappte Gruppen
};

export class LockedError extends Error {
  constructor() { super('Vault ist gesperrt'); this.name = 'LockedError'; }
}
export class WrongPasswordError extends Error {
  constructor() { super('Master-Passwort falsch'); this.name = 'WrongPasswordError'; }
}

/* ---------- Hilfsfunktionen ---------- */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export function newId() {
  return crypto.randomUUID();
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function importRawKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/* ---------- Rohzugriff ---------- */

async function readVault() {
  const data = await chrome.storage.local.get(VAULT_KEY);
  return data[VAULT_KEY] || { v: 1, encrypted: false, items: [] };
}

async function writeVault(vault) {
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
}

export async function isEncrypted() {
  return (await readVault()).encrypted === true;
}

async function sessionKey() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  if (!data[SESSION_KEY]) return null;
  return importRawKey(fromB64(data[SESSION_KEY]));
}

async function cacheKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.session.set({ [SESSION_KEY]: toB64(raw) });
}

export async function lock() {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function isUnlocked() {
  if (!(await isEncrypted())) return true;
  return (await sessionKey()) !== null;
}

/* ---------- Ver-/Entschlüsseln ---------- */

async function decryptVault(vault, key) {
  const iv = fromB64(vault.iv);
  const ct = fromB64(vault.ct);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new WrongPasswordError();
  }
  const parsed = JSON.parse(dec.decode(plain));
  return Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
}

async function encryptItems(items, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(items)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/* ---------- Öffentliche API ---------- */

export async function unlock(password) {
  const vault = await readVault();
  if (!vault.encrypted) return true;
  const key = await deriveKey(password, fromB64(vault.kdf.salt), vault.kdf.iterations);
  await decryptVault(vault, key); // wirft bei falschem Passwort
  await cacheKey(key);
  return true;
}

export async function getItems() {
  const vault = await readVault();
  if (!vault.encrypted) return (vault.items || []).map(normalizeEntry);
  const key = await sessionKey();
  if (!key) throw new LockedError();
  return decryptVault(vault, key);
}

export async function saveItems(items) {
  const vault = await readVault();
  if (!vault.encrypted) {
    await writeVault({ v: 1, encrypted: false, items });
    return;
  }
  const key = await sessionKey();
  if (!key) throw new LockedError();
  const { iv, ct } = await encryptItems(items, key);
  await writeVault({ v: 1, encrypted: true, kdf: vault.kdf, iv, ct });
}

export async function setMasterPassword(password) {
  const items = await getItems(); // erfordert entsperrten Zustand
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const { iv, ct } = await encryptItems(items, key);
  await writeVault({
    v: 1,
    encrypted: true,
    kdf: { salt: toB64(salt), iterations: PBKDF2_ITERATIONS },
    iv,
    ct
  });
  await cacheKey(key);
}

export async function removeMasterPassword() {
  const items = await getItems(); // erfordert entsperrten Zustand
  await writeVault({ v: 1, encrypted: false, items });
  await chrome.storage.session.remove(SESSION_KEY);
}

/* ---------- Einträge ---------- */
//
// Ein Eintrag = ein einzelner Zugang (ein Benutzer/Passwort-Paar) für genau
// einen der vier Dienste. Ein Kunde kann beliebig viele Einträge pro Dienst
// haben; die Liste wird nach Dienst gruppiert dargestellt.

export const LOGIN_SERVICES = ['members', 'kas', 'webmail', 'webftp'];

export function emptyEntry(service = 'kas') {
  return {
    id: newId(),
    description: '',
    service: LOGIN_SERVICES.includes(service) ? service : 'kas',
    username: '',
    password: '',
    notes: '',
    favorite: false,
    lastUsed: 0,
    createdAt: Date.now()
  };
}

/** Fremd- oder Altdaten auf das aktuelle Schema heben. */
export function normalizeEntry(raw) {
  const entry = emptyEntry();
  if (!raw || typeof raw !== 'object') return entry;

  entry.id = typeof raw.id === 'string' && raw.id ? raw.id : entry.id;
  entry.description = String(raw.description || '');
  entry.service = LOGIN_SERVICES.includes(raw.service) ? raw.service : 'kas';
  entry.username = String(raw.username || '');
  entry.password = String(raw.password || '');
  entry.notes = String(raw.notes || '');
  entry.favorite = !!raw.favorite;
  entry.lastUsed = Number(raw.lastUsed) || 0;
  entry.createdAt = Number(raw.createdAt) || Date.now();
  return entry;
}

/** Einträge nach Dienst gruppieren, Reihenfolge wie in LOGIN_SERVICES. */
export function groupByService(items) {
  const groups = new Map(LOGIN_SERVICES.map(s => [s, []]));
  for (const item of items) {
    if (!groups.has(item.service)) groups.set(item.service, []);
    groups.get(item.service).push(item);
  }
  return groups;
}

export async function upsertEntry(entry) {
  const items = await getItems();
  const idx = items.findIndex(i => i.id === entry.id);
  if (idx >= 0) items[idx] = entry; else items.push(entry);
  await saveItems(items);
  return entry;
}

export async function deleteEntry(id) {
  const items = await getItems();
  await saveItems(items.filter(i => i.id !== id));
}

export async function touchEntry(id) {
  const items = await getItems();
  const entry = items.find(i => i.id === id);
  if (!entry) return;
  entry.lastUsed = Date.now();
  await saveItems(items);
}

/* ---------- Einstellungen ---------- */

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

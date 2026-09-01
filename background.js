// Service Worker: führt den eigentlichen Login-Vorgang aus.
// Läuft bewusst hier und nicht im Popup, weil das Popup geschlossen wird,
// sobald ein neuer Tab aktiviert wird.

import { SERVICES, pageSupports } from './services.js';

/**
 * Wird per chrome.scripting in die Login-Seite injiziert.
 * Muss vollständig eigenständig sein (kein Zugriff auf den Modul-Scope).
 */
function fillLoginForm(payload) {
  const { fields, username, password, autoSubmit } = payload;

  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Benutzerfeld über den exakten name-Attributwert finden. Auf
  // all-inkl.com/login/ stehen vier Formulare auf einer Seite – deshalb wird
  // das Passwortfeld anschließend nur innerhalb desselben Formulars gesucht
  // (KAS und MembersArea benutzen beide name="passwort").
  const candidates = Array.from(document.querySelectorAll(`input[name="${fields.user}"]`));
  let userInput = candidates.find(visible) || candidates[0];

  let form = userInput ? userInput.form : null;
  let passInput = null;

  if (form) {
    passInput = form.querySelector(`input[name="${fields.pass}"]`) ||
                form.querySelector('input[type="password"]');
  }

  // Fallback: irgendein sichtbares Formular mit Passwortfeld.
  if (!userInput || !passInput) {
    const pw = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
    if (pw && pw.form) {
      form = pw.form;
      passInput = pw;
      userInput = form.querySelector('input[type="text"], input[type="email"], input:not([type])');
    }
  }

  if (!userInput || !passInput) {
    return { ok: false, reason: 'no-form' };
  }

  setValue(userInput, username);
  setValue(passInput, password);

  form.scrollIntoView({ block: 'center', behavior: 'instant' });

  if (!autoSubmit) {
    passInput.focus();
    return { ok: true, submitted: false };
  }

  // Reihenfolge bewusst sequenziell: ein gruppierter Selektor würde das im
  // Dokument zuerst stehende Element liefern, nicht den bevorzugten Typ.
  const button =
    form.querySelector('button[type="submit"]') ||
    form.querySelector('input[type="submit"]') ||
    form.querySelector('input[type="image"]') ||
    form.querySelector('button:not([type])');
  // In einem Micro-Task absenden, damit die gesetzten Werte sicher übernommen sind.
  setTimeout(() => {
    if (button) button.click();
    else if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }, 30);

  return { ok: true, submitted: true };
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

/**
 * Wartet, bis der Tab fertig geladen ist UND tatsächlich auf dem erwarteten
 * Origin steht. Ohne die Origin-Prüfung könnte ein noch leerer Tab
 * (about:blank) vorzeitig als "complete" gemeldet werden.
 */
function waitForTabComplete(tabId, expectedOrigin, timeoutMs = 20000) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };
    const ready = tab =>
      tab && tab.status === 'complete' &&
      (!expectedOrigin || originOf(tab.url) === expectedOrigin);

    const listener = (id, info, tab) => {
      if (id === tabId && info.status === 'complete' && ready(tab)) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);

    // Falls der Tab bereits fertig geladen ist.
    chrome.tabs.get(tabId)
      .then(tab => { if (ready(tab)) finish(true); })
      .catch(() => finish(false));
  });
}

async function inject(tabId, payload) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillLoginForm,
    args: [payload]
  });
  return result?.result || { ok: false, reason: 'no-result' };
}

async function performLogin({ service, username, password, autoSubmit, openInNewTab }) {
  const svc = SERVICES[service];
  if (!svc) return { ok: false, message: 'Unbekannter Dienst.' };

  const payload = { fields: svc.fields, username, password, autoSubmit };
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 1. Aktuellen Tab wiederverwenden, wenn er bereits eine passende
  //    Login-Seite zeigt und kein neuer Tab erzwungen wurde.
  const reuseActive = active && !openInNewTab && pageSupports(active.url, service);
  if (reuseActive) {
    const res = await inject(active.id, payload);
    if (res.ok) return { ok: true, message: res.submitted ? 'Angemeldet.' : 'Formular ausgefüllt.' };
    // Kein Formular gefunden (z. B. bereits eingeloggt) -> frische Login-Seite.
  }

  // 2. Neuen Tab mit der Login-Seite des Dienstes öffnen.
  const tab = await chrome.tabs.create({ url: svc.loginUrl, active: true });
  const loaded = await waitForTabComplete(tab.id, originOf(svc.loginUrl));
  if (!loaded) return { ok: false, message: 'Login-Seite wurde nicht rechtzeitig geladen.' };

  const res = await inject(tab.id, payload);
  if (res.ok) return { ok: true, message: res.submitted ? 'Angemeldet.' : 'Formular ausgefüllt.' };
  if (res.reason === 'no-form') {
    return { ok: false, message: `Auf ${svc.label} wurde kein Login-Formular gefunden – evtl. bereits angemeldet.` };
  }
  return { ok: false, message: 'Ausfüllen fehlgeschlagen.' };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'login') return false;
  performLogin(msg.payload)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, message: String(err?.message || err) }));
  return true; // asynchrone Antwort
});

// Die vier ALL-INKL Logins. Feldnamen stammen 1:1 aus den Formularen auf
// https://all-inkl.com/login/ sowie den jeweiligen direkten Login-Seiten.
export const SERVICES = {
  kas: {
    id: 'kas',
    label: 'KAS',
    full: 'KAS – technische Verwaltung',
    userLabel: 'Loginname (Domain oder Kundennummer)',
    passLabel: 'KAS-Passwort',
    loginUrl: 'https://kas.all-inkl.com/login',
    fields: { user: 'loginname', pass: 'passwort' },
    accent: '#2f6fed'
  },
  members: {
    id: 'members',
    label: 'MembersArea',
    full: 'MembersArea – Vertragsverwaltung',
    userLabel: 'Kundennummer',
    passLabel: 'MA-Passwort',
    loginUrl: 'https://members.all-inkl.com/',
    fields: { user: 'kundennummer', pass: 'passwort' },
    accent: '#7b5cf0'
  },
  webmail: {
    id: 'webmail',
    label: 'WebMail',
    full: 'WebMail',
    userLabel: 'E-Mail-Adresse',
    passLabel: 'E-Mail-Passwort',
    loginUrl: 'https://webmail.all-inkl.com/',
    fields: { user: 'login_name', pass: 'login_password' },
    accent: '#189c60'
  },
  webftp: {
    id: 'webftp',
    label: 'WebFTP',
    full: 'WebFTP',
    userLabel: 'FTP-Benutzer',
    passLabel: 'FTP-Passwort',
    loginUrl: 'https://webftp.all-inkl.com/',
    fields: { user: 'user', pass: 'pass' },
    accent: '#d97b1f'
  }
};

export const SERVICE_IDS = Object.keys(SERVICES);
export const DEFAULT_SERVICE = 'kas';

/** Sammel-Login-Seite mit allen vier Formularen. */
export function isOverviewLogin(url) {
  return /^https:\/\/(www\.)?all-inkl\.com\/login\/?(\?|#|$)/.test(url || '');
}

/** Kann auf dieser Seite ein Login für diesen Dienst ausgefüllt werden? */
export function pageSupports(url, service) {
  if (!url) return false;
  if (isOverviewLogin(url)) return true;
  switch (service) {
    case 'kas': return /^https:\/\/kas\.all-inkl\.com\//.test(url);
    case 'members': return /^https:\/\/members\.all-inkl\.com\//.test(url);
    case 'webmail': return /^https:\/\/webmail\.all-inkl\.com\//.test(url);
    case 'webftp': return /^https:\/\/webftp\.all-inkl\.com\//.test(url);
    default: return false;
  }
}

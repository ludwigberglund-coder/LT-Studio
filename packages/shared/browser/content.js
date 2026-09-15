export async function loadJson(path) {
  const response = await fetch(path, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Kunde inte läsa ${path} (${response.status}).`);
  return response.json();
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

export function safeHref(value, fallback = '#') {
  const href = String(value || '').trim();
  return /^(?:#|\.\.?\/|https?:\/\/|mailto:|tel:)/i.test(href) ? href : fallback;
}

export function readLocalJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {type: 'application/json'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export function formatCurrency(value, currency = 'SEK') {
  return new Intl.NumberFormat('sv-SE', {style: 'currency', currency}).format(Number(value || 0));
}

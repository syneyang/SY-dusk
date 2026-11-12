// 一些小工具：建 DOM、日期、提示条。

export const APP_VERSION = '0.12.2';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key in node && key !== 'list') {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const pad2 = (n) => String(n).padStart(2, '0');

export function isoOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO() {
  return isoOf(new Date());
}

export function dateOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function prevISO(iso, days = 1) {
  const d = dateOf(iso);
  d.setDate(d.getDate() - days);
  return isoOf(d);
}

export function nextISO(iso, days = 1) {
  return prevISO(iso, -days);
}

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayCN(iso) {
  return WEEKDAYS[dateOf(iso).getDay()];
}

export function monthDayCN(iso) {
  const d = dateOf(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fullCN(iso) {
  const d = dateOf(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function monthTitle(key) {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
}

export function daysBetween(aISO, bISO) {
  const a = dateOf(aISO), b = dateOf(bISO);
  return Math.round((b - a) / 86400000);
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function escapeHTML(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

let toastTimer = null;
export function toast(message) {
  let node = document.querySelector('.toast');
  if (!node) {
    node = el('div', { class: 'toast' });
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

export function confirmAction(message) {
  return window.confirm(message);
}

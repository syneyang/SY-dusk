// 入口：路由 + 底部标签栏 + 自动保存的收尾。

import { renderEditor, flushSave, cleanupEditor } from './editor.js';
import { renderList } from './list.js';
import { renderReview } from './review.js';
import { renderSettings } from './settings.js';
import { todayISO } from './util.js';

const view = document.getElementById('view');

function setTab(path) {
  const tab = path === 'entry' || path === 'today' ? 'today' : path;
  document.querySelectorAll('.tabbar a').forEach((link) => {
    link.classList.toggle('active', link.dataset.tab === tab);
  });
}

async function route() {
  flushSave();
  cleanupEditor();

  const hash = location.hash || '#/today';
  const segments = hash.replace(/^#\/?/, '').split('/');
  const path = segments[0] || 'today';
  const param = segments[1] || '';

  setTab(path);
  window.scrollTo(0, 0);

  try {
    if (path === 'entry' && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
      await renderEditor(view, param);
    } else if (path === 'today') {
      await renderEditor(view, todayISO());
    } else if (path === 'list') {
      await renderList(view);
    } else if (path === 'review') {
      await renderReview(view);
    } else if (path === 'settings') {
      await renderSettings(view);
    } else {
      location.hash = '#/today';
    }
  } catch (error) {
    console.error(error);
    view.innerHTML = '';
    view.append(
      Object.assign(document.createElement('div'), {
        className: 'empty',
        textContent: '有点不对：' + (error && error.message ? error.message : error)
      })
    );
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', flushSave);

route();

// 离线缓存
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

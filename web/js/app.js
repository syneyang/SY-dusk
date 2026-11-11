// 入口：路由 + 底部标签栏 + 自动保存的收尾。

import { renderEditor, flushSave, cleanupEditor } from './editor.js';
import { renderList } from './list.js';
import { renderReview } from './review.js';
import { renderSettings } from './settings.js';
import { renderRead } from './read.js';
import { requireUnlock, startAutoLock } from './lock.js';
import { syncNow, scheduleSync } from './sync.js';
import { todayISO } from './util.js';

const view = document.getElementById('view');

function setTab(path) {
  const tab = path === 'entry' || path === 'read' || path === 'today' ? 'today' : path;
  document.querySelectorAll('.tabbar a').forEach((link) => {
    link.classList.toggle('active', link.dataset.tab === tab);
  });
}

async function route() {
  await flushSave();
  cleanupEditor();

  const hash = location.hash || '#/today';
  const segments = hash.replace(/^#\/?/, '').split('/');
  const path = segments[0] || 'today';
  const param = segments[1] || '';

  setTab(path);
  view.className = 'view';
  document.body.classList.toggle('reading', path === 'read');
  window.scrollTo(0, 0);

  try {
    if (path === 'read' && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
      view.classList.add('view-read');
      await renderRead(view, param);
    } else if (path === 'entry' && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
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

window.addEventListener('hashchange', () => {
  if (!document.body.classList.contains('locked')) route();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushSave();
    scheduleSync(0); // 切走之前先传一次
  }
});
window.addEventListener('pagehide', () => {
  flushSave();
  scheduleSync(0);
});

// 网络回来后补一次
window.addEventListener('online', () => scheduleSync(1000));

// 一直开着的话，每 5 分钟同步一次
setInterval(() => {
  if (document.visibilityState === 'visible') syncNow().catch(() => {});
}, 5 * 60 * 1000);

async function boot() {
  try {
    const unlocked = await requireUnlock(view);
    if (!unlocked) return;
    startAutoLock();
    await route();

    // 解锁后顺手同步一次（失败不影响使用）
    syncNow().catch(() => {});
  } catch (error) {
    console.error(error);
    view.innerHTML = '';
    view.append(Object.assign(document.createElement('div'), {
      className: 'empty',
      textContent: '启动出错：' + (error && error.message ? error.message : error)
    }));
  }
}

boot();

// 离线缓存 + 版本检查
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' 让浏览器每次都去问服务器 sw.js 有没有变
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}

checkForUpdate();

/** 线上版本比本地新时，顶部冒一条「点此更新」。 */
async function checkForUpdate() {
  try {
    const response = await fetch('js/util.js?ts=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) return;
    const text = await response.text();
    const match = text.match(/APP_VERSION = '([^']+)'/);
    if (!match) return;
    const remote = match[1];
    const { APP_VERSION: local } = await import('./util.js');
    if (remote === local) return;

    const bar = document.createElement('button');
    bar.className = 'update-bar';
    bar.textContent = `有新版本 ${remote}，点这里更新`;
    bar.onclick = async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch {}
      location.reload();
    };
    document.body.append(bar);
  } catch {
    // 离线时不管
  }
}

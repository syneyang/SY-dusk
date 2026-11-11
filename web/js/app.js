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
    showCrash('启动出错', error);
  }
}

function showCrash(title, error) {
  console.error(error);
  const view = document.getElementById('view');
  const stack = String((error && error.stack) || '').split('\n').slice(0, 4).join('\n');
  const detail = `${error && error.name || 'Error'}: ${error && error.message || error}`;
  const ua = navigator.userAgent.slice(0, 120);

  const text = `${title}\n${detail}\n${stack}\n${ua}`;
  const box = document.createElement('div');
  box.className = 'crash';
  box.innerHTML = '<div class="crash-title"></div><pre class="crash-detail"></pre>';
  box.querySelector('.crash-title').textContent = title;
  box.querySelector('.crash-detail').textContent = `${detail}\n${stack}\n\n${ua}`;

  const copy = document.createElement('button');
  copy.className = 'lock-btn';
  copy.textContent = '复制错误信息';
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = '已复制';
    } catch {
      copy.textContent = '复制失败';
    }
  };

  view.innerHTML = '';
  view.append(box, copy);
}

window.addEventListener('error', (event) => {
  if (document.body.classList.contains('locked') && document.querySelector('.key')) return;
  if (document.querySelector('.crash')) return;
  showCrash('运行出错', event.error || new Error(event.message));
});

window.addEventListener('unhandledrejection', (event) => {
  if (document.querySelector('.crash')) return;
  showCrash('异步出错', event.reason || new Error('未知原因'));
});

boot();

// 离线缓存 + 版本检查
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' 让浏览器每次都去问服务器 sw.js 有没有变
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}

checkForUpdate();
setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate(); }, 10 * 60 * 1000);

/** 发现新版本就直接换上：先存盘、记下位置，再重载，用户不用点任何东西。 */
async function checkForUpdate() {
  try {
    const response = await fetch('js/util.js?ts=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) return;
    const match = (await response.text()).match(/APP_VERSION = '([^']+)'/);
    if (!match) return;

    const remote = match[1];
    const { APP_VERSION: local } = await import('./util.js');
    if (remote === local) return;
    if (sessionStorage.getItem('duskReloadFor') === remote) return;

    await applyUpdate(remote);
  } catch {
    // 离线时不管
  }
}

async function applyUpdate(remote) {
  // 正在打字就先等一等，别把输入打断
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) {
    setTimeout(() => applyUpdate(remote), 5000);
    return;
  }

  try {
    sessionStorage.setItem('duskReloadFor', remote);
    sessionStorage.setItem('duskScroll', String(Math.round(window.scrollY)));
  } catch {}

  try {
    await flushSave();
  } catch {}

  location.reload();
}

// 回到前台时顺手检查一次
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});

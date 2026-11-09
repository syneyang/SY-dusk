// 登录 / 注册 / 从旧密码锁升级。

import * as db from './db.js';
import * as crypto from './crypto.js';
import * as auth from './auth.js';
import { el, toast } from './util.js';

const AUTO_LOCK_MS = 5 * 60 * 1000;
let lockTimer = null;

export async function requireUnlock(root) {
  document.body.classList.add('locked');

  const session = await auth.getSession();
  const legacyVault = await db.getMeta('vault', null);

  if (legacyVault && !session) {
    const masterRaw = await legacyPasscode(root, legacyVault);
    if (!masterRaw) return false;
    const ok = await registerScreen(root, masterRaw, { upgrading: true });
    if (!ok) return false;
  } else if (session) {
    const ok = await loginScreen(root, session);
    if (!ok) return false;
  } else {
    const ok = await registerScreen(root, crypto.randomBytes(32), { upgrading: false });
    if (!ok) return false;
  }

  if (await db.needsMigration()) await migrate(root);
  document.body.classList.remove('locked');
  return true;
}

export function lockNow() {
  location.hash = '#/today';
  location.reload();
}

export function startAutoLock() {
  clearTimeout(lockTimer);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lockTimer = setTimeout(() => {
        if (db.hasMasterKey()) lockNow();
      }, AUTO_LOCK_MS);
    } else {
      clearTimeout(lockTimer);
    }
  });
}

// ---------- 登录 ----------

function loginScreen(root, session) {
  return formScreen(root, {
    title: '解锁',
    subtitle: session.email,
    fields: [
      { key: 'password', label: '密码', type: 'password', placeholder: '至少 8 位', autofocus: true }
    ],
    action: '解锁',
    footer: el('button', { class: 'lock-link', onclick: () => switchAccount(root) }, '换一个账号'),
    submit: async ({ password }) => {
      const { masterRaw } = await auth.login(session.email, password);
      db.setMasterKey(await crypto.importMasterKey(masterRaw));
    }
  });
}

async function switchAccount(root) {
  await auth.signOut();
  location.reload();
}

// ---------- 注册 ----------

function registerScreen(root, masterRaw, { upgrading }) {
  return formScreen(root, {
    title: upgrading ? '给日记加一个账号' : '创建账号',
    subtitle: upgrading
      ? '旧密码已经验证过。设置邮箱和密码后，换设备登录就能看到这些日记。'
      : '邮箱只是账号名，不会给你发邮件。密码用来加密日记，忘记就找不回来。',
    fields: [
      { key: 'email', label: '邮箱', type: 'email', placeholder: 'you@example.com', autofocus: true },
      { key: 'password', label: '密码', type: 'password', placeholder: '至少 8 位，含字母和数字' },
      { key: 'confirm', label: '再输一次', type: 'password', placeholder: '确认密码' }
    ],
    action: '创建',
    submit: async ({ email, password, confirm }) => {
      if (!email.includes('@')) throw new Error('邮箱格式不对');
      const problem = auth.passwordProblem(password);
      if (problem) throw new Error(problem);
      if (password !== confirm) throw new Error('两次密码不一样');

      await auth.register(email, password, masterRaw);
      db.setMasterKey(await crypto.importMasterKey(masterRaw));
      await db.deleteMeta('vault');
    }
  });
}

// ---------- 旧密码锁 → 升级 ----------

function legacyPasscode(root, vault) {
  return new Promise((resolve) => {
    let value = '';

    root.innerHTML = '';
    const dots = el('div', { class: 'lock-dots' });
    const keypad = el('div', { class: 'keypad' });
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
      if (key === '') { keypad.append(el('div', { class: 'key-placeholder' })); continue; }
      keypad.append(el('button', { class: 'key', type: 'button', onclick: () => press(key) }, key));
    }

    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      el('div', { class: 'lock-title' }, '先输旧密码'),
      el('div', { class: 'lock-note' }, '你的日记还在旧的密码锁里。输一次，就能搬进账号。'),
      dots,
      keypad
    ));

    function renderDots() {
      dots.innerHTML = '';
      for (let i = 0; i < 6; i++) dots.append(el('span', { class: i < value.length ? 'on' : '' }));
    }
    renderDots();

    async function press(key) {
      if (key === '⌫') value = value.slice(0, -1);
      else if (value.length < 6) value += key;
      renderDots();
      if (value.length !== 6) return;

      try {
        const kek = await crypto.deriveKEK(value, crypto.fromB64(vault.salt), vault.iterations);
        resolve(await crypto.unwrapMasterKey(vault.wrapped, kek));
      } catch {
        toast('密码不对');
        value = '';
        renderDots();
      }
    }
  });
}

// ---------- 通用表单 ----------

function formScreen(root, { title, subtitle, fields, action, submit, footer }) {
  return new Promise((resolve) => {
    root.innerHTML = '';

    const inputs = {};
    const rows = fields.map((field) => {
      const input = el('input', {
        class: 'lock-field',
        type: field.type,
        placeholder: field.placeholder,
        autocomplete: field.type === 'password' ? 'current-password' : 'username',
        autocapitalize: 'off',
        spellcheck: 'false'
      });
      inputs[field.key] = input;
      return el('label', { class: 'lock-row' },
        el('span', { class: 'lock-row-label' }, field.label),
        input);
    });

    const error = el('div', { class: 'lock-error' });
    const button = el('button', { class: 'lock-btn' }, action);

    const run = async () => {
      if (button.disabled) return;
      button.disabled = true;
      error.textContent = '';
      try {
        const values = {};
        for (const [key, input] of Object.entries(inputs)) values[key] = input.value;
        await submit(values);
        resolve(true);
      } catch (e) {
        error.textContent = e.message || String(e);
      } finally {
        button.disabled = false;
      }
    };

    button.addEventListener('click', run);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') run();
    });

    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      el('div', { class: 'lock-title' }, title),
      el('div', { class: 'lock-note' }, subtitle),
      ...rows,
      error,
      button,
      footer || null
    ));

    const first = fields.find((f) => f.autofocus);
    if (first) setTimeout(() => inputs[first.key].focus(), 60);
  });
}

async function migrate(root) {
  const index = await db.entryIndex();
  const images = await db.allImages();
  const total = index.length + images.length;
  if (!total) return;

  root.innerHTML = '';
  const label = el('div', { class: 'lock-note' }, `正在整理 ${total} 项旧数据…`);
  root.append(el('div', { class: 'lock' },
    el('div', { class: 'lock-logo' }, '朝夕'),
    el('div', { class: 'lock-title' }, '稍等'),
    label));

  let done = 0;
  for (const item of index) {
    try {
      const entry = await db.getEntry(item.date);
      if (entry) await db.putEntry(entry);
    } catch { /* 单条失败不阻塞 */ }
    label.textContent = `正在整理… ${++done}/${total}`;
  }
  for (const image of images) {
    try { await db.putImage(image); } catch { /* 同上 */ }
    label.textContent = `正在整理… ${++done}/${total}`;
  }
  label.textContent = '好了。';
  await new Promise((r) => setTimeout(r, 400));
}

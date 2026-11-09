// 登录 / 注册 / 从旧密码锁升级。

import * as db from './db.js';
import * as crypto from './crypto.js';
import * as auth from './auth.js';
import { el, toast } from './util.js';

const AUTO_LOCK_MS = 5 * 60 * 1000;
let lockTimer = null;

export async function requireUnlock(root) {
  document.body.classList.add('locked');

  const localLock = await db.getMeta('localLock', null);

  // 首选：本机 6 位密码，快、不联网
  if (localLock) {
    const masterRaw = await passcodeGate(root, localLock);
    if (masterRaw) {
      await finish(masterRaw);
      return true;
    }
    // 忘了 → 落到账号找回
  }

  // 没有 6 位，或者忘了：用邮箱 + 密码（也是同步用的那个账号）
  const masterRaw = await accountGate(root);
  if (!masterRaw) return false;

  // 走到账号这条路，说明本机还没有可用的 6 位密码（或刚忘掉），一律重设一个
  await ensureLocalPasscode(root, masterRaw);
  await finish(masterRaw);
  return true;
}

async function finish(masterRaw) {
  db.setMasterKey(await crypto.importMasterKey(masterRaw));
  if (await db.needsMigration()) await migrate(document.getElementById('view'));
  document.body.classList.remove('locked');
}

// ---------- 6 位密码 ----------

const PASSCODE_ITERATIONS = 200000;

function passcodeScreen(root, { title, subtitle, confirm = false, forgot = false }) {
  return new Promise((resolve) => {
    let stage = 'first';
    let firstCode = '';
    let value = '';

    root.innerHTML = '';

    const dots = el('div', { class: 'lock-dots' });
    const titleNode = el('div', { class: 'lock-title' }, title);
    const subNode = el('div', { class: 'lock-note' }, subtitle);

    const keypad = el('div', { class: 'keypad' });
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
      if (key === '') {
        keypad.append(el('div', { class: 'key-placeholder' }));
        continue;
      }
      keypad.append(el('button', { class: 'key', type: 'button', onclick: () => press(key) }, key));
    }

    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      titleNode,
      subNode,
      dots,
      keypad,
      forgot
        ? el('button', { class: 'lock-link', onclick: () => resolve(null) }, '忘了 6 位密码？用邮箱找回')
        : null
    ));

    function renderDots() {
      dots.innerHTML = '';
      for (let i = 0; i < 6; i++) dots.append(el('span', { class: i < value.length ? 'on' : '' }));
    }
    renderDots();

    function press(key) {
      if (key === '⌫') value = value.slice(0, -1);
      else if (value.length < 6) value += key;
      renderDots();
      if (value.length === 6) setTimeout(submit, 90);
    }

    function submit() {
      if (value.length !== 6) return;
      if (!confirm) {
        resolve(value);
        return;
      }
      if (stage === 'first') {
        firstCode = value;
        value = '';
        stage = 'second';
        renderDots();
        titleNode.textContent = '再输一次';
        subNode.textContent = '确认一下刚刚的密码';
        return;
      }
      if (value === firstCode) {
        resolve(value);
      } else {
        toast('两次不一样，重来');
        stage = 'first';
        firstCode = '';
        value = '';
        renderDots();
        titleNode.textContent = title;
        subNode.textContent = subtitle;
      }
    }
  });
}

async function passcodeGate(root, localLock) {
  for (;;) {
    const code = await passcodeScreen(root, {
      title: '解锁',
      subtitle: '输入 6 位密码',
      forgot: true
    });
    if (code === null) return null;

    try {
      const kek = await crypto.deriveKEK(code, crypto.fromB64(localLock.salt), localLock.iterations);
      return await crypto.unwrapMasterKey(localLock.wrapped, kek);
    } catch {
      toast('密码不对');
    }
  }
}

async function ensureLocalPasscode(root, masterRaw) {
  const code = await passcodeScreen(root, {
    title: '再设一个 6 位密码',
    subtitle: '以后打开 App 用它，不用每次都输邮箱密码。',
    confirm: true
  });

  const salt = crypto.randomBytes(16);
  const kek = await crypto.deriveKEK(code, salt, PASSCODE_ITERATIONS);
  const wrapped = await crypto.wrapMasterKey(masterRaw, kek);
  await db.setMeta('localLock', {
    salt: crypto.toB64(salt),
    iterations: PASSCODE_ITERATIONS,
    wrapped,
    createdAt: Date.now()
  });
}

// ---------- 账号 ----------

async function accountGate(root) {
  const session = await auth.getSession();
  if (session) {
    const master = await loginScreen(root, session);
    return typeof master === 'string' ? null : master;
  }

  const vault = await db.getMeta('vault', null);
  if (vault) {
    const masterRaw = await legacyPasscode(root, vault);
    if (masterRaw) {
      const result = await registerScreen(root, masterRaw, { upgrading: true });
      return result === '__login__' || result === '__register__' ? null : masterRaw;
    }
  }

  for (;;) {
    const result = await registerScreen(root, crypto.randomBytes(32), { upgrading: false });
    if (result === '__login__') {
      const master = await loginWithEmail(root);
      if (master === '__register__') continue;
      return master;
    }
    return result;
  }
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
  let master = null;
  return formScreen(root, {
    title: '输入账号密码',
    subtitle: `${session.email} · 用来同步和找回 6 位密码`,
    fields: [
      { key: 'password', label: '密码', type: 'password', placeholder: '至少 8 位', autofocus: true }
    ],
    action: '解锁',
    footer: el('button', { class: 'lock-link', onclick: () => switchAccount(root) }, '换一个账号'),
    submit: async ({ password }) => {
      const { masterRaw } = await auth.login(session.email, password);
      master = masterRaw;
    }
  }).then((result) => (result === true ? master : result));
}

async function switchAccount(root) {
  await auth.signOut();
  location.reload();
}

// ---------- 注册 ----------

function registerScreen(root, masterRaw, { upgrading }) {
  let master = null;
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
    footer: (resolve) => el('button', { class: 'lock-link', onclick: () => resolve('__login__') }, '已有账号？去登录'),
    submit: async ({ email, password, confirm }) => {
      if (!email.includes('@')) throw new Error('邮箱格式不对');
      const problem = auth.passwordProblem(password);
      if (problem) throw new Error(problem);
      if (password !== confirm) throw new Error('两次密码不一样');

      await auth.register(email, password, masterRaw);
      await db.deleteMeta('vault');
      master = masterRaw;
    }
  }).then((result) => (result === true ? master : result));
}

// ---------- 已有账号：输入邮箱登录 ----------

function loginWithEmail(root) {
  let master = null;
  return formScreen(root, {
    title: '登录',
    subtitle: '输入注册时的邮箱和密码',
    fields: [
      { key: 'email', label: '邮箱', type: 'email', placeholder: 'you@example.com', autofocus: true },
      { key: 'password', label: '密码', type: 'password', placeholder: '至少 8 位' }
    ],
    action: '登录',
    footer: (resolve) => el('button', { class: 'lock-link', onclick: () => resolve('__register__') }, '没有账号？去注册'),
    submit: async ({ email, password }) => {
      const { masterRaw } = await auth.login(email, password);
      master = masterRaw;
    }
  }).then((result) => (result === true ? master : result));
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

    const footerNode = typeof footer === 'function' ? footer(resolve) : footer;

    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      el('div', { class: 'lock-title' }, title),
      el('div', { class: 'lock-note' }, subtitle),
      ...rows,
      error,
      button,
      footerNode || null
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

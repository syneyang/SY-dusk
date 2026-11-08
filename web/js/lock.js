// 锁：首次设置密码 + 恢复码；之后每次打开要先解锁。

import * as db from './db.js';
import * as crypto from './crypto.js';
import { el, toast } from './util.js';

const AUTO_LOCK_MS = 5 * 60 * 1000;
let lockTimer = null;

/** App 启动时调用。返回 true 表示已解锁，可以继续渲染。 */
export async function faceSupported() {
  try {
    return !!(window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export async function faceEnabled() {
  return !!(await db.getMeta('face', null));
}

export async function disableFace() {
  await db.deleteMeta('face');
}

/** 注册一个平台凭据，并把主密钥用随机设备密钥包一份存本地。 */
export async function enableFace(masterRaw) {
  if (!(await faceSupported())) throw new Error('这台设备不支持 Face ID');

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.randomBytes(32),
      rp: { id: location.hostname, name: '朝夕' },
      user: { id: crypto.randomBytes(16), name: 'dusk', displayName: '朝夕' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged'
      },
      timeout: 60000,
      attestation: 'none'
    }
  });
  if (!credential) throw new Error('没有完成注册');

  const deviceKeyRaw = crypto.randomBytes(32);
  const deviceKey = await crypto.importAesKey(deviceKeyRaw);
  const wrapped = await crypto.wrapMasterKey(masterRaw, deviceKey);

  await db.setMeta('face', {
    credentialId: crypto.toB64(new Uint8Array(credential.rawId)),
    deviceKey: crypto.toB64(deviceKeyRaw),
    wrapped
  });
}

export async function requireUnlock(root) {
  document.body.classList.add('locked');
  const vault = await db.getMeta('vault', null);
  if (!vault) return setupFlow(root);
  return unlockFlow(root, vault);
}

/** 手动上锁 / 超时上锁：直接重载页面，内存里的密钥就没了。 */
export function lockNow() {
  location.hash = '#/today';
  location.reload();
}

export function startAutoLock() {
  stopAutoLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(lockTimer);
      lockTimer = setTimeout(() => {
        if (!db.hasMasterKey()) return;
        lockNow();
      }, AUTO_LOCK_MS);
    } else {
      clearTimeout(lockTimer);
    }
  });
}

function stopAutoLock() {
  clearTimeout(lockTimer);
}

async function buildVault(masterRaw, passcode, recoveryCode) {
  const salt = crypto.randomBytes(16);
  const kek = await crypto.deriveKEK(passcode, salt);
  const wrapped = await crypto.wrapMasterKey(masterRaw, kek);

  const recoverySalt = crypto.randomBytes(16);
  const recoveryKek = await crypto.deriveKEK(crypto.normalizeRecoveryCode(recoveryCode), recoverySalt);
  const recoveryWrapped = await crypto.wrapMasterKey(masterRaw, recoveryKek);

  return {
    v: 1,
    salt: crypto.toB64(salt),
    iterations: crypto.KDF_ITERATIONS,
    wrapped,
    recoverySalt: crypto.toB64(recoverySalt),
    recoveryIterations: crypto.KDF_ITERATIONS,
    recoveryWrapped,
    createdAt: Date.now()
  };
}

// ---------- 首次设置 ----------

async function setupFlow(root) {
  const passcode = await askPasscode(root, {
    title: '给日记上把锁',
    subtitle: '设一个 6 位数字密码。它不会存在任何地方，只用来解锁你的日记。',
    confirm: true
  });

  const masterRaw = crypto.randomBytes(32);
  const recoveryCode = crypto.makeRecoveryCode();
  const vault = await buildVault(masterRaw, passcode, recoveryCode);

  await db.setMeta('vault', vault);
  db.setMasterKey(await crypto.importMasterKey(masterRaw));

  await showRecovery(root, recoveryCode);
  await migrate(root);
  if (await faceSupported()) await offerFace(root, masterRaw);
  document.body.classList.remove('locked');
  return true;
}

function showRecovery(root, code) {
  return new Promise((resolve) => {
    root.innerHTML = '';
    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      el('div', { class: 'lock-title' }, '这串恢复码，请抄下来'),
      el('div', { class: 'lock-note' },
        '忘了密码时，只有它能救回你的日记。截图、抄在纸上、存进密码管理器都行——但别只存在这台手机里。'),
      el('div', { class: 'recovery-code' }, code),
      el('button', {
        class: 'lock-btn',
        onclick: () => resolve()
      }, '我已经抄好了')
    ));
  });
}

async function migrate(root) {
  if (!(await db.needsMigration())) return;

  const index = await db.entryIndex();
  const images = await db.allImages();
  const total = index.length + images.length;
  if (!total) return;

  root.innerHTML = '';
  const label = el('div', { class: 'lock-note' }, `正在把 ${total} 项旧数据加密…`);
  root.append(el('div', { class: 'lock' },
    el('div', { class: 'lock-logo' }, '朝夕'),
    el('div', { class: 'lock-title' }, '加密中'),
    label
  ));

  let done = 0;
  for (const item of index) {
    try {
      const entry = await db.getEntry(item.date);
      if (entry) await db.putEntry(entry);
    } catch {
      // 单条失败不阻塞
    }
    label.textContent = `正在加密… ${++done}/${total}`;
  }
  for (const image of images) {
    try {
      await db.putImage(image);
    } catch {
      // 同上
    }
    label.textContent = `正在加密… ${++done}/${total}`;
  }

  label.textContent = '好了，全部加密完成。';
  await new Promise((r) => setTimeout(r, 600));
}

// ---------- 解锁 ----------

async function unlockFlow(root, vault) {
  const faceMeta = await db.getMeta('face', null);
  if (faceMeta && (await faceSupported())) {
    const masterRaw = await faceGate(root, faceMeta);
    if (masterRaw) {
      db.setMasterKey(await crypto.importMasterKey(masterRaw));
      await migrate(root);
      document.body.classList.remove('locked');
      return true;
    }
  }

  for (;;) {
    const passcode = await askPasscode(root, {
      title: '解锁',
      subtitle: '输入 6 位密码',
      allowRecovery: true
    });

    if (passcode === '__recovery__') {
      const recovered = await recoveryFlow(root, vault);
      if (recovered) return true;
      continue;
    }

    try {
      const kek = await crypto.deriveKEK(passcode, crypto.fromB64(vault.salt), vault.iterations);
      const masterRaw = await crypto.unwrapMasterKey(vault.wrapped, kek);
      db.setMasterKey(await crypto.importMasterKey(masterRaw));
      await migrate(root);
      document.body.classList.remove('locked');
      return true;
    } catch {
      toast('密码不对');
    }
  }
}

async function recoveryFlow(root, vault) {
  const code = await promptText(root, {
    title: '用恢复码解锁',
    subtitle: '输入开户时那串恢复码（大小写、横线都不影响）',
    placeholder: 'K7QM3-XZP9V-RT2WH-D8JNC',
    action: '解锁'
  });
  if (!code) return false;

  try {
    const kek = await crypto.deriveKEK(
      crypto.normalizeRecoveryCode(code),
      crypto.fromB64(vault.recoverySalt),
      vault.recoveryIterations
    );
    const masterRaw = await crypto.unwrapMasterKey(vault.recoveryWrapped, kek);

    const newPasscode = await askPasscode(root, {
      title: '设一个新的密码',
      subtitle: '旧的密码已经没用了，重新设一个 6 位数字密码',
      confirm: true
    });

    const salt = crypto.randomBytes(16);
    const newKek = await crypto.deriveKEK(newPasscode, salt);
    const wrapped = await crypto.wrapMasterKey(masterRaw, newKek);
    await db.setMeta('vault', {
      ...vault,
      salt: crypto.toB64(salt),
      iterations: crypto.KDF_ITERATIONS,
      wrapped
    });

    db.setMasterKey(await crypto.importMasterKey(masterRaw));
    document.body.classList.remove('locked');
    return true;
  } catch {
    toast('恢复码不对');
    return false;
  }
}

// ---------- Face ID ----------

function offerFace(root, masterRaw) {
  return new Promise((resolve) => {
    root.innerHTML = '';
    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      el('div', { class: 'lock-title' }, '要不要用 Face ID 打开？'),
      el('div', { class: 'lock-note' },
        '开启后，打开 App 先扫脸，不用每次输密码。密码仍然是最后的保险。'),
      el('button', {
        class: 'lock-btn',
        onclick: async () => {
          try {
            await enableFace(masterRaw);
            toast('已开启 Face ID');
          } catch (error) {
            toast('没开成：' + (error.message || error));
          }
          resolve();
        }
      }, '开启 Face ID'),
      el('button', { class: 'lock-link', onclick: () => resolve() }, '以后再说')
    ));
  });
}

/** 设置页里开启 Face ID：先验一次密码，拿到主密钥再注册。 */
export async function enableFaceFlow(root) {
  const vault = await db.getMeta('vault', null);
  if (!vault) return false;
  if (!(await faceSupported())) {
    toast('这台设备不支持 Face ID');
    return false;
  }

  const passcode = await askPasscode(root, { title: '验证一下密码', subtitle: '开启 Face ID 之前，先输一次密码' });
  try {
    const kek = await crypto.deriveKEK(passcode, crypto.fromB64(vault.salt), vault.iterations);
    const masterRaw = await crypto.unwrapMasterKey(vault.wrapped, kek);
    await enableFace(masterRaw);
    toast('已开启 Face ID');
    return true;
  } catch {
    toast('密码不对');
    return false;
  }
}

function faceGate(root, faceMeta) {
  return new Promise((resolve) => {
    root.innerHTML = '';
    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      el('div', { class: 'lock-title' }, '解锁'),
      el('div', { class: 'lock-note' }, '轻点下面的按钮，用 Face ID 打开'),
      el('button', {
        class: 'lock-btn',
        onclick: async () => {
          try {
            const assertion = await navigator.credentials.get({
              publicKey: {
                challenge: crypto.randomBytes(32),
                allowCredentials: [{ id: crypto.fromB64(faceMeta.credentialId), type: 'public-key' }],
                userVerification: 'required',
                timeout: 60000
              }
            });
            if (!assertion) { resolve(null); return; }
            const deviceKey = await crypto.importAesKey(crypto.fromB64(faceMeta.deviceKey));
            resolve(await crypto.unwrapMasterKey(faceMeta.wrapped, deviceKey));
          } catch {
            resolve(null);
          }
        }
      }, '用 Face ID 解锁'),
      el('button', { class: 'lock-link', onclick: () => resolve(null) }, '改用密码')
    ));
    // 用户可能想直接输密码，先不自动弹人脸
  });
}

// ---------- 通用输入界面 ----------

function askPasscode(root, { title, subtitle, confirm = false, allowRecovery = false }) {
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
      allowRecovery
        ? el('button', { class: 'lock-link', onclick: () => resolve('__recovery__') }, '忘了密码？用恢复码')
        : null
    ));

    function renderDots() {
      dots.innerHTML = '';
      for (let i = 0; i < 6; i++) {
        dots.append(el('span', { class: i < value.length ? 'on' : '' }));
      }
    }
    renderDots();

    function press(key) {
      if (key === '⌫') {
        value = value.slice(0, -1);
      } else if (value.length < 6) {
        value += key;
      }
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

function promptText(root, { title, subtitle, placeholder, action }) {
  return new Promise((resolve) => {
    root.innerHTML = '';
    const input = el('input', {
      class: 'lock-text',
      type: 'text',
      placeholder,
      autocomplete: 'off',
      autocapitalize: 'characters'
    });
    root.append(el('div', { class: 'lock' },
      el('div', { class: 'lock-logo' }, '朝夕'),
      el('div', { class: 'lock-title' }, title),
      el('div', { class: 'lock-note' }, subtitle),
      input,
      el('button', { class: 'lock-btn', onclick: () => resolve(input.value.trim()) }, action)
    ));
    setTimeout(() => input.focus(), 50);
  });
}

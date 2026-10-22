// DOM helpers, icons, toasts, dialogs and menus.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  select: '<path d="M5 3l14 8-6.2 1.8L10 19z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v7M8 13l-1.6-1.8a1.6 1.6 0 0 0-2.5 2l3.1 4.3A6 6 0 0 0 11.9 20H13a5 5 0 0 0 5-5v-2"/>',
  brush: '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8.2 13zM7 14c-2 0-3 1.5-3 3s-1 2.5-2 3c3 1 7 0 7-4z"/>',
  eraser: '<path d="M7 21h12M5.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 20H7.5l-2-2a1.8 1.8 0 0 1 0-2.5zM9.5 11.5l5 5"/>',
  fill: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z" fill="currentColor" fill-opacity=".25"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  lasso: '<path d="M7.5 16.5C4.5 15.3 3.3 13 4.2 10.5 5.5 6.6 10 4.6 14.5 5.5s6.6 4 5 7.6c-1.2 2.7-5 4-8.5 3.4"/><circle cx="7.5" cy="17.5" r="1.6"/><path d="M7 19.2c0 1.4 1 2.3 2.5 2.3"/>',
  eyedropper: '<path d="M13.5 5.5l5 5L9 20H4v-5zM17.5 2.5a2.1 2.1 0 0 1 3 3L18 8l-2-2zM15 4l5 5"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  first: '<path d="M6 5v14M17 6l-6 6 6 6"/>',
  last: '<path d="M18 5v14M7 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" opacity=".35"/><path d="M3 3l18 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2" opacity=".45"/><path d="M8 11V7a4 4 0 0 1 7.5-2" opacity=".45"/>',
  onion: '<circle cx="9" cy="12" r="6" opacity=".5"/><circle cx="15" cy="12" r="6"/>',
  loop: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  save: '<path d="M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7"/>',
  export: '<path d="M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  figure: '<circle cx="12" cy="5" r="2.6"/><path d="M12 7.6v7M12 14.6l-4 6M12 14.6l4 6M7 11h10"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  library: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  sliders: '<path d="M4 6h10M18 6h2M16 4v4M4 12h4M12 12h8M10 10v4M4 18h12M18 16v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
  flip: '<path d="M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  bone: '<path d="M8 16l8-8"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-9 8"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  sprite: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  frames: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/>',
  stretch: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  ik: '<path d="M5 19l5-7 9 1"/><circle cx="5" cy="19" r="1.8"/><circle cx="10" cy="12" r="1.8"/><circle cx="19" cy="13" r="1.8"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  new: '<path d="M6 3h8l5 5v13H6zM14 3v5h5M12 11v6M9 14h6"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3"/>',
  scissors: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.5 8.5L20 19M8.5 15.5L20 5"/>',
  camera: '<rect x="2" y="7" width="13" height="10" rx="2"/><path d="M15 11l6-3.5v9L15 13z"/>',
  ruler: '<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l2 2M10 9.5l1.5 1.5M12.5 7l2 2"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2.5 2.5"/><path d="M9.5 7L4 17h5.5zM14.5 7L20 17h-5.5z"/>',
  circle: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 2.5"/><path d="M12 10v4M10 12h4"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5"/>',
};

export function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('icon');
  s.innerHTML = P[name] || '';
  return s;
}

// Icon button. `title` doubles as the accessible label and tooltip.
export function ibtn(name, title, onclick, cls = '') {
  return h('button', { class: `ibtn ${cls}`, title, 'aria-label': title, onclick, type: 'button' }, icon(name));
}

// ---- toasts ----
let toastHost;
export function toast(msg, { kind = 'info', ms = 2600 } = {}) {
  toastHost ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const tl = document.getElementById('timeline');
  if (tl) toastHost.style.bottom = `${innerHeight - tl.getBoundingClientRect().top + 14}px`;
  while (toastHost.children.length > 1) toastHost.firstChild.remove();
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastHost.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---- dialogs ----
export function openDialog({ title, body, actions = [], wide = false, onClose, cls = '' }) {
  const prevFocus = document.activeElement;
  const dlg = h('dialog', { class: `dlg ${wide ? 'wide' : ''} ${cls}` });
  const close = (val) => {
    if (!dlg.open) return;
    dlg.close();
    dlg.remove();
    onClose && onClose(val);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const head = h('div', { class: 'dlg-head' }, h('h2', {}, title), ibtn('close', 'Close (Esc)', () => close(null), 'ghost'));
  const foot = actions.length
    ? h('div', { class: 'dlg-foot' }, actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, type: 'button', onclick: () => a.run ? a.run(close) : close(a.value) }, a.label)))
    : null;
  dlg.append(head, h('div', { class: 'dlg-body' }, body));
  if (foot) dlg.append(foot);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close(null);
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

export function confirmDialog(message, { title = 'Are you sure?', ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const { dlg } = openDialog({
      title,
      body: h('p', {}, message),
      actions: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }],
      onClose: (v) => resolve(!!v),
    });
    dlg.querySelector('.dlg-foot .btn:last-child').focus();
  });
}

export function promptDialog(title, value = '', { ok = 'OK', label = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', class: 'text', value, 'aria-label': label || title });
    let result = null;
    const { close } = openDialog({
      title,
      body: h('label', { class: 'field col' }, label ? h('span', {}, label) : null, input),
      actions: [{ label: 'Cancel', value: null }, { label: ok, primary: true, run: (c) => { result = input.value.trim(); c(result); } }],
      onClose: () => resolve(result || null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        result = input.value.trim();
        close(result);
      }
    });
    input.focus();
    input.select();
  });
}

// ---- popup menus (keyboard navigable) ----
let openMenuEl = null;
export function closeMenu() {
  if (openMenuEl) {
    openMenuEl._restore?.focus?.();
    openMenuEl.remove();
    openMenuEl = null;
  }
}
export function popupMenu(anchor, items) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  m._restore = document.activeElement;
  for (const it of items) {
    if (it === '-') {
      m.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    m.append(
      h('button', {
        class: 'menu-item', role: 'menuitem', type: 'button', disabled: it.disabled,
        onclick: () => { closeMenu(); it.run(); },
      }, it.icon ? icon(it.icon, 16) : h('span', { class: 'icon-sp' }), h('span', { class: 'menu-label' }, it.label), it.keys ? h('kbd', {}, it.keys) : null),
    );
  }
  place(m, anchor);
  const buttons = () => [...m.querySelectorAll('.menu-item:not([disabled])')];
  buttons()[0]?.focus();
  m.addEventListener('keydown', (e) => {
    const b = buttons(), i = b.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') b[(i + 1) % b.length].focus();
    else if (e.key === 'ArrowUp') b[(i - 1 + b.length) % b.length].focus();
    else if (e.key === 'Escape' || e.key === 'Tab') closeMenu();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return m;
}

function place(m, anchor) {
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = r.left, y = r.bottom + 4;
  if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  m.style.left = `${Math.max(8, x)}px`;
  m.style.top = `${y}px`;
  openMenuEl = m;
  setTimeout(() => {
    const off = (e) => {
      if (openMenuEl === m && !m.contains(e.target)) closeMenu();
      if (openMenuEl !== m) document.removeEventListener('pointerdown', off, true);
    };
    document.addEventListener('pointerdown', off, true);
  });
}

// Floating panel with arbitrary content (closes on outside tap or Escape).
export function popover(anchor, content) {
  closeMenu();
  const m = h('div', { class: 'menu pop', role: 'dialog' }, content);
  m._restore = document.activeElement;
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      e.preventDefault();
    }
    e.stopPropagation();
  });
  place(m, anchor);
  return m;
}

export const isTyping = (el = document.activeElement) =>
  el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes(el.type)) || el.tagName === 'SELECT');

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMac = /Mac/.test(navigator.platform) && !isIOS;

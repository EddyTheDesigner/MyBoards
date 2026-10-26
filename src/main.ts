import './style.css';
import { icon } from './icons';
import { mountLibrary } from './library';
import type { BoardLibrary } from './library';
import { createWorkspace, createBoard, createItem, defaultTextStyle, normalizeWorkspace, clone, connectItems, connectionSegments, insertIntoConnection, reorderChains } from './model';
import type { Board, Item, MediaAsset, Point, TextStyle, Workspace } from './model';
import { native, loadWorkspace, saveWorkspace, importFile, importPaths, assetUrl, storagePath } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const button = (id: string, glyph: string, label: string, extra = '') => `<button class="icon-button" id="${id}" aria-label="${label}" title="${label}" ${extra}>${icon(glyph)}</button>`;

$('#app').innerHTML = `
  <header class="topbar">
    <div class="top-start">${button('boards-toggle', 'boards', 'Boards')}<span class="brand">${icon('logo')}<span>MyBoards</span></span><span class="divider"></span><input id="board-name" aria-label="Board name" spellcheck="false" maxlength="80" /><span id="save-status" role="status" aria-label="Loading" title="Loading"></span></div>
    <div class="top-end">${button('undo', 'undo', 'Undo (Ctrl / ⌘ Z)')}${button('redo', 'redo', 'Redo (Ctrl / ⌘ Shift Z)')}<span class="divider"></span>${button('settings', 'settings', 'Settings')}</div>
  </header>
  <main id="canvas" tabindex="0" aria-label="Board canvas. Press T to add text, V to select, H to pan.">
    <div id="world"><svg id="connections" aria-hidden="true"></svg><div id="items"></div></div>
    <div id="marquee" hidden></div>
    <div id="empty-hint"><span>${icon('logo')}</span><p>Drop images & videos, or press <kbd>T</kbd> for text</p></div>
    <div id="drop-hint" hidden>${icon('media')}<span>Add to board</span></div>
  </main>
  <aside id="board-panel" class="floating-panel" hidden><div class="panel-heading"><span>Boards</span>${button('new-board', 'plus', 'New board')}</div><div id="board-list"></div></aside>
  <div id="text-toolbar" class="toolbar text-toolbar" role="toolbar" aria-label="Text formatting" hidden>
    <select id="font-family" aria-label="Font family"><option value="sans-serif">Sans</option><option value="serif">Serif</option><option value="monospace">Mono</option></select>
    <input id="font-size" type="number" min="12" max="144" step="1" aria-label="Font size" />
    <span class="divider"></span>${button('bold', 'bold', 'Bold')}${button('italic', 'italic', 'Italic')}
    <span class="divider"></span>${button('align', 'left', 'Text alignment')}
    <label class="color-control" title="Text color"><input id="text-color" type="color" aria-label="Text color" /><span>A</span></label>
    <label class="color-control background-control" title="Text background"><input id="text-background" type="color" aria-label="Text background" /><span></span></label>
    ${button('clear-background', 'minus', 'Clear text background')}
  </div>
  <div class="toolbar main-toolbar" role="toolbar" aria-label="Board tools">
    ${button('tool-select', 'select', 'Select (V)', 'aria-pressed="true"')}${button('tool-hand', 'hand', 'Pan (H / hold Space)')}
    <span class="divider"></span>${button('tool-text', 'text', 'Add text (T)')}${button('import-media', 'media', 'Add images or videos')}
    <span class="divider"></span>${button('connect', 'link', 'Connect selected objects (Ctrl / ⌘ K)')}
  </div>
  <div class="zoom-control toolbar">${button('zoom-out', 'minus', 'Zoom out')}<button id="zoom-reset" title="Reset zoom">100%</button>${button('zoom-in', 'plus', 'Zoom in')}<span class="divider"></span>${button('zoom-fit', 'fit', 'Fit board (F)')}</div>
  <div class="bottom-left">${button('help', 'help', 'Keyboard shortcuts')}</div>
  <div id="context-menu" class="floating-panel context-menu" role="menu" hidden></div>
  <div id="toast" role="status" hidden></div>
  <dialog id="settings-dialog"><div class="dialog-header"><h2>Settings</h2>${button('settings-close', 'close', 'Close settings')}</div>
    <label class="setting-title">Appearance</label><div class="theme-options"><button data-theme="dark">${icon('moon')}Dark</button><button data-theme="light">${icon('sun')}Light</button></div>
    <label class="setting-title">Accent color</label><div class="swatches">${['#a78bfa', '#7c9bff', '#59c9b3', '#e8b76b', '#ed8fa6', '#cfdb78'].map(color => `<button class="swatch" data-accent="${color}" style="--swatch:${color}" aria-label="Accent ${color}"></button>`).join('')}<label class="custom-swatch" title="Custom accent">${icon('plus')}<input id="accent-color" type="color" aria-label="Custom accent color" /></label></div>
    <label class="setting-row" for="show-grid"><span>Canvas dots</span><input id="show-grid" type="checkbox" role="switch" /></label>
    <div class="storage-info"><span>Saved on this device</span><p id="storage-location"></p></div>
  </dialog>
  <dialog id="help-dialog"><div class="dialog-header"><h2>Shortcuts</h2>${button('help-close', 'close', 'Close shortcuts')}</div><dl class="shortcuts">
    <dt>Select / pan / text</dt><dd><kbd>V</kbd> <kbd>H</kbd> <kbd>T</kbd></dd><dt>Pan</dt><dd><kbd>Space</kbd> + drag</dd><dt>Zoom</dt><dd><kbd>Ctrl / ⌘</kbd> + scroll</dd><dt>Multi-select</dt><dd><kbd>Shift</kbd> + click / drag</dd><dt>Connect selection</dt><dd><kbd>Ctrl / ⌘</kbd> <kbd>K</kbd></dd><dt>Duplicate</dt><dd><kbd>Ctrl / ⌘</kbd> <kbd>D</kbd></dd><dt>Undo / redo</dt><dd><kbd>Ctrl / ⌘</kbd> <kbd>Z</kbd> / <kbd>Shift Z</kbd></dd><dt>Fit board</dt><dd><kbd>F</kbd></dd><dt>Edit text</dt><dd>Double-click / <kbd>Enter</kbd></dd><dt>Delete selection</dt><dd><kbd>Delete</kbd></dd>
    </dl><p class="help-note">Right-click a selection to connect it. Drag an object onto a line to insert it into the chain. Connections follow the objects’ positions.</p></dialog>
  <input id="file-input" type="file" accept="image/*,video/*" multiple hidden />
`;

const canvas = $('#canvas');
const world = $('#world');
const itemsLayer = $('#items');
let workspace: Workspace = createWorkspace();
let ready = false;
let selection = new Set<string>();
let tool: 'select' | 'hand' | 'text' = 'select';
let spaceDown = false;
let editingId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let dirty = false;
let saveRevision = 0;
let histories: Workspace[] = [];
let futures: Workspace[] = [];
let copied: Item[] = [];
let clipboardToken = '';
const elements = new Map<string, HTMLElement>();
const mediaUrls = new Map<string, string>();
let pendingImport = false;
let nativeTheme: string | undefined;
let library: BoardLibrary;

function board(): Board { return workspace.boards.find(value => value.id === workspace.activeBoardId)!; }
function selectedItems() { return board().items.filter(item => selection.has(item.id)); }
function checkpoint() { histories.push(clone(workspace)); if (histories.length > 60) histories.shift(); futures = []; }
function markSaved(label: string, state: string) { const el = $('#save-status'); el.dataset.state = state; el.title = label; el.setAttribute('aria-label', label); }
function changed() { if (!ready) return; dirty = true; saveRevision++; markSaved('Saving…', 'saving'); clearTimeout(saveTimer); saveTimer = setTimeout(() => void flushSave(), 350); renderChrome(); }
async function flushSave() {
  if (!dirty || !ready) return;
  const revision = saveRevision;
  try { await saveWorkspace(workspace); if (revision === saveRevision) { dirty = false; markSaved('Saved on this device', 'saved'); } }
  catch (error) { markSaved('Save failed — click to retry', 'error'); toast(`Could not save: ${errorText(error)}`, 6000); }
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function toast(message: string, duration = 3400) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration); }
function screenToWorld(clientX: number, clientY: number): Point { const r = canvas.getBoundingClientRect(); const v = board().viewport; return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom }; }
function center(): Point { const r = canvas.getBoundingClientRect(); return screenToWorld(r.left + r.width / 2, r.top + r.height / 2); }

function applyTheme() {
  document.documentElement.dataset.theme = workspace.settings.theme;
  document.documentElement.style.setProperty('--accent', workspace.settings.accent);
  canvas.classList.toggle('no-grid', !workspace.settings.grid);
  if (native && nativeTheme !== workspace.settings.theme) {
    nativeTheme = workspace.settings.theme;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTheme(workspace.settings.theme)).catch(error => console.warn('Could not update window appearance', error));
  }
  $('#show-grid') instanceof HTMLInputElement && ($('#show-grid') as HTMLInputElement).checked !== workspace.settings.grid && (($('#show-grid') as HTMLInputElement).checked = workspace.settings.grid);
  $('#accent-color').setAttribute('value', workspace.settings.accent);
  document.querySelectorAll<HTMLElement>('[data-theme]').forEach(el => { if (el.tagName === 'BUTTON') el.classList.toggle('active', el.dataset.theme === workspace.settings.theme); });
  document.querySelectorAll<HTMLElement>('[data-accent]').forEach(el => el.classList.toggle('active', el.dataset.accent === workspace.settings.accent));
}

function renderViewport() {
  const v = board().viewport;
  world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;
  canvas.style.backgroundSize = `${24 * v.zoom}px ${24 * v.zoom}px`;
  canvas.style.backgroundPosition = `${v.x}px ${v.y}px`;
  canvas.style.setProperty('--inverse-zoom', String(1 / v.zoom));
  $('#zoom-reset').textContent = `${Math.round(v.zoom * 100)}%`;
}

function renderConnections() {
  $('#connections').innerHTML = connectionSegments(board()).map(segment => `<g><line x1="${segment.start.x}" y1="${segment.start.y}" x2="${segment.end.x}" y2="${segment.end.y}"/><circle cx="${segment.start.x}" cy="${segment.start.y}" r="3"/><circle cx="${segment.end.x}" cy="${segment.end.y}" r="3"/></g>`).join('');
}

function renderNodes() {
  const valid = new Set(board().items.map(item => item.id));
  for (const [id, element] of elements) { if (!valid.has(id)) { const video = element.querySelector('video'); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } element.remove(); elements.delete(id); } }
  for (const [index, item] of board().items.entries()) {
    let element = elements.get(item.id);
    if (!element) {
      element = document.createElement('div'); element.className = `board-item ${item.kind}-item`; element.dataset.id = item.id; element.setAttribute('role', 'group');
      const content = document.createElement(item.kind === 'text' ? 'div' : item.kind === 'image' ? 'img' : 'video'); content.className = 'item-content';
      if (content instanceof HTMLImageElement) { content.draggable = false; content.alt = 'Board image'; content.addEventListener('error', () => { element!.classList.add('media-error'); toast('This image could not be displayed. Try PNG, JPEG, or WebP.'); }); }
      if (content instanceof HTMLVideoElement) { content.controls = true; content.preload = 'metadata'; content.playsInline = true; content.addEventListener('error', () => { element!.classList.add('media-error'); toast('This video format could not be played. Try an MP4 or WebM supported by your system.'); }); }
      if (item.kind === 'text') {
        content.setAttribute('spellcheck', 'true');
        content.addEventListener('input', () => { const current = board().items.find(i => i.id === item.id); if (current) { current.text = content.innerText; current.height = Math.max(current.height, content.scrollHeight); element!.style.height = `${current.height}px`; renderConnections(); changed(); } });
        content.addEventListener('blur', event => { const focus = event as FocusEvent; if (!(focus.relatedTarget instanceof Node) || !$('#text-toolbar').contains(focus.relatedTarget)) finishEditing(); });
      }
      element.append(content);
      if (item.kind === 'video') { const grip = document.createElement('div'); grip.className = 'video-grip'; grip.title = 'Move video'; grip.innerHTML = icon('grid'); element.append(grip); }
      const handle = document.createElement('div'); handle.className = 'resize-handle'; handle.title = 'Resize'; element.append(handle);
      itemsLayer.append(element); elements.set(item.id, element);
    }
    Object.assign(element.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, zIndex: String(index + 1) });
    element.classList.toggle('selected', selection.has(item.id)); element.classList.toggle('editing', editingId === item.id); element.setAttribute('aria-selected', String(selection.has(item.id)));
    const content = element.querySelector<HTMLElement>('.item-content')!;
    if (item.kind === 'text') {
      const style = { ...defaultTextStyle(), ...item.style };
      Object.assign(content.style, { fontSize: `${style.fontSize}px`, fontFamily: style.fontFamily, color: style.color, fontWeight: style.bold ? '700' : '400', fontStyle: style.italic ? 'italic' : 'normal', textAlign: style.align, background: style.background });
      if (editingId !== item.id && content.innerText !== (item.text ?? '')) content.textContent = item.text ?? '';
      element.setAttribute('aria-label', item.text || 'Empty text');
    } else if (item.assetId && content.dataset.asset !== item.assetId) {
      content.dataset.asset = item.assetId;
      const asset = workspace.assets.find(a => a.id === item.assetId);
      if (asset) {
        element.setAttribute('aria-label', asset.name);
        void assetUrl(asset).then(url => { mediaUrls.set(asset.id, url); (content as HTMLImageElement | HTMLVideoElement).src = url; }).catch(error => { element!.classList.add('media-error'); toast(errorText(error)); });
      }
    }
  }
  $('#empty-hint').hidden = board().items.length > 0;
}

function renderChrome() {
  $('#connect').toggleAttribute('disabled', selection.size < 2);
  $('#undo').toggleAttribute('disabled', !histories.length); $('#redo').toggleAttribute('disabled', !futures.length);
  const texts = selectedItems().filter(i => i.kind === 'text');
  $('#text-toolbar').hidden = texts.length === 0 || texts.length !== selection.size;
  if (texts.length) {
    const style = { ...defaultTextStyle(), ...texts[0].style };
    if (document.activeElement !== $('#font-size')) ($('#font-size') as HTMLInputElement).value = String(style.fontSize);
    ($('#font-family') as HTMLSelectElement).value = style.fontFamily;
    $('#bold').classList.toggle('active', style.bold); $('#italic').classList.toggle('active', style.italic);
    $('#bold').setAttribute('aria-pressed', String(style.bold)); $('#italic').setAttribute('aria-pressed', String(style.italic));
    $('#align').innerHTML = icon(style.align); $('#align').title = `Alignment: ${style.align}`;
    ($('#text-color') as HTMLInputElement).value = style.color.startsWith('#') ? style.color : workspace.settings.theme === 'dark' ? '#e8e8ec' : '#272830';
    ($('#text-background') as HTMLInputElement).value = style.background.startsWith('#') ? style.background : workspace.settings.theme === 'dark' ? '#25262c' : '#eeeef3';
    $('.background-control').classList.toggle('transparent', style.background === 'transparent');
  }
}

function renderBoardList() {
  library.render();
}
function render() { applyTheme(); renderViewport(); renderNodes(); renderConnections(); renderChrome(); renderBoardList(); ($('#board-name') as HTMLInputElement).value = board().name; }
function setTool(value: typeof tool) { finishEditing(); tool = value; canvas.dataset.tool = value; for (const name of ['select', 'hand', 'text']) { $(`#tool-${name}`).classList.toggle('active', name === value); $(`#tool-${name}`).setAttribute('aria-pressed', String(name === value)); } }
function setSelection(ids: string[]) { selection = new Set(ids); renderNodes(); renderChrome(); }

function startEditing(id: string) {
  const item = board().items.find(i => i.id === id); if (!item || item.kind !== 'text') return;
  if (editingId === id) return;
  finishEditing(); checkpoint(); editingId = id; setSelection([id]);
  const content = elements.get(id)!.querySelector<HTMLElement>('.item-content')!;
  content.setAttribute('contenteditable', 'plaintext-only'); content.focus();
  const range = document.createRange(); range.selectNodeContents(content); range.collapse(false); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
}
function finishEditing() {
  if (!editingId) return;
  const id = editingId; editingId = null;
  const content = elements.get(id)?.querySelector<HTMLElement>('.item-content'); content?.removeAttribute('contenteditable'); elements.get(id)?.classList.remove('editing');
  const item = board().items.find(i => i.id === id); if (item && !item.text?.trim()) { board().items = board().items.filter(i => i.id !== id); board().chains.forEach(c => c.itemIds = c.itemIds.filter(i => i !== id)); board().chains = board().chains.filter(c => c.itemIds.length > 1); selection.delete(id); renderNodes(); }
  changed(); renderChrome();
}
function addText(point = center(), text = '') { finishEditing(); checkpoint(); const item = createItem('text', point.x, point.y); item.text = text; board().items.push(item); setTool('select'); setSelection([item.id]); changed(); if (!text) startEditing(item.id); }
function formatText(patch: Partial<TextStyle>) { const texts = selectedItems().filter(i => i.kind === 'text'); if (!texts.length) return; checkpoint(); for (const item of texts) item.style = { ...defaultTextStyle(), ...item.style, ...patch }; changed(); renderNodes(); renderChrome(); }
function connect() { if (selection.size < 2) return; finishEditing(); checkpoint(); connectItems(board(), [...selection]); changed(); renderConnections(); }
function disconnect() { checkpoint(); board().chains = board().chains.map(c => ({ ...c, itemIds: c.itemIds.filter(id => !selection.has(id)) })).filter(c => c.itemIds.length > 1); changed(); renderConnections(); }
function removeSelection() { if (!selection.size) return; finishEditing(); checkpoint(); board().items = board().items.filter(i => !selection.has(i.id)); board().chains.forEach(c => c.itemIds = c.itemIds.filter(id => !selection.has(id))); board().chains = board().chains.filter(c => c.itemIds.length > 1); selection.clear(); changed(); render(); }
function duplicate(source = selectedItems()) { if (!source.length) return; finishEditing(); checkpoint(); const map = new Map<string, string>(); const copies = source.map(i => { const c = clone(i); c.id = crypto.randomUUID(); c.x += 32; c.y += 32; map.set(i.id, c.id); return c; }); const chains = board().chains.flatMap(c => { const ids = c.itemIds.filter(id => map.has(id)).map(id => map.get(id)!); return ids.length > 1 ? [{ id: crypto.randomUUID(), itemIds: ids }] : []; }); board().items.push(...copies); board().chains.push(...chains); setSelection(copies.map(i => i.id)); changed(); renderConnections(); }
function undo(redo = false) { finishEditing(); const stack = redo ? futures : histories; const snapshot = stack.pop(); if (!snapshot) return; (redo ? histories : futures).push(clone(workspace)); workspace = snapshot; selection.clear(); changed(); render(); }

type Gesture = { type: 'move' | 'resize' | 'pan' | 'marquee'; start: Point; current: Point; pointerId: number; initial: Point; originals: Item[]; selection: Set<string>; shifted: boolean; moved: boolean; };
let gesture: Gesture | null = null;

canvas.addEventListener('pointerdown', event => {
  if (!ready || event.button === 2) return;
  const target = event.target as HTMLElement;
  if (target.closest('[contenteditable]')) return;
  const itemElement = target.closest<HTMLElement>('.board-item');
  if (target instanceof HTMLVideoElement && selection.has(itemElement?.dataset.id || '') && !event.shiftKey && !spaceDown && tool !== 'hand') return;
  finishEditing(); $('#context-menu').hidden = true;
  const point = screenToWorld(event.clientX, event.clientY);
  if (tool === 'text' && event.button === 0 && !spaceDown) { event.preventDefault(); addText(point); return; }
  let type: Gesture['type'] = 'marquee';
  if (event.button === 1 || spaceDown || tool === 'hand') type = 'pan';
  else if (itemElement) {
    const id = itemElement.dataset.id!;
    if (event.shiftKey) { const ids = new Set(selection); if (ids.has(id)) ids.delete(id); else ids.add(id); setSelection([...ids]); if (!ids.has(id)) return; }
    else if (!selection.has(id)) setSelection([id]);
    type = target.closest('.resize-handle') ? 'resize' : 'move';
  } else if (!event.shiftKey) setSelection([]);
  event.preventDefault(); canvas.focus();
  gesture = { type, start: { x: event.clientX, y: event.clientY }, current: point, pointerId: event.pointerId, initial: { ...board().viewport }, originals: clone(type === 'resize' ? board().items.filter(i => i.id === itemElement?.dataset.id) : selectedItems()), selection: new Set(selection), shifted: event.shiftKey, moved: false };
  canvas.classList.toggle('panning', type === 'pan');
});

canvas.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const dx = event.clientX - gesture.start.x; const dy = event.clientY - gesture.start.y;
  if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
  if (!gesture.moved) canvas.setPointerCapture(event.pointerId);
  if (!gesture.moved && (gesture.type === 'move' || gesture.type === 'resize')) checkpoint();
  gesture.moved = true;
  const zoom = board().viewport.zoom;
  if (gesture.type === 'pan') { board().viewport.x = gesture.initial.x + dx; board().viewport.y = gesture.initial.y + dy; renderViewport(); }
  if (gesture.type === 'move') {
    for (const initial of gesture.originals) { const item = board().items.find(i => i.id === initial.id)!; item.x = initial.x + dx / zoom; item.y = initial.y + dy / zoom; }
    renderNodes(); renderConnections();
  }
  if (gesture.type === 'resize') {
    const initial = gesture.originals[0]; const item = board().items.find(i => i.id === initial.id)!;
    item.width = Math.max(64, initial.width + dx / zoom);
    item.height = item.kind === 'text' || event.shiftKey ? Math.max(40, initial.height + dy / zoom) : item.width * initial.height / initial.width;
    renderNodes(); renderConnections();
  }
  if (gesture.type === 'marquee') {
    const now = screenToWorld(event.clientX, event.clientY); const x = Math.min(gesture.current.x, now.x); const y = Math.min(gesture.current.y, now.y); const width = Math.abs(now.x - gesture.current.x); const height = Math.abs(now.y - gesture.current.y);
    const rect = canvas.getBoundingClientRect(); const box = $('#marquee'); box.hidden = false;
    Object.assign(box.style, { left: `${Math.min(event.clientX, gesture.start.x) - rect.left}px`, top: `${Math.min(event.clientY, gesture.start.y) - rect.top}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
    const ids = board().items.filter(i => i.x < x + width && i.x + i.width > x && i.y < y + height && i.y + i.height > y).map(i => i.id);
    setSelection([...new Set([...(gesture.shifted ? gesture.selection : []), ...ids])]);
  }
});

function endGesture(event: PointerEvent) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const ended = gesture; gesture = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove('panning'); $('#marquee').hidden = true;
  if (ended.moved && ended.type === 'move') { const ids = ended.originals.map(i => i.id); reorderChains(board(), ids); let inserted = false; for (const id of ids) inserted = insertIntoConnection(board(), id, 18 / board().viewport.zoom) || inserted; renderConnections(); if (inserted) toast('Added to connection'); }
  if (ended.moved && ended.type !== 'marquee') changed();
}
canvas.addEventListener('pointerup', endGesture); canvas.addEventListener('pointercancel', endGesture);
canvas.addEventListener('dblclick', event => { const target = (event.target as HTMLElement).closest<HTMLElement>('.board-item'); if (target) startEditing(target.dataset.id!); else if (tool === 'select') addText(screenToWorld(event.clientX, event.clientY)); });

function zoomAt(factor: number, clientX?: number, clientY?: number) { const r = canvas.getBoundingClientRect(); const x = clientX ?? r.left + r.width / 2; const y = clientY ?? r.top + r.height / 2; const p = screenToWorld(x, y); const v = board().viewport; v.zoom = Math.min(3, Math.max(.15, factor)); v.x = x - r.left - p.x * v.zoom; v.y = y - r.top - p.y * v.zoom; renderViewport(); changed(); }
canvas.addEventListener('wheel', event => { if ((event.target as HTMLElement).closest('[contenteditable]') && !event.ctrlKey && !event.metaKey) return; event.preventDefault(); if (event.ctrlKey || event.metaKey) zoomAt(board().viewport.zoom * Math.exp(-event.deltaY * .006), event.clientX, event.clientY); else { board().viewport.x -= event.shiftKey ? event.deltaY : event.deltaX; board().viewport.y -= event.shiftKey ? event.deltaX : event.deltaY; renderViewport(); changed(); } }, { passive: false });
function fitBoard() { const items = board().items; if (!items.length) { board().viewport = { x: 0, y: 0, zoom: 1 }; renderViewport(); changed(); return; } const left = Math.min(...items.map(i => i.x)); const top = Math.min(...items.map(i => i.y)); const right = Math.max(...items.map(i => i.x + i.width)); const bottom = Math.max(...items.map(i => i.y + i.height)); const r = canvas.getBoundingClientRect(); const zoom = Math.min(1.5, Math.max(.15, Math.min((r.width - 160) / (right - left), (r.height - 180) / (bottom - top)))); board().viewport = { zoom, x: (r.width - (right - left) * zoom) / 2 - left * zoom, y: (r.height - (bottom - top) * zoom) / 2 - top * zoom }; renderViewport(); changed(); }

canvas.addEventListener('contextmenu', event => {
  event.preventDefault(); finishEditing();
  const item = (event.target as HTMLElement).closest<HTMLElement>('.board-item');
  if (item && !selection.has(item.dataset.id!)) setSelection([item.dataset.id!]);
  const menu = $('#context-menu');
  const entry = (action: string, glyph: string, label: string, disabled = false) => `<button role="menuitem" data-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
  menu.innerHTML = selection.size ? entry('connect', 'link', 'Connect', selection.size < 2) + entry('disconnect', 'unlink', 'Disconnect') + '<hr/>' + entry('duplicate', 'copy', 'Duplicate') + entry('front', 'front', 'Bring to front') + '<hr/>' + entry('delete', 'trash', 'Delete') : entry('text', 'text', 'Add text') + entry('media', 'media', 'Add images or videos') + '<hr/>' + entry('fit', 'fit', 'Fit board');
  const point = screenToWorld(event.clientX, event.clientY); menu.dataset.x = String(point.x); menu.dataset.y = String(point.y); menu.hidden = false;
  menu.style.left = `${Math.min(event.clientX, innerWidth - 210)}px`; menu.style.top = `${Math.min(event.clientY, innerHeight - menu.offsetHeight - 12)}px`;
});
$('#context-menu').addEventListener('click', event => { const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action; $('#context-menu').hidden = true; if (action === 'connect') connect(); if (action === 'disconnect') disconnect(); if (action === 'duplicate') duplicate(); if (action === 'delete') removeSelection(); if (action === 'fit') fitBoard(); if (action === 'media') void chooseMedia(); if (action === 'text') addText({ x: Number($('#context-menu').dataset.x), y: Number($('#context-menu').dataset.y) }); if (action === 'front') { checkpoint(); board().items = [...board().items.filter(i => !selection.has(i.id)), ...selectedItems()]; changed(); renderNodes(); } });
document.addEventListener('pointerdown', event => { if (!(event.target as HTMLElement).closest('#context-menu')) $('#context-menu').hidden = true; });

async function mediaDimensions(asset: MediaAsset): Promise<{ width: number; height: number }> {
  const url = await assetUrl(asset); mediaUrls.set(asset.id, url);
  return new Promise(resolve => { const element = document.createElement(asset.kind === 'image' ? 'img' : 'video'); let settled = false; const done = () => { if (settled) return; settled = true; const w = element instanceof HTMLImageElement ? element.naturalWidth : element.videoWidth; const h = element instanceof HTMLImageElement ? element.naturalHeight : element.videoHeight; if (element instanceof HTMLVideoElement) { element.removeAttribute('src'); element.load(); } resolve({ width: w || 480, height: h || 300 }); }; element.addEventListener(asset.kind === 'image' ? 'load' : 'loadedmetadata', done, { once: true }); element.addEventListener('error', done, { once: true }); if (element instanceof HTMLVideoElement) element.preload = 'metadata'; element.src = url; setTimeout(done, 3500); });
}
async function addAssets(assets: MediaAsset[], point: Point, targetBoardId: string) {
  const dimensions = await Promise.all(assets.map(mediaDimensions));
  const target = workspace.boards.find(b => b.id === targetBoardId); if (!target) return;
  checkpoint(); const ids: string[] = [];
  assets.forEach((asset, index) => { workspace.assets.push(asset); const item = createItem(asset.kind, point.x + index * 32, point.y + index * 32); const size = dimensions[index]; const scale = Math.min(1, 420 / size.width, 420 / size.height); item.width = Math.max(64, size.width * scale); item.height = Math.max(40, size.height * scale); item.assetId = asset.id; target.items.push(item); ids.push(item.id); });
  if (target.id === workspace.activeBoardId) setSelection(ids); changed(); render();
}
async function handleFiles(files: FileList | File[], point = center()) {
  if (pendingImport) return; pendingImport = true; const target = board().id;
  try { const assets: MediaAsset[] = []; for (const file of Array.from(files)) { try { assets.push(await importFile(file)); } catch (error) { toast(errorText(error), 6000); } } await addAssets(assets, point, target); }
  catch (error) { toast(errorText(error), 6000); } finally { pendingImport = false; $('#drop-hint').hidden = true; }
}
async function handlePaths(paths: string[], point = center()) { if (pendingImport) return; pendingImport = true; const target = board().id; try { const assets = await importPaths(paths); await addAssets(assets, point, target); } catch (error) { toast(errorText(error), 6000); } finally { pendingImport = false; $('#drop-hint').hidden = true; } }
async function chooseMedia() { finishEditing(); if (native) { try { const { open } = await import('@tauri-apps/plugin-dialog'); const paths = await open({ multiple: true, directory: false, filters: [{ name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'mov', 'm4v', 'ogv', 'ogg'] }] }); if (paths) await handlePaths(Array.isArray(paths) ? paths : [paths]); } catch (error) { toast(errorText(error)); } } else ($('#file-input') as HTMLInputElement).click(); }
$('#file-input').addEventListener('change', event => { const input = event.target as HTMLInputElement; if (input.files) void handleFiles(input.files); input.value = ''; });
let dragDepth = 0;
canvas.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('#drop-hint').hidden = false; });
canvas.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
canvas.addEventListener('dragleave', event => { event.preventDefault(); dragDepth--; if (dragDepth <= 0) $('#drop-hint').hidden = true; });
canvas.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('#drop-hint').hidden = true; if (!native && event.dataTransfer?.files.length) void handleFiles(event.dataTransfer.files, screenToWorld(event.clientX, event.clientY)); });
document.addEventListener('paste', event => {
  if (!ready) return;
  const target = event.target as HTMLElement;
  if (target.closest('input,select,textarea,[contenteditable],#board-panel,#library-menu,dialog')) return;
  if (clipboardToken && event.clipboardData?.getData('application/x-myboards-selection') === clipboardToken && copied.length) { event.preventDefault(); duplicate(copied); return; }
  const files = Array.from(event.clipboardData?.files || []);
  if (files.length) { event.preventDefault(); void handleFiles(files); return; }
  const text = event.clipboardData?.getData('text/plain');
  if (text) { event.preventDefault(); addText(center(), text); }
  else if (copied.length) { event.preventDefault(); duplicate(copied); }
});
document.addEventListener('copy', event => {
  if (!ready || !selection.size || (event.target as HTMLElement).closest('input,textarea,[contenteditable],#board-panel,#library-menu,dialog')) return;
  copied = clone(selectedItems()); clipboardToken = crypto.randomUUID();
  event.clipboardData?.setData('application/x-myboards-selection', clipboardToken);
  event.clipboardData?.setData('text/plain', copied.map(i => i.text || workspace.assets.find(a => a.id === i.assetId)?.name || '').join('\n'));
  event.preventDefault();
});

document.addEventListener('keydown', event => {
  if (!ready) return;
  const target = event.target as HTMLElement; const typing = !!target.closest('input,select,textarea,[contenteditable]'); const modal = !!document.querySelector('dialog[open]');
  if (event.key === 'Escape') { finishEditing(); $('#context-menu').hidden = true; if (!modal) { setTool('select'); setSelection([]); } }
  if (typing || modal) return;
  const ctrl = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase();
  if (target.closest('#board-panel,#library-menu') && !(ctrl && ['z', 'y', 's'].includes(key))) return;
  if (event.code === 'Space') { event.preventDefault(); spaceDown = true; canvas.classList.add('space-pan'); }
  if (ctrl && key === 'z') { event.preventDefault(); undo(event.shiftKey); }
  else if (ctrl && key === 'y') { event.preventDefault(); undo(true); }
  else if (ctrl && key === 'a') { event.preventDefault(); setSelection(board().items.map(i => i.id)); }
  else if (ctrl && key === 'k') { event.preventDefault(); connect(); }
  else if (ctrl && key === 'd') { event.preventDefault(); duplicate(); }
  else if (ctrl && key === 's') { event.preventDefault(); void flushSave(); }
  else if (key === 'delete' || key === 'backspace') { event.preventDefault(); removeSelection(); }
  else if (!ctrl && key === 'v') setTool('select');
  else if (!ctrl && key === 'h') setTool('hand');
  else if (!ctrl && key === 't') setTool('text');
  else if (!ctrl && key === 'f') fitBoard();
  else if (key === 'enter' && selection.size === 1) { event.preventDefault(); startEditing([...selection][0]); }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selection.size) { event.preventDefault(); checkpoint(); const n = event.shiftKey ? 10 : 1; for (const item of selectedItems()) { item.x += event.key === 'ArrowLeft' ? -n : event.key === 'ArrowRight' ? n : 0; item.y += event.key === 'ArrowUp' ? -n : event.key === 'ArrowDown' ? n : 0; } reorderChains(board(), [...selection]); changed(); renderNodes(); renderConnections(); }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') { spaceDown = false; canvas.classList.remove('space-pan'); } });
window.addEventListener('blur', () => { spaceDown = false; canvas.classList.remove('space-pan'); void flushSave(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) void flushSave(); });
window.addEventListener('beforeunload', event => { if (!native && (dirty || pendingImport)) { void flushSave(); event.preventDefault(); event.returnValue = ''; } });

$('#tool-select').onclick = () => setTool('select'); $('#tool-hand').onclick = () => setTool('hand'); $('#tool-text').onclick = () => setTool('text');
$('#import-media').onclick = () => void chooseMedia(); $('#connect').onclick = connect;
$('#undo').onclick = () => undo(); $('#redo').onclick = () => undo(true);
$('#zoom-in').onclick = () => zoomAt(board().viewport.zoom * 1.2); $('#zoom-out').onclick = () => zoomAt(board().viewport.zoom / 1.2); $('#zoom-reset').onclick = () => zoomAt(1); $('#zoom-fit').onclick = fitBoard;
$('#save-status').onclick = () => void flushSave();
$('#boards-toggle').onclick = () => { $('#board-panel').hidden = !$('#board-panel').hidden; renderBoardList(); };
library = mountLibrary({
  workspace: () => workspace,
  commit(action) { if (!ready) return; finishEditing(); checkpoint(); action(); changed(); render(); },
  openBoard(id) { if (!ready) return; finishEditing(); workspace.activeBoardId = id; selection.clear(); changed(); render(); },
  createBoard(groupId, prepare) {
    if (!ready) return;
    finishEditing(); checkpoint(); prepare(); const created = createBoard(`Untitled ${workspace.boards.length + 1}`, groupId);
    workspace.boards.push(created); workspace.activeBoardId = created.id; selection.clear(); changed(); render();
    $('#board-name').focus(); ($('#board-name') as HTMLInputElement).select();
  },
  deleteBoard(id) {
    if (!ready) return;
    finishEditing(); checkpoint(); workspace.boards = workspace.boards.filter(b => b.id !== id);
    if (!workspace.boards.length) workspace.boards.push(createBoard());
    if (!workspace.boards.some(b => b.id === workspace.activeBoardId)) workspace.activeBoardId = workspace.boards[0].id;
    selection.clear(); changed(); render(); toast('Board deleted. Undo to restore.');
  },
  notify: toast,
});
$('#board-name').addEventListener('focus', () => { if (ready) checkpoint(); });
$('#board-name').addEventListener('input', event => { board().name = (event.target as HTMLInputElement).value.trim() || 'Untitled'; changed(); renderBoardList(); });
$('#board-name').addEventListener('keydown', event => { if (event.key === 'Enter') $('#board-name').blur(); });
$('#board-name').addEventListener('blur', () => { ($('#board-name') as HTMLInputElement).value = board().name; });
$('#bold').onclick = () => formatText({ bold: !selectedItems()[0]?.style?.bold });
$('#italic').onclick = () => formatText({ italic: !selectedItems()[0]?.style?.italic });
$('#align').onclick = () => { const aligns = ['left', 'center', 'right'] as const; const current = selectedItems()[0]?.style?.align || 'left'; formatText({ align: aligns[(aligns.indexOf(current) + 1) % 3] }); };
$('#font-family').onchange = event => formatText({ fontFamily: (event.target as HTMLSelectElement).value });
$('#font-size').onchange = event => { const size = Number((event.target as HTMLInputElement).value); if (Number.isFinite(size)) formatText({ fontSize: Math.max(12, Math.min(144, size)) }); };
$('#text-color').onchange = event => formatText({ color: (event.target as HTMLInputElement).value });
$('#text-background').onchange = event => formatText({ background: (event.target as HTMLInputElement).value });
$('#clear-background').onclick = () => formatText({ background: 'transparent' });
$('#settings').onclick = () => { finishEditing(); ($('#settings-dialog') as HTMLDialogElement).showModal(); void storagePath().then(path => $('#storage-location').textContent = path); applyTheme(); };
$('#settings-close').onclick = () => ($('#settings-dialog') as HTMLDialogElement).close();
$('#help').onclick = () => ($('#help-dialog') as HTMLDialogElement).showModal(); $('#help-close').onclick = () => ($('#help-dialog') as HTMLDialogElement).close();
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('click', event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); }));
document.querySelectorAll<HTMLElement>('button[data-theme]').forEach(el => el.onclick = () => { workspace.settings.theme = el.dataset.theme as 'dark' | 'light'; applyTheme(); renderChrome(); changed(); });
document.querySelectorAll<HTMLElement>('[data-accent]').forEach(el => el.onclick = () => { workspace.settings.accent = el.dataset.accent!; applyTheme(); changed(); });
$('#accent-color').oninput = event => { workspace.settings.accent = (event.target as HTMLInputElement).value; applyTheme(); changed(); };
$('#show-grid').onchange = event => { workspace.settings.grid = (event.target as HTMLInputElement).checked; applyTheme(); changed(); };

async function initialize() {
  try {
    const saved = await loadWorkspace(); workspace = saved ? normalizeWorkspace(saved) : createWorkspace(); ready = true; render(); setTool('select'); markSaved('Saved on this device', 'saved');
    if (native) {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().onDragDropEvent(event => {
        if (event.payload.type === 'over' || event.payload.type === 'enter') $('#drop-hint').hidden = false;
        if (event.payload.type === 'leave') $('#drop-hint').hidden = true;
        if (event.payload.type === 'drop') { const p = event.payload.position; void handlePaths(event.payload.paths, screenToWorld(p.x / window.devicePixelRatio, p.y / window.devicePixelRatio)); }
      });
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().onCloseRequested(async event => { if (pendingImport) { event.preventDefault(); toast('Finishing media import. Close again when it is ready.'); return; } if (dirty) { event.preventDefault(); finishEditing(); await flushSave(); if (!dirty) await getCurrentWindow().destroy(); } });
    }
  } catch (error) { ready = false; markSaved('Could not load local storage', 'error'); $('#empty-hint').innerHTML = `<p>Could not open your local boards.</p><p>${escape(errorText(error))}</p><button id="retry-load">Retry</button>`; $('#retry-load').onclick = () => void initialize(); }
}
void initialize();

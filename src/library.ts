import { icon } from './icons';
import { createGroup, groupDescendants, groupEntries, moveBoard, moveGroup, ungroup } from './model';
import type { BoardGroup, Workspace } from './model';

interface LibraryHooks {
  workspace(): Workspace;
  // A single transaction is one undo step and one autosave.
  commit(action: () => void): void;
  openBoard(id: string): void;
  createBoard(groupId: string | null, prepare: () => void): void;
  deleteBoard(id: string): void;
  notify(message: string): void;
}
type Entry = { kind: 'group' | 'board'; id: string };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;

export function mountLibrary(hooks: LibraryHooks) {
  const panel = $('board-panel');
  let selectedGroup: string | null = null;
  let menuEntry: Entry | null = null;
  let naming: { entry?: Entry; parentId: string | null } | null = null;
  let moving: Entry | null = null;
  let indexedGroups = new Map<string, BoardGroup>();

  panel.innerHTML = `<div class="panel-heading"><button id="library-root" aria-label="Top level" title="Create at top level">Boards</button><div class="library-actions"><button id="new-group" class="icon-button" aria-label="New group" title="New group">${icon('folderPlus')}</button><button id="new-board" class="icon-button" aria-label="New board" title="New board">${icon('plus')}</button></div></div><div id="board-list" role="tree" aria-label="Boards and groups"></div>`;
  // Keep a fresh reference after replacing the old flat board panel.
  const tree = $('board-list');
  document.body.insertAdjacentHTML('beforeend', `
    <div id="library-menu" class="floating-panel context-menu" role="menu" hidden></div>
    <dialog id="group-name-dialog" class="library-dialog" aria-labelledby="group-name-title"><form id="group-name-form"><div class="dialog-header"><h2 id="group-name-title">New group</h2><button id="group-name-close" type="button" class="icon-button" aria-label="Cancel">${icon('close')}</button></div><label for="group-name-input" class="setting-title">Name</label><div class="name-input-row"><input id="group-name-input" name="name" autocomplete="off" maxlength="120" required /><button id="group-name-save" class="icon-button active" type="submit" aria-label="Save name" title="Save">${icon('check')}</button></div><p id="group-name-location" class="library-location"></p></form></dialog>
    <dialog id="move-dialog" class="library-dialog" aria-labelledby="move-title"><div class="dialog-header"><h2 id="move-title">Move to</h2><button id="move-close" class="icon-button" aria-label="Cancel move">${icon('close')}</button></div><div id="move-destinations" aria-label="Destination groups"></div></dialog>
  `);

  function groupPath(id: string | null) {
    const names: string[] = [];
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const group = indexedGroups.get(id); if (!group) break;
      names.push(group.name); id = group.parentId;
    }
    return names.reverse().join(' / ') || 'Top level';
  }

  function expandParents(id: string | null) {
    const groups = new Map(hooks.workspace().groups.map(group => [group.id, group]));
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const group = groups.get(id); if (!group) break;
      group.collapsed = false; id = group.parentId;
    }
  }

  function render() {
    const workspace = hooks.workspace();
    if (selectedGroup && !workspace.groups.some(g => g.id === selectedGroup)) selectedGroup = null;
    const groups = new Map(workspace.groups.map(g => [g.id, g]));
    indexedGroups = groups;
    const boards = new Map(workspace.boards.map(b => [b.id, b]));
    const entries = groupEntries(workspace);
    tree.innerHTML = entries.map(entry => {
      if (entry.kind === 'group') {
        const group = groups.get(entry.id)!;
        const name = escape(group.name); const id = escape(group.id);
        return `<div class="library-row group-row ${selectedGroup === group.id ? 'group-selected' : ''}" data-group-id="${id}" data-entry-kind="group" data-entry-id="${id}" role="treeitem" aria-level="${entry.depth + 1}" aria-expanded="${!group.collapsed}" aria-selected="${selectedGroup === group.id}" style="--depth:${entry.depth}"><button class="group-toggle icon-button ${group.collapsed ? '' : 'expanded'}" data-toggle-group="${id}" aria-label="${group.collapsed ? 'Expand' : 'Collapse'} ${name}" title="${group.collapsed ? 'Expand' : 'Collapse'}">${icon('chevron')}</button><button class="group-select" data-group="${id}" title="${name}">${icon('folder')}<span>${name}</span></button><button class="library-more icon-button" aria-label="Options for ${name}" title="Options">${icon('more')}</button></div>`;
      }
      const board = boards.get(entry.id)!;
      const name = escape(board.name); const id = escape(board.id);
      return `<div class="library-row board-list-row ${board.id === workspace.activeBoardId ? 'active' : ''}" data-entry-kind="board" data-entry-id="${id}" role="treeitem" aria-level="${entry.depth + 1}" aria-selected="${board.id === workspace.activeBoardId}" style="--depth:${entry.depth}"><span class="tree-spacer"></span><button class="board-switch" data-board="${id}" title="${name}">${icon('logo')}<span>${name}</span><small>${board.items.length}</small></button><button class="library-more icon-button" aria-label="Options for ${name}" title="Options">${icon('more')}</button></div>`;
    }).join('');
    $('library-root').classList.toggle('selected', selectedGroup === null);
    $('new-board').title = `New board in ${groupPath(selectedGroup)}`;
    $('new-group').title = `New group in ${groupPath(selectedGroup)}`;
  }

  function entryOf(element: HTMLElement): Entry | null {
    const row = element.closest<HTMLElement>('[data-entry-id]');
    return row ? { kind: row.dataset.entryKind as Entry['kind'], id: row.dataset.entryId! } : null;
  }

  function entryName(entry: Entry) {
    const workspace = hooks.workspace();
    return (entry.kind === 'group' ? workspace.groups : workspace.boards).find(item => item.id === entry.id)?.name || '';
  }

  function restoreFocus(entry?: Entry | null) {
    const target = entry && [...tree.querySelectorAll<HTMLButtonElement>('.group-select,.board-switch')].find(button => {
      const candidate = entryOf(button); return candidate?.id === entry.id && candidate.kind === entry.kind;
    });
    (target || $('library-root')).focus();
  }

  function openName(entry?: Entry, parentId = selectedGroup) {
    naming = { entry, parentId };
    $('group-name-title').textContent = entry ? 'Rename' : 'New group';
    const input = $<HTMLInputElement>('group-name-input');
    input.value = entry ? entryName(entry) : '';
    $('group-name-location').textContent = entry ? '' : `In ${groupPath(parentId)}`;
    $<HTMLDialogElement>('group-name-dialog').showModal(); input.focus(); input.select();
  }

  function openMove(entry: Entry) {
    moving = entry;
    const workspace = hooks.workspace();
    const item = (entry.kind === 'group' ? workspace.groups : workspace.boards).find(i => i.id === entry.id);
    if (!item) return;
    const parent = entry.kind === 'group' ? workspace.groups.find(g => g.id === entry.id)!.parentId : workspace.boards.find(b => b.id === entry.id)!.groupId;
    const excluded = entry.kind === 'group' ? groupDescendants(workspace, entry.id) : new Set<string>();
    if (entry.kind === 'group') excluded.add(entry.id);
    const groups = new Map(workspace.groups.map(g => [g.id, g]));
    const entries = groupEntries({ ...workspace, boards: [], groups: workspace.groups.map(g => ({ ...g, collapsed: false })) });
    const choice = (id: string | null, name: string, depth: number) => `<button class="destination" data-destination="${escape(id || '')}" style="--depth:${depth}" ${parent === id ? 'disabled' : ''} title="${escape(name)}">${icon(id ? 'folder' : 'boards')}<span>${escape(name)}</span>${parent === id ? icon('check') : ''}</button>`;
    $('move-title').textContent = `Move “${entryName(entry)}”`;
    $('move-destinations').innerHTML = choice(null, 'Top level', 0) + entries.filter(e => !excluded.has(e.id)).map(e => choice(e.id, groups.get(e.id)!.name, e.depth + 1)).join('');
    $<HTMLDialogElement>('move-dialog').showModal();
  }

  function openMenu(entry: Entry, x: number, y: number) {
    menuEntry = entry;
    if (entry.kind === 'group') selectedGroup = entry.id;
    else selectedGroup = hooks.workspace().boards.find(b => b.id === entry.id)?.groupId || null;
    render(); $('context-menu').hidden = true;
    const action = (name: string, glyph: string, label: string) => `<button role="menuitem" data-library-action="${name}">${icon(glyph)}<span>${label}</span></button>`;
    const menu = $('library-menu');
    menu.innerHTML = (entry.kind === 'group' ? action('new-board', 'plus', 'New board') + action('new-group', 'folderPlus', 'New subgroup') + '<hr/>' : '') + action('rename', 'rename', 'Rename') + action('move', 'move', 'Move to…') + '<hr/>' + (entry.kind === 'group' ? action('ungroup', 'unlink', 'Ungroup') : action('delete', 'trash', 'Delete'));
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }

  function selectGroup(id: string) {
    selectedGroup = id;
    const group = hooks.workspace().groups.find(g => g.id === id);
    if (group?.collapsed) hooks.commit(() => { group.collapsed = false; });
    else render();
    tree.querySelectorAll<HTMLButtonElement>('.group-select').forEach(button => { if (button.dataset.group === id) button.focus(); });
  }

  $('library-root').onclick = () => { selectedGroup = null; render(); };
  $('new-group').onclick = () => openName();
  $('new-board').onclick = () => hooks.createBoard(selectedGroup, () => expandParents(selectedGroup));
  tree.onclick = event => {
    const target = event.target as HTMLElement;
    const entry = entryOf(target); if (!entry) return;
    if (target.closest('.library-more')) { const box = target.closest('.library-more')!.getBoundingClientRect(); openMenu(entry, box.right + 5, box.top); return; }
    if (target.closest('.group-toggle')) {
      const group = hooks.workspace().groups.find(g => g.id === entry.id)!;
      selectedGroup = group.id;
      hooks.commit(() => { group.collapsed = !group.collapsed; });
      tree.querySelectorAll<HTMLButtonElement>('.group-toggle').forEach(button => { if (button.dataset.toggleGroup === group.id) button.focus(); });
      return;
    }
    if (entry.kind === 'group') selectGroup(entry.id);
    else { selectedGroup = hooks.workspace().boards.find(b => b.id === entry.id)?.groupId || null; hooks.openBoard(entry.id); restoreFocus(entry); }
  };
  tree.oncontextmenu = event => { const entry = entryOf(event.target as HTMLElement); if (entry) { event.preventDefault(); openMenu(entry, event.clientX, event.clientY); } };

  $('library-menu').onclick = event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-library-action]')?.dataset.libraryAction;
    const entry = menuEntry;
    $('library-menu').hidden = true;
    if (!entry || !action) return;
    if (action === 'new-board') hooks.createBoard(entry.id, () => expandParents(entry.id));
    if (action === 'new-group') openName(undefined, entry.id);
    if (action === 'rename') openName(entry);
    if (action === 'move') openMove(entry);
    if (action === 'delete') { hooks.deleteBoard(entry.id); restoreFocus(); }
    if (action === 'ungroup') {
      hooks.commit(() => {
        selectedGroup = hooks.workspace().groups.find(g => g.id === entry.id)?.parentId || null;
        ungroup(hooks.workspace(), entry.id);
      });
      hooks.notify('Group removed. Its boards and subgroups were kept.');
      restoreFocus();
    }
  };

  $('group-name-form').onsubmit = event => {
    event.preventDefault();
    const name = $<HTMLInputElement>('group-name-input').value.trim();
    if (!name || !naming) { $('group-name-input').focus(); return; }
    const request = naming;
    hooks.commit(() => {
      if (request.entry) {
        const entries = request.entry.kind === 'group' ? hooks.workspace().groups : hooks.workspace().boards;
        const entry = entries.find(e => e.id === request.entry!.id); if (entry) entry.name = name;
      } else {
        expandParents(request.parentId);
        selectedGroup = createGroup(hooks.workspace(), name, request.parentId).id;
      }
    });
    $<HTMLDialogElement>('group-name-dialog').close();
    restoreFocus(request.entry || (selectedGroup ? { kind: 'group', id: selectedGroup } : null)); naming = null;
  };
  $('group-name-close').onclick = () => $<HTMLDialogElement>('group-name-dialog').close();
  $('move-close').onclick = () => $<HTMLDialogElement>('move-dialog').close();
  $('move-destinations').onclick = event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-destination]');
    if (!target || target.disabled || !moving) return;
    const entry = moving; const destination = target.dataset.destination || null;
    hooks.commit(() => {
      const moved = entry.kind === 'group' ? moveGroup(hooks.workspace(), entry.id, destination) : moveBoard(hooks.workspace(), entry.id, destination);
      if (moved) { expandParents(destination); selectedGroup = entry.kind === 'group' ? entry.id : destination; }
    });
    $<HTMLDialogElement>('move-dialog').close(); restoreFocus(entry); moving = null;
  };

  // Resolve complete paths only for the row being inspected. Deep libraries
  // otherwise stay linear to render instead of generating every ancestor path.
  function updatePathTitle(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.group-select,.board-switch,.destination');
    if (!button) return;
    if (button.dataset.destination !== undefined) button.title = groupPath(button.dataset.destination || null);
    else if (button.dataset.group) button.title = groupPath(button.dataset.group);
    else if (button.dataset.board) {
      const board = hooks.workspace().boards.find(b => b.id === button.dataset.board);
      if (board) button.title = `${groupPath(board.groupId)} / ${board.name}`;
    }
  }
  for (const surface of [tree, $('move-destinations')]) {
    surface.addEventListener('pointerover', updatePathTitle);
    surface.addEventListener('focusin', updatePathTitle);
  }
  $<HTMLDialogElement>('group-name-dialog').addEventListener('close', () => { if (naming) restoreFocus(naming.entry); naming = null; });
  $<HTMLDialogElement>('move-dialog').addEventListener('close', () => { if (moving) restoreFocus(moving); moving = null; });

  // Keyboard navigation stays within the library instead of moving canvas objects.
  tree.addEventListener('keydown', event => {
    const entry = entryOf(event.target as HTMLElement); if (!entry) return;
    const buttons = [...tree.querySelectorAll<HTMLButtonElement>('.group-select,.board-switch')];
    const current = buttons.findIndex(button => entryOf(button)?.id === entry.id);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      buttons[Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); event.stopPropagation();
      if (entry.kind === 'group') {
        const group = hooks.workspace().groups.find(g => g.id === entry.id)!;
        const collapsed = event.key === 'ArrowLeft';
        if (group.collapsed !== collapsed) { hooks.commit(() => { group.collapsed = collapsed; }); buttons[current]?.blur(); tree.querySelectorAll<HTMLButtonElement>('.group-select').forEach(b => { if (b.dataset.group === group.id) b.focus(); }); }
      }
    } else if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); openName(entry); }
    else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') { event.preventDefault(); event.stopPropagation(); const box = (event.target as HTMLElement).getBoundingClientRect(); openMenu(entry, box.right, box.top); }
  });
  $('library-menu').addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { $('library-menu').hidden = true; $('library-root').focus(); return; }
    const choices = [...$('library-menu').querySelectorAll<HTMLButtonElement>('button')];
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    choices[event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]?.focus();
  });
  document.addEventListener('pointerdown', event => { if (!(event.target as HTMLElement).closest('#library-menu')) $('library-menu').hidden = true; });
  return { render };
}

export type BoardLibrary = ReturnType<typeof mountLibrary>;

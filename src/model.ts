export type ItemKind = 'text' | 'image' | 'video';

export interface TextStyle {
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  background: string;
}

export interface Item {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  assetId?: string;
  style?: TextStyle;
}

export interface Chain {
  id: string;
  itemIds: string[];
}

export interface Board {
  id: string;
  name: string;
  groupId: string | null;
  items: Item[];
  chains: Chain[];
  viewport: { x: number; y: number; zoom: number };
}

export interface BoardGroup {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
}

export interface GroupEntry {
  kind: 'group' | 'board';
  id: string;
  depth: number;
  parentId: string | null;
}

export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  kind: 'image' | 'video';
}

export interface Workspace {
  version: 1;
  boards: Board[];
  groups: BoardGroup[];
  activeBoardId: string;
  assets: MediaAsset[];
  settings: { theme: 'dark' | 'light'; accent: string; grid: boolean };
}

export interface Point { x: number; y: number }
export interface ConnectionSegment {
  chainId: string;
  fromId: string;
  toId: string;
  start: Point;
  end: Point;
}

const id = () => globalThis.crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);

export function defaultTextStyle(): TextStyle {
  return {
    fontSize: 28,
    fontFamily: 'sans-serif',
    color: 'inherit',
    bold: false,
    italic: false,
    align: 'left',
    background: 'transparent',
  };
}

export function createItem(kind: ItemKind, x: number, y: number): Item {
  const item: Item = {
    id: id(), kind, x, y,
    width: kind === 'text' ? 280 : 320,
    height: kind === 'text' ? 112 : 220,
  };
  if (kind === 'text') {
    item.text = '';
    item.style = defaultTextStyle();
  }
  return item;
}

export function createBoard(name = 'Untitled', groupId: string | null = null): Board {
  return {
    id: id(), name, groupId, items: [], chains: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function createWorkspace(): Workspace {
  const board = createBoard();
  return {
    version: 1,
    boards: [board], groups: [], activeBoardId: board.id, assets: [],
    settings: { theme: 'dark', accent: '#a78bfa', grid: true },
  };
}

/** Groups are stored as a flat parent graph, allowing deep trees without nested JSON. */
export function createGroup(workspace: Workspace, name = 'New group', parentId: string | null = null): BoardGroup {
  const group: BoardGroup = {
    id: id(), name: name.trim() || 'New group',
    parentId: parentId !== null && workspace.groups.some(group => group.id === parentId) ? parentId : null,
    collapsed: false,
  };
  workspace.groups.push(group);
  return group;
}

export function groupDescendants(workspace: Workspace, groupId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const group of workspace.groups) {
    if (group.parentId === null) continue;
    const siblings = children.get(group.parentId) ?? [];
    siblings.push(group.id);
    children.set(group.parentId, siblings);
  }
  const descendants = new Set<string>();
  const pending = [...(children.get(groupId) ?? [])];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === groupId || descendants.has(current)) continue;
    descendants.add(current);
    for (const child of children.get(current) ?? []) pending.push(child);
  }
  return descendants;
}

export function moveGroup(workspace: Workspace, groupId: string, parentId: string | null): boolean {
  const group = workspace.groups.find(group => group.id === groupId);
  if (!group || groupId === parentId) return false;
  if (parentId !== null && (!workspace.groups.some(group => group.id === parentId)
    || groupDescendants(workspace, groupId).has(parentId))) return false;
  group.parentId = parentId;
  return true;
}

export function moveBoard(workspace: Workspace, boardId: string, groupId: string | null): boolean {
  const board = workspace.boards.find(board => board.id === boardId);
  if (!board || (groupId !== null && !workspace.groups.some(group => group.id === groupId))) return false;
  board.groupId = groupId;
  return true;
}

/** Remove the folder only; keep its boards and descendants in the containing folder. */
export function ungroup(workspace: Workspace, groupId: string): boolean {
  const group = workspace.groups.find(group => group.id === groupId);
  if (!group) return false;
  for (const board of workspace.boards) if (board.groupId === groupId) board.groupId = group.parentId;
  for (const child of workspace.groups) if (child.parentId === groupId) child.parentId = group.parentId;
  workspace.groups = workspace.groups.filter(group => group.id !== groupId);
  return true;
}

/** Visible depth-first rows, retaining sibling creation order and showing groups first. */
export function groupEntries(workspace: Workspace): GroupEntry[] {
  const groups = new Map(workspace.groups.map(group => [group.id, group]));
  const children = new Map<string | null, GroupEntry[]>();
  const add = (parentId: string | null, entry: GroupEntry) => {
    const siblings = children.get(parentId) ?? [];
    siblings.push(entry);
    children.set(parentId, siblings);
  };
  for (const group of workspace.groups) add(group.parentId, { kind: 'group', id: group.id, depth: 0, parentId: group.parentId });
  for (const board of workspace.boards) add(board.groupId, { kind: 'board', id: board.id, depth: 0, parentId: board.groupId });
  const pending = [...(children.get(null) ?? [])].reverse();
  const rows: GroupEntry[] = [];
  const visited = new Set<string>();
  while (pending.length) {
    const entry = pending.pop()!;
    const key = `${entry.kind}:${entry.id}`;
    if (visited.has(key)) continue;
    visited.add(key);
    rows.push(entry);
    if (entry.kind === 'group' && !groups.get(entry.id)?.collapsed) {
      const nested = children.get(entry.id) ?? [];
      for (let index = nested.length - 1; index >= 0; index--) pending.push({ ...nested[index], depth: entry.depth + 1 });
    }
  }
  return rows;
}

const center = (item: Item): Point => ({ x: item.x + item.width / 2, y: item.y + item.height / 2 });

/** Intersection of the ray from a rectangle's center toward another point. */
function boundaryPoint(item: Item, toward: Point): Point {
  const middle = center(item);
  const dx = toward.x - middle.x;
  const dy = toward.y - middle.y;
  if (dx === 0 && dy === 0) return middle;
  const scale = Math.min(
    dx === 0 ? Infinity : item.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : item.height / 2 / Math.abs(dy),
  );
  return { x: middle.x + dx * scale, y: middle.y + dy * scale };
}

/** Line ends follow object boundaries, so they never show through media/text. */
export function connectionSegments(board: Board): ConnectionSegment[] {
  const items = new Map(board.items.map(item => [item.id, item]));
  const segments: ConnectionSegment[] = [];
  for (const chain of board.chains) {
    const members = [...new Set(chain.itemIds)].filter(member => items.has(member));
    for (let index = 1; index < members.length; index++) {
      const from = items.get(members[index - 1])!;
      const to = items.get(members[index])!;
      const fromCenter = center(from);
      const toCenter = center(to);
      // Overlapping cards have no visible gap to connect. Skipping the segment
      // also prevents a hidden line from unexpectedly catching a dragged card.
      if (Math.abs(fromCenter.x - toCenter.x) <= (from.width + to.width) / 2
        && Math.abs(fromCenter.y - toCenter.y) <= (from.height + to.height) / 2) continue;
      segments.push({
        chainId: chain.id, fromId: from.id, toId: to.id,
        start: boundaryPoint(from, toCenter), end: boundaryPoint(to, fromCenter),
      });
    }
  }
  return segments;
}

function spatialOrder(items: Item[]): string[] {
  if (items.length < 2) return items.map(item => item.id);
  const centers = items.map(item => ({ item, point: center(item) }));
  const xs = centers.map(entry => entry.point.x);
  const ys = centers.map(entry => entry.point.y);
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  centers.sort((a, b) => horizontal
    ? a.point.x - b.point.x || a.point.y - b.point.y || a.item.id.localeCompare(b.item.id)
    : a.point.y - b.point.y || a.point.x - b.point.x || a.item.id.localeCompare(b.item.id));
  return centers.map(entry => entry.item.id);
}

/** Connect the selection in the order it occupies on the canvas. */
export function connectItems(board: Board, ids: Iterable<string>): Chain | null {
  const selected = new Set(ids);
  const items = board.items.filter(item => selected.has(item.id));
  if (items.length < 2) return null;
  const itemIds = spatialOrder(items);
  const existing = board.chains.find(chain => chain.itemIds.length === itemIds.length
    && chain.itemIds.every(member => selected.has(member)));
  if (existing) {
    existing.itemIds = itemIds;
    return existing;
  }
  const chain: Chain = { id: id(), itemIds };
  board.chains.push(chain);
  return chain;
}

/** Reorder affected chains when cards cross each other; remove deleted members. */
export function reorderChains(board: Board, movedIds: Iterable<string>): void {
  const moved = new Set(movedIds);
  const items = new Map(board.items.map(item => [item.id, item]));
  for (const chain of board.chains) {
    chain.itemIds = [...new Set(chain.itemIds)].filter(member => items.has(member));
    if (chain.itemIds.some(member => moved.has(member))) {
      chain.itemIds = spatialOrder(chain.itemIds.map(member => items.get(member)!));
    }
  }
  board.chains = board.chains.filter(chain => chain.itemIds.length >= 2);
}

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0 ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - start.x - projection * dx, point.y - start.y - projection * dy);
}

/** Liang–Barsky clipping tests the actual segment, not its infinite extension. */
function segmentIntersectsRect(start: Point, end: Point, item: Item, tolerance: number): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const left = item.x - tolerance;
  const top = item.y - tolerance;
  const right = item.x + item.width + tolerance;
  const bottom = item.y + item.height + tolerance;
  let near = 0;
  let far = 1;
  const constraints = [[-dx, start.x - left], [dx, right - start.x], [-dy, start.y - top], [dy, bottom - start.y]];
  for (const [p, q] of constraints) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }
  return true;
}

/**
 * Splice a card into the nearest intersected connection. Call after reorderChains
 * on drag end, so explicit insertion takes precedence over spatial ordering.
 */
export function insertIntoConnection(board: Board, itemId: string, tolerance = 28): boolean {
  const item = board.items.find(candidate => candidate.id === itemId);
  if (!item) return false;
  const padding = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 28;
  const candidates = connectionSegments(board)
    .filter(segment => segment.fromId !== itemId && segment.toId !== itemId)
    .filter(segment => segmentIntersectsRect(segment.start, segment.end, item, padding))
    .sort((a, b) => pointSegmentDistance(center(item), a.start, a.end)
      - pointSegmentDistance(center(item), b.start, b.end));
  const segment = candidates[0];
  if (!segment) return false;
  const chain = board.chains.find(candidate => candidate.id === segment.chainId)!;
  chain.itemIds = chain.itemIds.filter(member => member !== itemId);
  chain.itemIds.splice(chain.itemIds.indexOf(segment.fromId) + 1, 0, itemId);
  return true;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback: string): string => typeof value === 'string' ? value : fallback;
const number = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const boolean = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const safeColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && (/^#[0-9a-f]{3,8}$/i.test(value) || ['inherit', 'transparent'].includes(value)) ? value : fallback;

function normalizeStyle(value: unknown): TextStyle {
  const raw = record(value);
  const defaults = defaultTextStyle();
  return {
    fontSize: number(raw.fontSize, defaults.fontSize, 8, 240),
    fontFamily: string(raw.fontFamily, defaults.fontFamily).slice(0, 120),
    color: safeColor(raw.color, defaults.color),
    bold: boolean(raw.bold, false), italic: boolean(raw.italic, false),
    align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
    background: safeColor(raw.background, defaults.background),
  };
}

/** Normalize old/partial saves without allowing invalid coordinates or edges. */
export function normalizeWorkspace(input: unknown): Workspace {
  const raw = record(input);
  const groups: BoardGroup[] = [];
  const groupsById = new Map<string, BoardGroup>();
  for (const entry of list(raw.groups)) {
    const group = record(entry);
    if (!validId(group.id) || groupsById.has(group.id)) continue;
    const normalized: BoardGroup = {
      id: group.id, name: string(group.name, 'New group').trim() || 'New group',
      parentId: validId(group.parentId) ? group.parentId : null,
      collapsed: boolean(group.collapsed, false),
    };
    groups.push(normalized);
    groupsById.set(normalized.id, normalized);
  }
  for (const group of groups) {
    if (group.parentId === group.id || (group.parentId !== null && !groupsById.has(group.parentId))) group.parentId = null;
  }
  // Break each malformed cycle at the first node reached in input order. The
  // iterative walk is linear overall and preserves all groups and their boards.
  const resolvedGroups = new Set<string>();
  for (const group of groups) {
    const path = new Set<string>();
    let current: BoardGroup | undefined = group;
    while (current && !resolvedGroups.has(current.id)) {
      if (path.has(current.id)) { current.parentId = null; break; }
      path.add(current.id);
      current = current.parentId === null ? undefined : groupsById.get(current.parentId);
    }
    for (const groupId of path) resolvedGroups.add(groupId);
  }
  const assets: MediaAsset[] = [];
  const seenAssets = new Set<string>();
  for (const entry of list(raw.assets)) {
    const asset = record(entry);
    if (!validId(asset.id) || seenAssets.has(asset.id) || typeof asset.path !== 'string'
      || (asset.kind !== 'image' && asset.kind !== 'video')) continue;
    seenAssets.add(asset.id);
    assets.push({ id: asset.id, name: string(asset.name, 'Media'), path: asset.path, kind: asset.kind });
  }
  const boards: Board[] = [];
  const seenBoards = new Set<string>();
  for (const entry of list(raw.boards)) {
    const board = record(entry);
    if (!validId(board.id) || seenBoards.has(board.id)) continue;
    seenBoards.add(board.id);
    const items: Item[] = [];
    const seenItems = new Set<string>();
    for (const candidate of list(board.items)) {
      const item = record(candidate);
      if (!validId(item.id) || seenItems.has(item.id) || !['text', 'image', 'video'].includes(String(item.kind))) continue;
      seenItems.add(item.id);
      const kind = item.kind as ItemKind;
      const normalized: Item = {
        id: item.id, kind,
        x: number(item.x, 0, -1e7, 1e7), y: number(item.y, 0, -1e7, 1e7),
        width: number(item.width, kind === 'text' ? 280 : 320, 24, 10000),
        height: number(item.height, kind === 'text' ? 112 : 220, 24, 10000),
      };
      if (kind === 'text') {
        normalized.text = string(item.text, '');
        normalized.style = normalizeStyle(item.style);
      } else if (validId(item.assetId)) normalized.assetId = item.assetId;
      items.push(normalized);
    }
    const chains: Chain[] = [];
    const seenChains = new Set<string>();
    for (const candidate of list(board.chains)) {
      const chain = record(candidate);
      if (!validId(chain.id) || seenChains.has(chain.id)) continue;
      const itemIds = [...new Set(list(chain.itemIds).filter(validId))].filter(member => seenItems.has(member));
      if (itemIds.length < 2) continue;
      seenChains.add(chain.id);
      chains.push({ id: chain.id, itemIds });
    }
    const viewport = record(board.viewport);
    boards.push({
      id: board.id, name: string(board.name, 'Untitled').trim() || 'Untitled',
      groupId: validId(board.groupId) && groupsById.has(board.groupId) ? board.groupId : null,
      items, chains,
      viewport: {
        x: number(viewport.x, 0, -1e8, 1e8), y: number(viewport.y, 0, -1e8, 1e8),
        zoom: number(viewport.zoom, 1, 0.1, 4),
      },
    });
  }
  if (boards.length === 0) boards.push(createBoard());
  const settings = record(raw.settings);
  return {
    version: 1, boards, groups, assets,
    activeBoardId: typeof raw.activeBoardId === 'string' && boards.some(board => board.id === raw.activeBoardId)
      ? raw.activeBoardId : boards[0].id,
    settings: {
      theme: settings.theme === 'light' ? 'light' : 'dark',
      accent: typeof settings.accent === 'string' && /^#[0-9a-f]{6}$/i.test(settings.accent) ? settings.accent : '#a78bfa',
      grid: boolean(settings.grid, true),
    },
  };
}

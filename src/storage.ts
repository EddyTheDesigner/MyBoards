import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import type { MediaAsset, Workspace } from './model';

export const native = isTauri();
let database: Promise<IDBDatabase> | undefined;
const urls = new Map<string, string>();

function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('myboards-local', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('workspace');
      request.result.createObjectStore('media');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

async function read(store: string, key: string): Promise<unknown> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(store: string, key: string, value: unknown): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Storage write was interrupted'));
  });
}

export async function loadWorkspace(): Promise<unknown> {
  return native ? invoke('load_workspace') : read('workspace', 'current');
}

// Serialize writes so a slower, older snapshot can never replace a newer one.
let saves = Promise.resolve();
export function saveWorkspace(workspace: Workspace): Promise<void> {
  const snapshot = structuredClone(workspace);
  const next = saves.catch(() => {}).then(() => native
    ? invoke<void>('save_workspace', { workspace: snapshot })
    : write('workspace', 'current', snapshot));
  saves = next;
  return next;
}

export async function importPaths(paths: string[]): Promise<MediaAsset[]> {
  return invoke<MediaAsset[]>('import_media', { paths });
}

export async function importFile(file: File): Promise<MediaAsset> {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    throw new Error(`“${file.name}” is not an image or video.`);
  }
  if (file.type === 'image/svg+xml') throw new Error('Use a PNG, JPEG, WebP, GIF, AVIF, or video file.');
  if (native) {
    if (file.size > 50 * 1024 * 1024) throw new Error('This file is too large to paste. Use the media button or drag the file from your file manager.');
    return invoke<MediaAsset>('import_media_bytes', { name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
  }
  const id = crypto.randomUUID();
  await write('media', id, file);
  return { id, name: file.name, path: id, kind: file.type.startsWith('video/') ? 'video' : 'image' };
}

export async function assetUrl(asset: MediaAsset): Promise<string> {
  if (native) return convertFileSrc(asset.path);
  if (urls.has(asset.id)) return urls.get(asset.id)!;
  const blob = await read('media', asset.id);
  if (!(blob instanceof Blob)) throw new Error(`Could not find “${asset.name}” in local storage.`);
  const url = URL.createObjectURL(blob);
  urls.set(asset.id, url);
  return url;
}

export async function storagePath(): Promise<string> {
  return native ? invoke('get_storage_path') : 'This browser’s local storage';
}

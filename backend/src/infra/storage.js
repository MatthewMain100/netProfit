import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.env.ATTACHMENTS_DIR || path.resolve(process.cwd(), 'storage', 'attachments');

export async function ensureStorageRoot() {
  await fs.mkdir(root, { recursive: true });
}

export function attachmentsRoot() {
  return root;
}

export function resolveStoragePath(storageKey) {
  return path.resolve(root, storageKey);
}

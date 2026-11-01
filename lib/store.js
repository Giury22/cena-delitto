import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonStore {
  constructor(path) { this.path = path; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try { await readFile(this.path, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(this.path, JSON.stringify({ version: 1, users: [], teams: [] }, null, 2) + '\n', { flag: 'wx' });
    }
    await this.read();
  }
  async read() {
    await this.queue;
    return this.load();
  }
  async load() {
    const data = JSON.parse(await readFile(this.path, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.teams)) throw new Error('Archivio JSON non valido. Ripristina il backup prima di avviare il sito.');
    return data;
  }
  mutate(callback) {
    const operation = this.queue.then(async () => {
      const data = await this.load();
      const result = await callback(data);
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      await copyFile(this.path, `${this.path}.bak`);
      await rename(temporary, this.path);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

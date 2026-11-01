// Il JSON rimane nella repository. Lo SHA di GitHub impedisce di sovrascrivere
// una modifica concorrente: in caso di conflitto rileggiamo e ripetiamo l'azione.
export class GitHubStore {
  constructor({ token, repository, branch = 'main', file = 'data/registrations.json', fetcher = fetch }) {
    if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Configura GITHUB_TOKEN e GITHUB_REPOSITORY nelle variabili Netlify.');
    this.token = token;
    this.branch = branch;
    this.url = `https://api.github.com/repos/${repository}/contents/${file.split('/').map(encodeURIComponent).join('/')}`;
    this.fetcher = fetcher;
    this.queue = Promise.resolve();
  }
  async init() { await this.snapshot(); }
  async request(method, body) {
    return this.fetcher(`${this.url}${method === 'GET' ? `?ref=${encodeURIComponent(this.branch)}` : ''}`, {
      method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000), cache: 'no-store'
    });
  }
  async snapshot() {
    const response = await this.request('GET');
    if (!response.ok) throw new Error(`Impossibile leggere l'archivio GitHub (${response.status}). Controlla repository, branch e permessi del token.`);
    const file = await response.json();
    const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    if (data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.teams)) throw new Error('Archivio GitHub non valido.');
    return { data, sha: file.sha };
  }
  async read() { await this.queue; return (await this.snapshot()).data; }
  mutate(callback) {
    const operation = this.queue.then(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, sha } = await this.snapshot();
        const result = await callback(data);
        const response = await this.request('PUT', {
          message: 'Aggiorna adesioni cena [skip netlify]', branch: this.branch, sha,
          content: Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64')
        });
        if (response.ok) return result;
        if (![409, 422].includes(response.status)) throw new Error(`Salvataggio GitHub non riuscito (${response.status}).`);
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
      const error = new Error('Ci sono altre modifiche in corso. Riprova tra qualche secondo.');
      error.status = 409; throw error;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

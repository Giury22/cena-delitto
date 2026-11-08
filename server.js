import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { JsonStore } from './lib/store.js';
import { teamColors, teamColorLabel } from './public/team-colors.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const scrypt = promisify(scryptCallback);
const normalized = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');
const nameKey = (first, last) => JSON.stringify([normalized(first), normalized(last)]);
const hashToken = value => createHash('sha256').update(value).digest('hex');
const publicUser = ({ passwordHash, passwordSalt, pinHash, pinSalt, passwordVersion, ...user }) => user;
const currentCredentials = (user, session) => (user.passwordVersion ?? null) === (session.passwordVersion ?? null);
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function teamColor(value, teams, teamId = null) {
  if (typeof value !== 'string' || !Object.hasOwn(teamColors, value)) throw new ApiError(400, 'Scegli un colore per la squadra.');
  if (teams.some(team => team.id !== teamId && team.color === value)) throw new ApiError(409, 'Questo colore è già stato scelto da un’altra squadra. Scegline uno disponibile.');
  return value;
}
function field(value, label, max = 60) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(400, `${label}: inserisci da 1 a ${max} caratteri.`);
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}
function identity(body) {
  const firstName = field(body.firstName, 'Nome');
  const lastName = field(body.lastName, 'Cognome');
  // Accettiamo ancora "pin" per i client precedenti, senza modificarne il valore.
  const password = body.password ?? body.pin;
  if (typeof password !== 'string' || password.length === 0) throw new ApiError(400, 'Inserisci una password.');
  return { firstName, lastName, password, key: nameKey(firstName, lastName) };
}
async function passwordMatches(user, password) {
  // I profili creati con il vecchio PIN continuano ad accedere con le stesse cifre.
  const digest = await scrypt(password, user.passwordSalt ?? user.pinSalt, 32);
  return timingSafeEqual(digest, Buffer.from(user.passwordHash ?? user.pinHash, 'hex'));
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'È richiesto il formato JSON.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16384) throw new ApiError(413, 'Richiesta troppo grande.');
  }
  try {
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError(400, 'Richiesta non valida.'); }
}

export async function createApp({ dataFile = path.join(root, 'data/registrations.json'), adminPassword, adminFirstName, adminLastName, rateLimit = 60, storage, sessionSecret = adminPassword } = {}) {
  if (typeof adminPassword !== 'string' || !adminPassword.length) throw new Error('Configura ADMIN_PASSWORD.');
  if (typeof adminFirstName !== 'string' || !adminFirstName.trim() || typeof adminLastName !== 'string' || !adminLastName.trim()) throw new Error('Configura ADMIN_FIRST_NAME e ADMIN_LAST_NAME.');
  const store = storage || new JsonStore(dataFile);
  await store.init();
  const attempts = new Map();
  const expiry = 7 * 24 * 60 * 60 * 1000;
  const sign = value => createHmac('sha256', sessionSecret).update(`cena-session-v1:${value}`).digest('hex');
  function sessionFor(req) {
    const token = /(?:^|;\s*)cena_session=([A-Za-z0-9_-]+)\.([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if (!token || !timingSafeEqual(Buffer.from(sign(token[1])), Buffer.from(token[2]))) return null;
    try {
      const session = JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8'));
      return session.expires > Date.now() && ['participant', 'admin'].includes(session.role) ? session : null;
    } catch { return null; }
  }
  function setSession(req, res, value) {
    const payload = Buffer.from(JSON.stringify({ ...value, expires: Date.now() + expiry, nonce: randomBytes(12).toString('hex') })).toString('base64url');
    const token = `${payload}.${sign(payload)}`;
    res.setHeader('Set-Cookie', `cena_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${expiry / 1000}${req.socket.encrypted || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
  }
  function limit(req) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    const key = req.socket.remoteAddress;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    entry.count++; attempts.set(key, entry);
    if (entry.count > rateLimit) throw new ApiError(429, 'Troppi tentativi. Riprova tra 15 minuti.');
  }
  async function state(session) {
    const data = await store.read();
    if (session?.role === 'admin') return { role: 'admin', admin: { firstName: adminFirstName, lastName: adminLastName }, users: data.users.map(publicUser), teams: data.teams };
    if (session?.role === 'participant') {
      const user = data.users.find(item => item.id === session.userId);
      if (user && currentCredentials(user, session)) return { role: 'participant', user: publicUser(user), teams: data.teams.map(team => ({ ...team, members: data.users.filter(item => item.teamId === team.id).map(item => ({ id: item.id, nickname: item.nickname, attending: item.attending })) })) };
    }
    return { role: 'guest' };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/team-colors.js': ['team-colors.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
        if (!['GET', 'HEAD'].includes(req.method) || !files[url.pathname]) throw new ApiError(404, 'Pagina non trovata.');
        const [file, type] = files[url.pathname];
        const content = await readFile(path.join(root, 'public', file));
        res.writeHead(200, { 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) throw new ApiError(405, 'Metodo non consentito.');
      if (req.method !== 'GET') {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'Origine non consentita.');
        if (req.headers.origin) {
          let origin; try { origin = new URL(req.headers.origin); } catch { throw new ApiError(403, 'Origine non consentita.'); }
          if (origin.host !== req.headers.host) throw new ApiError(403, 'Origine non consentita.');
        }
      }
      const session = sessionFor(req);
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await state(session));
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        await readBody(req);
        res.setHeader('Set-Cookie', `cena_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${req.socket.encrypted || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
        limit(req);
        const body = await readBody(req);
        const { firstName, lastName, key, password } = identity(body);
        let user;
        if (url.pathname.endsWith('/register')) {
          const nickname = field(body.nickname || firstName, 'Soprannome', 32);
          const passwordSalt = randomBytes(16).toString('hex');
          const passwordHash = (await scrypt(password, passwordSalt, 32)).toString('hex');
          user = await store.mutate(async data => {
            for (const candidate of data.users.filter(item => nameKey(item.firstName, item.lastName) === key)) {
              if (await passwordMatches(candidate, password)) throw new ApiError(409, 'Esiste già un profilo con questi dati e questa password. Usa «Accedi».');
            }
            const item = { id: randomUUID(), firstName, lastName, nickname, passwordSalt, passwordHash, teamId: null, killerPreference: 'undecided', attending: true, createdAt: new Date().toISOString() };
            data.users.push(item); return item;
          });
        } else {
          const data = await store.read();
          for (const candidate of data.users.filter(item => nameKey(item.firstName, item.lastName) === key)) if (await passwordMatches(candidate, password)) { user = candidate; break; }
          if (!user) throw new ApiError(401, 'Nome, cognome o password non corretti.');
        }
        const participant = { role: 'participant', userId: user.id, passwordVersion: user.passwordVersion };
        setSession(req, res, participant);
        return send(200, await state(participant));
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/admin') {
        limit(req);
        const body = await readBody(req);
        const passwordCorrect = typeof body.password === 'string' && timingSafeEqual(Buffer.from(hashToken(body.password)), Buffer.from(hashToken(adminPassword)));
        const nameCorrect = typeof body.firstName === 'string' && typeof body.lastName === 'string' && nameKey(body.firstName, body.lastName) === nameKey(adminFirstName, adminLastName);
        if (!passwordCorrect || !nameCorrect) throw new ApiError(401, 'Nome, cognome o password amministratore non corretti.');
        setSession(req, res, { role: 'admin' }); return send(200, await state({ role: 'admin' }));
      }
      if (!session) throw new ApiError(401, 'Accedi per continuare.');
      if (req.method === 'GET' && url.pathname === '/api/admin/export') {
        if (session.role !== 'admin') throw new ApiError(403, 'Accesso riservato all’organizzatore.');
        const data = await store.read();
        const cell = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
        const preference = { yes: 'Disponibile', no: 'Preferisce di no', undecided: 'Indifferente' };
        const rows = [['Nome', 'Cognome', 'Soprannome', 'Squadra', 'Partecipazione', 'Assassino', 'Colore squadra'], ...data.users.map(user => {
          const team = data.teams.find(team => team.id === user.teamId);
          return [user.firstName, user.lastName, user.nickname, team?.name || '', user.attending ? 'Confermata' : 'Rinunciata', preference[user.killerPreference], team ? teamColorLabel(team.color) : ''];
        })];
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="partecipanti.csv"' });
        res.end('\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n')); return;
      }
      const passwordTarget = /^\/api\/admin\/users\/([^/]+)\/password$/.exec(url.pathname);
      if (req.method === 'PATCH' && passwordTarget) {
        if (session.role !== 'admin') throw new ApiError(403, 'Accesso riservato all’organizzatore.');
        const { password } = await readBody(req);
        if (typeof password !== 'string' || password.length === 0) throw new ApiError(400, 'Inserisci una nuova password.');
        const passwordSalt = randomBytes(16).toString('hex');
        const passwordHash = (await scrypt(password, passwordSalt, 32)).toString('hex');
        await store.mutate(async data => {
          const user = data.users.find(item => item.id === passwordTarget[1]);
          if (!user) throw new ApiError(404, 'Profilo non trovato. Potrebbe essere già stato eliminato.');
          for (const candidate of data.users.filter(item => item.id !== user.id && nameKey(item.firstName, item.lastName) === nameKey(user.firstName, user.lastName))) {
            if (await passwordMatches(candidate, password)) throw new ApiError(409, 'Un omonimo usa già questa password. Scegline una diversa per distinguere i due profili.');
          }
          user.passwordSalt = passwordSalt;
          user.passwordHash = passwordHash;
          user.passwordVersion = randomUUID();
          delete user.pinHash;
          delete user.pinSalt;
        });
        return send(200, await state(session));
      }
      const deleteTarget = /^\/api\/admin\/(users|teams)\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'DELETE' && deleteTarget) {
        if (session.role !== 'admin') throw new ApiError(403, 'Accesso riservato all’organizzatore.');
        await readBody(req);
        const [, collection, id] = deleteTarget;
        await store.mutate(data => {
          if (collection === 'users') {
            const index = data.users.findIndex(user => user.id === id);
            if (index === -1) throw new ApiError(404, 'Profilo non trovato. Potrebbe essere già stato eliminato.');
            data.users.splice(index, 1);
            for (const team of data.teams) if (team.createdBy === id) team.createdBy = null;
          } else {
            const index = data.teams.findIndex(team => team.id === id);
            if (index === -1) throw new ApiError(404, 'Squadra non trovata. Potrebbe essere già stata eliminata.');
            data.teams.splice(index, 1);
            for (const user of data.users) if (user.teamId === id) user.teamId = null;
          }
        });
        return send(200, await state(session));
      }
      if (session.role !== 'participant') throw new ApiError(403, 'Questa azione è riservata ai partecipanti.');
      const body = await readBody(req);
      await store.mutate(data => {
        const user = data.users.find(item => item.id === session.userId);
        if (!user) throw new ApiError(401, 'Profilo non trovato.');
        if (!currentCredentials(user, session)) throw new ApiError(401, 'La password è stata cambiata. Accedi di nuovo.');
        if (req.method === 'PATCH' && url.pathname === '/api/me') {
          if (body.nickname !== undefined) user.nickname = field(body.nickname, 'Soprannome', 32);
          if (body.killerPreference !== undefined) {
            if (!['yes', 'no', 'undecided'].includes(body.killerPreference)) throw new ApiError(400, 'Preferenza non valida.');
            user.killerPreference = body.killerPreference;
          }
          if (body.attending !== undefined) {
            if (typeof body.attending !== 'boolean') throw new ApiError(400, 'Partecipazione non valida.');
            user.attending = body.attending;
          }
        } else if (req.method === 'POST' && url.pathname === '/api/teams') {
          const name = field(body.name, 'Nome squadra', 40);
          const color = teamColor(body.color, data.teams);
          if (data.teams.some(team => normalized(team.name) === normalized(name))) throw new ApiError(409, 'Questo nome squadra è già in uso.');
          const team = { id: randomUUID(), name, color, createdBy: user.id, createdAt: new Date().toISOString() };
          data.teams.push(team); user.teamId = team.id;
        } else if (req.method === 'PATCH' && url.pathname === '/api/team/color') {
          const team = data.teams.find(item => item.id === user.teamId);
          if (!team) throw new ApiError(403, 'Unisciti a una squadra per sceglierne il colore.');
          team.color = teamColor(body.color, data.teams, team.id);
        } else if (req.method === 'PATCH' && url.pathname === '/api/team') {
          if (body.teamId !== null && !data.teams.some(team => team.id === body.teamId)) throw new ApiError(404, 'Squadra non trovata.');
          user.teamId = body.teamId;
        } else throw new ApiError(404, 'Operazione non trovata.');
      });
      return send(200, await state(session));
    } catch (error) {
      if (!error.status) console.error('Errore del server:', error.message);
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Non è stato possibile salvare. Riprova tra poco.', ...(error.code?.startsWith('GITHUB_') ? { code: error.code } : {}) });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  return { server, store };
}

async function start() {
  let env = '';
  try { env = await readFile(path.join(root, '.env'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const line of env.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!process.env.ADMIN_PASSWORD) {
    const password = randomBytes(18).toString('base64url');
    env = env.replace(/^ADMIN_PASSWORD=.*\r?\n?/m, '');
    await writeFile(path.join(root, '.env'), `${env.trim()}\nADMIN_PASSWORD=${password}\n`, { mode: 0o600 });
    process.env.ADMIN_PASSWORD = password;
    console.log('Password amministratore creata nel file .env (escluso da Git).');
  }
  const { server } = await createApp({ adminPassword: process.env.ADMIN_PASSWORD, adminFirstName: process.env.ADMIN_FIRST_NAME, adminLastName: process.env.ADMIN_LAST_NAME, sessionSecret: process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Cena con delitto: http://localhost:${port}`));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start().catch(error => { console.error(error.message); process.exitCode = 1; });

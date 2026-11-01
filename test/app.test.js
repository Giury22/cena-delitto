import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { JsonStore } from '../lib/store.js';
import { GitHubStore } from '../lib/github-store.js';
import netlifyHandler, { adaptHandler } from '../netlify/functions/api.mjs';

const password = 'prova';
const adminIdentity = { firstName: 'OrganizzatoreTest', lastName: 'EsempioTest' };
const adminConfig = { adminFirstName: adminIdentity.firstName, adminLastName: adminIdentity.lastName };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cena-test-'));
  const dataFile = path.join(directory, 'registrations.json');
  const app = await createApp({ dataFile, adminPassword: password, ...adminConfig, rateLimit: 100 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  async function call(route, method = 'GET', data, cookie, extraHeaders = {}) {
    const response = await fetch(url + route, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, body: data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text();
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
  }
  return { ...app, call, dataFile };
}
const person = (firstName = 'Giulia', password = '123456') => ({ firstName, lastName: 'Rossi', nickname: 'La Lince', password });

test('registrazione, ritorno al profilo, omonimi e protezione delle password', async t => {
  const { call, dataFile } = await fixture(t);
  assert.deepEqual((await call('/api/state')).body, { role: 'guest' });
  const registered = await call('/api/auth/register', 'POST', person());
  assert.equal(registered.status, 200);
  assert.equal(registered.body.user.attending, true);
  assert.equal(registered.body.user.pinHash, undefined);
  assert.equal(registered.body.user.passwordHash, undefined);
  assert.equal(registered.body.user.passwordSalt, undefined);
  const id = registered.body.user.id;
  assert.equal((await call('/api/auth/register', 'POST', person())).status, 409);
  const namesake = await call('/api/auth/register', 'POST', person('Giulia', '654321'));
  assert.notEqual(namesake.body.user.id, id);
  const login = await call('/api/auth/login', 'POST', { ...person(), firstName: ' GIULIA ', lastName: 'ROSSI' });
  assert.equal(login.body.user.id, id);
  assert.equal((await call('/api/auth/login', 'POST', person('Giulia', '111111'))).status, 401);
  assert.equal((await call('/api/state', 'GET', undefined, login.cookie)).body.user.id, id);
  const saved = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(saved.users.length, 2);
  assert.equal(saved.users[0].pin, undefined);
  assert.equal(saved.users[0].password, undefined);
  assert.notEqual(saved.users[0].passwordHash, saved.users[1].passwordHash);
  assert.equal((await call('/data/registrations.json')).status, 404);
  assert.equal((await call('/.env')).status, 404);
});

test('password libere: brevi, lunghe, Unicode, simboli e spazi sono conservati esattamente', async t => {
  const { call } = await fixture(t);
  const passwords = ['a', ' cena delitto! 🍝 ', 'x'.repeat(1024), '   '];
  for (const [index, chosen] of passwords.entries()) {
    const credentials = person(`Persona ${index}`, chosen);
    const registered = await call('/api/auth/register', 'POST', credentials);
    assert.equal(registered.status, 200);
    const login = await call('/api/auth/login', 'POST', credentials);
    assert.equal(login.body.user.id, registered.body.user.id);
    assert.equal((await call('/api/auth/login', 'POST', { ...credentials, password: chosen + 'x' })).status, 401);
    if (chosen.trim() !== chosen) assert.equal((await call('/api/auth/login', 'POST', { ...credentials, password: chosen.trim() || 'x' })).status, 401);
  }
  for (const invalid of ['', null, 123456]) assert.equal((await call('/api/auth/register', 'POST', person('Senza password', invalid))).status, 400);
});

test('i profili con PIN precedente restano accessibili e non espongono gli hash', async t => {
  const { call, store } = await fixture(t);
  const registered = await call('/api/auth/register', 'POST', person());
  await store.mutate(data => {
    const user = data.users[0];
    user.pinHash = user.passwordHash; user.pinSalt = user.passwordSalt;
    delete user.passwordHash; delete user.passwordSalt;
  });
  const login = await call('/api/auth/login', 'POST', person());
  assert.equal(login.body.user.id, registered.body.user.id);
  assert.equal(login.body.user.pinHash, undefined);
  assert.equal(login.body.user.pinSalt, undefined);
  const { password: legacyPin, ...credentials } = person();
  assert.equal((await call('/api/auth/login', 'POST', { ...credentials, pin: legacyPin })).status, 200);
  assert.equal((await call('/api/auth/register', 'POST', person())).status, 409);
});

test('squadre, modifiche simultanee e preferenze private', async t => {
  const { call, dataFile } = await fixture(t);
  const a = await call('/api/auth/register', 'POST', person('Anna'));
  const b = await call('/api/auth/register', 'POST', person('Luca'));
  const created = await call('/api/teams', 'POST', { name: 'I sospetti' }, a.cookie);
  const teamId = created.body.user.teamId;
  assert.equal(created.body.teams.length, 1);
  assert.equal((await call('/api/teams', 'POST', { name: ' i SOSPETTI ' }, b.cookie)).status, 409);
  const updates = await Promise.all([
    call('/api/me', 'PATCH', { nickname: 'Ombra', killerPreference: 'yes' }, a.cookie),
    call('/api/team', 'PATCH', { teamId }, b.cookie)
  ]);
  assert.ok(updates.every(item => item.status === 200));
  const current = (await call('/api/state', 'GET', undefined, b.cookie)).body;
  assert.equal(current.teams[0].members.length, 2);
  assert.deepEqual(Object.keys(current.teams[0].members[0]).sort(), ['attending', 'id', 'nickname']);
  const persisted = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(persisted.users[0].killerPreference, 'yes');
  assert.equal(persisted.users[1].teamId, teamId);
  assert.equal((await call('/api/team', 'PATCH', { teamId: 'missing' }, a.cookie)).status, 404);
  assert.equal((await call('/api/me', 'PATCH', { killerPreference: 'invalid' }, a.cookie)).status, 400);
  const left = await call('/api/team', 'PATCH', { teamId: null }, b.cookie);
  assert.equal(left.body.user.teamId, null);
  assert.equal((await call('/api/me', 'PATCH', { attending: false }, a.cookie)).body.user.attending, false);
});

test('amministrazione, CSV, controlli accesso, origine e sessione firmata', async t => {
  const { call } = await fixture(t);
  const user = await call('/api/auth/register', 'POST', { ...person(), nickname: '=1+1' });
  assert.equal((await call('/api/admin/export', 'GET', undefined, user.cookie)).status, 403);
  assert.equal((await call('/api/admin/export')).status, 401);
  assert.equal((await call('/api/auth/admin', 'POST', { ...adminIdentity, password: 'wrong' })).status, 401);
  assert.equal((await call('/api/auth/admin', 'POST', { ...adminIdentity, firstName: 'Altro', password })).status, 401);
  assert.equal((await call('/api/auth/admin', 'POST', { password })).status, 401);
  assert.equal((await call('/api/me', 'PATCH', { nickname: 'hacked' }, user.cookie, { Origin: 'https://altro.example' })).status, 403);
  const admin = await call('/api/auth/admin', 'POST', { ...adminIdentity, firstName: ` ${adminIdentity.firstName.toUpperCase()} `, lastName: adminIdentity.lastName.toLowerCase(), password });
  assert.equal(admin.body.role, 'admin');
  assert.deepEqual(admin.body.admin, adminIdentity);
  assert.equal(admin.body.users[0].pinHash, undefined);
  assert.equal(admin.body.users[0].pinSalt, undefined);
  assert.equal(admin.body.users[0].passwordHash, undefined);
  assert.equal(admin.body.users[0].passwordSalt, undefined);
  const csv = await call('/api/admin/export', 'GET', undefined, admin.cookie);
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes("'=1+1"));
  assert.ok(!csv.body.includes('pinHash'));
  assert.ok(!csv.body.includes('passwordHash'));
  const parts = user.cookie.split('=')[1].split('.');
  const forged = Buffer.from(JSON.stringify({ role: 'admin', expires: Date.now() + 999999 })).toString('base64url');
  assert.equal((await call('/api/state', 'GET', undefined, `cena_session=${forged}.${parts[1]}`)).body.role, 'guest');
  const logout = await call('/api/auth/logout', 'POST', {}, admin.cookie);
  assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
});

test('solo admin elimina profili: rimuove appartenenza, accesso e riferimenti al creatore', async t => {
  const { call, dataFile } = await fixture(t);
  const owner = await call('/api/auth/register', 'POST', person('Creatore'));
  const member = await call('/api/auth/register', 'POST', person('Membro'));
  const created = await call('/api/teams', 'POST', { name: 'Squadra da conservare' }, owner.cookie);
  const teamId = created.body.user.teamId;
  await call('/api/team', 'PATCH', { teamId }, member.cookie);
  const target = `/api/admin/users/${owner.body.user.id}`;
  assert.equal((await call(target, 'DELETE', {})).status, 401);
  assert.equal((await call(target, 'DELETE', {}, member.cookie)).status, 403);
  const admin = await call('/api/auth/admin', 'POST', { ...adminIdentity, password });
  assert.equal((await call(target, 'DELETE', {}, admin.cookie, { Origin: 'https://altro.example' })).status, 403);
  const deleted = await call(target, 'DELETE', {}, admin.cookie);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.users.length, 1);
  assert.equal(deleted.body.users[0].id, member.body.user.id);
  assert.equal(deleted.body.teams[0].createdBy, null);
  assert.equal(deleted.body.users[0].teamId, teamId);
  assert.equal((await call('/api/state', 'GET', undefined, owner.cookie)).body.role, 'guest');
  assert.equal((await call('/api/auth/login', 'POST', person('Creatore'))).status, 401);
  assert.equal((await call('/api/me', 'PATCH', { nickname: 'Ritorno' }, owner.cookie)).status, 401);
  assert.equal((await call(target, 'DELETE', {}, admin.cookie)).status, 404);
  const csv = await call('/api/admin/export', 'GET', undefined, admin.cookie);
  assert.ok(!csv.body.includes('Creatore'));
  const stored = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(stored.users.length, 1);
  assert.equal(stored.teams.length, 1);
  assert.equal((await call('/api/state', 'GET', undefined, member.cookie)).body.teams[0].members.length, 1);
});

test('eliminare una squadra da Netlify conserva membri e altri gruppi e azzera le appartenenze', async t => {
  const { call, server, dataFile } = await fixture(t);
  const a = await call('/api/auth/register', 'POST', person('Anna'));
  const b = await call('/api/auth/register', 'POST', person('Bruno'));
  const c = await call('/api/auth/register', 'POST', person('Carla'));
  const first = await call('/api/teams', 'POST', { name: 'Da eliminare' }, a.cookie);
  const second = await call('/api/teams', 'POST', { name: 'Da tenere' }, c.cookie);
  await call('/api/team', 'PATCH', { teamId: first.body.user.teamId }, b.cookie);
  await call('/api/me', 'PATCH', { attending: false }, b.cookie);
  const target = `/api/admin/teams/${first.body.user.teamId}`;
  assert.equal((await call(target, 'DELETE', {})).status, 401);
  assert.equal((await call(target, 'DELETE', {}, a.cookie)).status, 403);
  const admin = await call('/api/auth/admin', 'POST', { ...adminIdentity, password });
  const handler = adaptHandler(server.listeners('request')[0]);
  const response = await handler(new Request(`https://cena.example${target}`, {
    method: 'DELETE', headers: { Cookie: admin.cookie, Origin: 'https://cena.example', 'Content-Type': 'application/json' }, body: '{}'
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.users.length, 3);
  assert.equal(result.teams.length, 1);
  assert.equal(result.teams[0].id, second.body.user.teamId);
  assert.equal(result.users.find(user => user.id === a.body.user.id).teamId, null);
  assert.equal(result.users.find(user => user.id === b.body.user.id).teamId, null);
  assert.equal(result.users.find(user => user.id === c.body.user.id).teamId, second.body.user.teamId);
  assert.equal((await call(target, 'DELETE', {}, admin.cookie)).status, 404);
  assert.equal((await call('/api/auth/login', 'POST', person('Anna'))).status, 200);
  assert.equal((await call('/api/team', 'PATCH', { teamId: first.body.user.teamId }, a.cookie)).status, 404);
  assert.equal(JSON.parse(await readFile(dataFile, 'utf8')).teams.length, 1);
});

test('le sessioni continuano a funzionare tra istanze serverless', async t => {
  const { dataFile, call } = await fixture(t);
  const user = await call('/api/auth/register', 'POST', person());
  const second = await createApp({ dataFile, adminPassword: password, ...adminConfig });
  const handler = adaptHandler(second.server.listeners('request')[0]);
  const response = await handler(new Request('https://cena.example/api/state', { headers: { Cookie: user.cookie } }));
  assert.equal((await response.json()).user.id, user.body.user.id);
  const adminResponse = await handler(new Request('https://cena.example/api/auth/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://cena.example' }, body: JSON.stringify({ ...adminIdentity, password }) }));
  assert.equal(adminResponse.status, 200);
  assert.ok(adminResponse.headers.get('set-cookie').includes('Secure'));
  const tooBig = await handler(new Request('https://cena.example/api/auth/login', { method: 'POST', body: 'x'.repeat(17000) }));
  assert.equal(tooBig.status, 413);
});

test('Netlify indica le variabili mancanti senza esporre valori o segreti', async t => {
  const required = ['ADMIN_FIRST_NAME', 'ADMIN_LAST_NAME', 'ADMIN_PASSWORD', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY'];
  const previous = Object.fromEntries(required.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  for (const name of required) delete process.env[name];
  process.env.ADMIN_PASSWORD = 'valore-segreto-di-test';
  const response = await netlifyHandler(new Request('https://cena.example/api/state'), {});
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.code, 'CONFIG_MISSING');
  assert.deepEqual(result.missing, required.filter(name => name !== 'ADMIN_PASSWORD'));
  assert.ok(!JSON.stringify(result).includes('valore-segreto-di-test'));
});

test('GitHub: un conflitto rilegge il JSON e conserva entrambe le modifiche', async () => {
  let data = { version: 1, users: [], teams: [] }; let revision = 1; let conflict = true;
  const requests = [];
  const store = new GitHubStore({ token: 'test-token', repository: 'test/cena', fetcher: async (url, options) => {
    requests.push(options.method);
    if (options.method === 'GET') return Response.json({ sha: String(revision), content: Buffer.from(JSON.stringify(data)).toString('base64') });
    const body = JSON.parse(options.body);
    if (conflict) { conflict = false; data.teams.push({ id: 'other', name: 'Altri amici' }); revision++; return Response.json({}, { status: 409 }); }
    assert.equal(body.sha, String(revision));
    assert.ok(body.message.includes('[skip netlify]'));
    data = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); revision++;
    return Response.json({}, { status: 200 });
  } });
  await store.init();
  await store.mutate(value => value.users.push({ id: 'one' }));
  assert.equal(data.teams[0].id, 'other');
  assert.equal(data.users[0].id, 'one');
  assert.equal(requests.filter(method => method === 'PUT').length, 2);
});

test('un token senza permesso di scrittura produce un errore preciso senza perdere dati', async () => {
  let writes = 0;
  const original = { version: 1, users: [], teams: [] };
  const token = 'token-fittizio-da-non-esporre';
  const storage = new GitHubStore({ token, repository: 'test/cena', fetcher: async (url, options) => {
    if (options.method === 'GET') return Response.json({ sha: 'original', content: Buffer.from(JSON.stringify(original)).toString('base64') });
    writes++;
    return Response.json({ message: 'Resource not accessible by personal access token' }, { status: 403 });
  } });
  const { server } = await createApp({ storage, adminPassword: password, ...adminConfig });
  const handler = adaptHandler(server.listeners('request')[0]);
  const response = await handler(new Request('https://cena.example/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(person())
  }));
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.code, 'GITHUB_WRITE_FORBIDDEN');
  assert.ok(result.error.includes('Contents: Read and write'));
  assert.ok(!JSON.stringify(result).includes(token));
  assert.equal(writes, 1);
  assert.deepEqual(await storage.read(), original);
});

test('il JSON corrotto non viene azzerato e il backup conserva la versione precedente', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cena-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'data.json');
  const store = new JsonStore(filename);
  await store.init();
  await store.mutate(data => data.users.push({ id: 'saved' }));
  assert.equal(JSON.parse(await readFile(`${filename}.bak`, 'utf8')).users.length, 0);
  await writeFile(filename, 'corrupted');
  await assert.rejects(store.init());
  assert.equal(await readFile(filename, 'utf8'), 'corrupted');
});

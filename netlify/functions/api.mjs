import { Readable } from 'node:stream';
import { createApp } from '../../server.js';
import { GitHubStore } from '../../lib/github-store.js';

let appPromise;
export function adaptHandler(handler) {
  return async (request, context = {}) => {
    const url = new URL(request.url);
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 16384) return Response.json({ error: 'Richiesta troppo grande.' }, { status: 413 });
    // Leggiamo a blocchi anche quando il client omette Content-Length.
    const chunks = []; let size = 0;
    if (request.body) {
      for await (const chunk of request.body) {
        size += chunk.byteLength;
        if (size > 16384) return Response.json({ error: 'Richiesta troppo grande.' }, { status: 413 });
        chunks.push(Buffer.from(chunk));
      }
    }
    const req = Readable.from(chunks);
    req.url = url.pathname + url.search;
    req.method = request.method;
    req.headers = Object.fromEntries(request.headers);
    req.headers.host = url.host;
    req.socket = { encrypted: url.protocol === 'https:', remoteAddress: context.ip || 'unknown' };
    const headers = new Headers();
    let status = 200; let content;
    const res = {
      headersSent: false,
      setHeader(name, value) { headers.set(name, String(value)); },
      writeHead(code, values = {}) { status = code; for (const [name, value] of Object.entries(values)) headers.set(name, String(value)); this.headersSent = true; },
      end(body) { content = body; }
    };
    await handler(req, res);
    return new Response(content, { status, headers });
  };
}
export default async function handler(request, context) {
  const required = ['ADMIN_FIRST_NAME', 'ADMIN_LAST_NAME', 'ADMIN_PASSWORD', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY'];
  const missing = required.filter(name => !process.env[name]?.trim());
  if (missing.length) {
    return Response.json({
      code: 'CONFIG_MISSING',
      error: `Configurazione Netlify incompleta: mancano ${missing.join(', ')}. L’organizzatore deve impostarle nelle variabili d’ambiente delle Functions ed eseguire un nuovo deploy.`,
      missing
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    appPromise ||= createApp({
      adminPassword: process.env.ADMIN_PASSWORD,
      adminFirstName: process.env.ADMIN_FIRST_NAME,
      adminLastName: process.env.ADMIN_LAST_NAME,
      sessionSecret: process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD,
      storage: new GitHubStore({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, branch: process.env.GITHUB_DATA_BRANCH || 'main' })
    }).catch(error => { appPromise = undefined; throw error; });
    const { server } = await appPromise;
    return await adaptHandler(server.listeners('request')[0])(request, context);
  } catch (error) {
    console.error('Configurazione API:', error.message);
    if (error.code?.startsWith('GITHUB_')) return Response.json({ error: error.message, code: error.code }, { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ error: 'Il sito è in preparazione. L’organizzatore deve completare la configurazione di Netlify.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const config = { path: '/api/*' };

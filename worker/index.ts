/*
 * CatLog's Cloudflare Worker. It serves the built app (static assets) and adds three small things:
 *
 *   GET or POST /api/add?k=KEY&cat=Stormy&type=poo   one-tap logging for iOS Shortcuts, widgets, Siri
 *   POST        /api/log  { k, text }                 logs every "<cat> pooed/barfed" line in some text
 *   email()                                           the same, for mail sent to an Email Routing address
 *
 * All of them call database functions that check the shortcut key, so the worker holds no secrets
 * of its own. The Supabase URL and publishable key are public (the same ones the app ships).
 */

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  /** Optional: shortcut key used for mail that arrives through Email Routing. */
  CATLOG_EMAIL_KEY?: string;
  /** Optional: comma-separated sender addresses allowed to log by email. Empty = anyone who knows the address. */
  CATLOG_EMAIL_FROM?: string;
}

interface EmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}

type Json = Record<string, unknown>;

async function rpc(env: Env, fn: string, args: Json): Promise<Json> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) return { ok: false, message: String(body.message ?? `Couldn’t reach CatLog (${res.status}).`) };
  return body;
}

/** Shortcuts shows plain text nicely; ask for JSON with ?format=json or an Accept header. */
function reply(req: Request, url: URL, body: Json): Response {
  const wantsJson = url.searchParams.get('format') === 'json' || (req.headers.get('accept') ?? '').includes('application/json');
  const status = body.ok === false ? 400 : 200;
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  return wantsJson
    ? Response.json(body, { status, headers })
    : new Response(String(body.message ?? (body.ok ? 'Logged' : 'Something went wrong')), { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function params(req: Request, url: URL): Promise<Record<string, string>> {
  const out: Record<string, string> = Object.fromEntries(url.searchParams);
  if (req.method === 'POST') {
    const type = req.headers.get('content-type') ?? '';
    if (type.includes('application/json')) Object.assign(out, (await req.json().catch(() => ({}))) as Record<string, string>);
    else if (type.includes('form')) for (const [k, v] of await req.formData()) out[k] = String(v);
    else {
      const text = await req.text();
      if (text && !out.text) out.text = text;
    }
  }
  return out;
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST' } });
  if (url.pathname === '/api/ping') return Response.json({ ok: true, app: 'catlog' });
  const p = await params(req, url);
  const key = p.k ?? p.key ?? '';
  if (!key) return reply(req, url, { ok: false, message: 'Add your shortcut key as ?k=… (make one in CatLog, Settings, Shortcuts).' });
  if (url.pathname === '/api/add') {
    const args: Json = { p_key: key, p_cats: p.cat ?? p.cats ?? 'somebody', p_type: p.type ?? 'Pooed', p_notes: p.notes ?? '', p_source: p.source || 'shortcut' };
    if (p.at) args.p_at = p.at;
    return reply(req, url, await rpc(env, 'catlog_quick_add', args));
  }
  if (url.pathname === '/api/log') return reply(req, url, await rpc(env, 'catlog_log_text', { p_key: key, p_text: p.text ?? '', p_source: p.source || 'api' }));
  return reply(req, url, { ok: false, message: 'Unknown CatLog API address.' });
}

// ---------- email ----------

function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs: string, enc: string, data: string) => {
    try {
      const bytes = enc.toLowerCase() === 'b' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : qp(data.replace(/_/g, ' '));
      return new TextDecoder(cs).decode(bytes);
    } catch {
      return data;
    }
  });
}

function qp(s: string): Uint8Array {
  const clean = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '=' && /^[0-9a-f]{2}$/i.test(clean.slice(i + 1, i + 3))) {
      out.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(clean.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function splitHead(part: string): { head: string; body: string } {
  const i = part.search(/\r?\n\r?\n/);
  return i < 0 ? { head: part, body: '' } : { head: part.slice(0, i), body: part.slice(i).replace(/^\r?\n\r?\n/, '') };
}

function header(head: string, name: string): string {
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  const m = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded);
  return m ? m[1].trim() : '';
}

/** The readable text of a MIME message: text/plain parts, or HTML with tags removed. Quoted replies are dropped. */
export function mailText(raw: string): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: string) => {
    const { head, body } = splitHead(part);
    const type = header(head, 'Content-Type').toLowerCase() || 'text/plain';
    const boundary = /boundary="?([^";]+)"?/i.exec(header(head, 'Content-Type'))?.[1];
    if (type.startsWith('multipart/') && boundary) {
      for (const sub of body.split(`--${boundary}`).slice(1)) if (!sub.startsWith('--')) walk(sub.replace(/^\r?\n/, ''));
      return;
    }
    if (!type.startsWith('text/')) return;
    const enc = header(head, 'Content-Transfer-Encoding').toLowerCase();
    const charset = /charset="?([^";]+)"?/i.exec(type)?.[1] ?? 'utf-8';
    let bytes: Uint8Array;
    if (enc === 'base64') bytes = Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    else if (enc === 'quoted-printable') bytes = qp(body);
    else bytes = new TextEncoder().encode(body);
    let text: string;
    try {
      text = new TextDecoder(charset).decode(bytes);
    } catch {
      text = new TextDecoder().decode(bytes);
    }
    (type.startsWith('text/html') ? html : plain).push(text);
  };
  walk(raw);
  let text = plain.join('\n');
  if (!text.trim() && html.length)
    text = html
      .join('\n')
      .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  // Stop at the quoted earlier message, so a reply doesn't log the old events again.
  const cut = text.search(/^(>|On .+wrote:|-----Original Message-----|From: )/im);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

async function email(message: EmailMessage, env: Env): Promise<void> {
  const allowed = (env.CATLOG_EMAIL_FROM ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(message.from.toLowerCase())) {
    message.setReject('This address only takes CatLog updates from its owner.');
    return;
  }
  const plus = /\+([A-Za-z0-9_-]{16,})@/.exec(message.to)?.[1];
  const key = plus ?? env.CATLOG_EMAIL_KEY ?? '';
  if (!key) {
    message.setReject('CatLog isn’t set up for email yet.');
    return;
  }
  const raw = await new Response(message.raw).text();
  const { head } = splitHead(raw);
  const subject = decodeWords(header(head, 'Subject')).replace(/^(re|fw|fwd):\s*/i, '');
  await rpc(env, 'catlog_log_text', { p_key: key, p_text: `${subject}\n${mailText(raw)}`, p_source: 'email' });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return api(req, env, url);
    return env.ASSETS.fetch(req);
  },
  email,
};

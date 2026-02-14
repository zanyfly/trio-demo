import { createServer } from 'node:http';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const publicDir = path.join(cwd, 'public');

loadDotEnv(path.join(cwd, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TRIO_BASE_URL = process.env.TRIO_BASE_URL || 'https://trio.machinefi.com';
const TRIO_API_KEY = process.env.TRIO_API_KEY || '';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function loadDotEnv(envPath) {
  try {
    const content = readFileSync(envPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const index = line.indexOf('=');
      if (index === -1) {
        continue;
      }
      const key = line.slice(0, index).trim();
      if (!key || process.env[key]) {
        continue;
      }
      const value = line.slice(index + 1).trim().replace(/^"|"$/g, '');
      process.env[key] = value;
    }
  } catch {
    // .env is optional for local development.
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

function hasApiKey() {
  return typeof TRIO_API_KEY === 'string' && TRIO_API_KEY.length > 0;
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return undefined;
}

async function proxyTrio({ method, pathWithQuery, body }) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${TRIO_API_KEY}`
  };

  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${TRIO_BASE_URL}${pathWithQuery}`, {
    method,
    headers,
    body: payload
  });

  const contentType = response.headers.get('content-type') || MIME_TYPES['.json'];
  const text = await response.text();

  let parsed = text;
  if (contentType.includes('application/json')) {
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
  }

  return {
    contentType,
    ok: response.ok,
    payload: parsed,
    status: response.status
  };
}

function sanitizePath(requestPath) {
  const cleanPath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const normalized = path.normalize(cleanPath);
  if (normalized.startsWith('..')) {
    return null;
  }
  return path.join(publicDir, normalized);
}

async function serveStatic(req, res, pathname) {
  try {
    const filePath = sanitizePath(pathname);
    if (!filePath || !filePath.startsWith(publicDir)) {
      sendJson(res, 403, { error: 'Forbidden.' });
      return;
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error('Not file');
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': contentType });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found.' });
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      hasApiKey: hasApiKey(),
      status: 'ok',
      trioBaseUrl: TRIO_BASE_URL
    });
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (!hasApiKey()) {
      sendJson(res, 500, {
        error: 'TRIO_API_KEY is not configured. Add it to .env or process env.'
      });
      return;
    }

    try {
      if (req.method === 'POST' && pathname === '/api/streams/validate') {
        const body = await readJsonBody(req);
        if (!body.url) {
          sendJson(res, 400, { error: 'Missing required field: url' });
          return;
        }

        const upstream = await proxyTrio({
          body: { url: body.url },
          method: 'POST',
          pathWithQuery: '/streams/validate'
        });
        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/prepare-stream') {
        const body = await readJsonBody(req);
        if (!body.url) {
          sendJson(res, 400, { error: 'Missing required field: url' });
          return;
        }

        const encoded = encodeURIComponent(body.url);
        const upstream = await proxyTrio({
          method: 'POST',
          pathWithQuery: `/prepare-stream?url=${encoded}`
        });
        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/check-once') {
        const body = await readJsonBody(req);
        if (!body.url || !body.condition) {
          sendJson(res, 400, { error: 'Missing required fields: url, condition' });
          return;
        }

        const payload = {
          condition: body.condition,
          url: body.url
        };

        if (body.model) {
          payload.model = body.model;
        }

        const includeFrame = toBoolean(body.includeFrame);
        if (includeFrame !== undefined) {
          payload.include_frame = includeFrame;
        }

        const skipValidation = toBoolean(body.skipValidation);
        if (skipValidation !== undefined) {
          payload.skip_validation = skipValidation;
        }

        const upstream = await proxyTrio({
          body: payload,
          method: 'POST',
          pathWithQuery: '/api/check-once'
        });

        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/live-monitor') {
        const body = await readJsonBody(req);
        if (!body.url || !body.condition) {
          sendJson(res, 400, { error: 'Missing required fields: url, condition' });
          return;
        }

        const payload = {
          condition: body.condition,
          url: body.url
        };

        if (body.model) {
          payload.model = body.model;
        }

        const includeFrame = toBoolean(body.includeFrame);
        if (includeFrame !== undefined) {
          payload.include_frame = includeFrame;
        }

        const skipValidation = toBoolean(body.skipValidation);
        if (skipValidation !== undefined) {
          payload.skip_validation = skipValidation;
        }

        if (body.pollingInterval !== undefined) {
          payload.polling_interval = Number(body.pollingInterval);
        }

        const upstream = await proxyTrio({
          body: payload,
          method: 'POST',
          pathWithQuery: '/api/live-monitor'
        });

        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/live-digest') {
        const body = await readJsonBody(req);
        if (!body.url || !body.summaryPrompt) {
          sendJson(res, 400, { error: 'Missing required fields: url, summaryPrompt' });
          return;
        }

        const payload = {
          summary_prompt: body.summaryPrompt,
          url: body.url
        };

        if (body.interval !== undefined) {
          payload.interval = Number(body.interval);
        }

        if (body.length !== undefined) {
          payload.length = Number(body.length);
        }

        const upstream = await proxyTrio({
          body: payload,
          method: 'POST',
          pathWithQuery: '/api/live-digest'
        });

        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/jobs') {
        const upstream = await proxyTrio({
          method: 'GET',
          pathWithQuery: '/jobs'
        });

        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (jobMatch && req.method === 'GET') {
        const jobId = encodeURIComponent(jobMatch[1]);
        const upstream = await proxyTrio({
          method: 'GET',
          pathWithQuery: `/jobs/${jobId}`
        });

        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      if (jobMatch && req.method === 'DELETE') {
        const jobId = encodeURIComponent(jobMatch[1]);
        const upstream = await proxyTrio({
          method: 'DELETE',
          pathWithQuery: `/jobs/${jobId}`
        });

        res.writeHead(upstream.status, { 'content-type': upstream.contentType });
        res.end(JSON.stringify(upstream.payload));
        return;
      }

      sendJson(res, 404, { error: 'API route not found.' });
    } catch (error) {
      sendJson(res, 502, {
        detail: error instanceof Error ? error.message : 'Unknown error',
        error: 'Failed to reach Trio API'
      });
    }
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(req, res, pathname);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
});

server.listen(PORT, HOST, () => {
  console.log(`HarborWatch server running at http://${HOST}:${PORT}`);
});

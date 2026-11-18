#!/usr/bin/env node
// Development server: runs LampLauncher in a desktop browser, standing in for the
// Android app. Serves web/, fetches YouTube pages at /proxy (like the app does),
// and relays the cam manager's /api requests to the open TV page.
//
//   node tools/devserver.mjs [--port 8686] [--host 127.0.0.1]
//   TV page:      http://127.0.0.1:8686/        (keys: arrows, Enter, hold Enter = menu,
//                                                Esc = back, h = home, p = power)
//   cam manager:  http://127.0.0.1:8686/admin
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const port = Number(opt("port", 8686));
const host = opt("host", "127.0.0.1");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};
const PROXY_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

const tvPages = new Set(); // SSE connections from open TV pages
const pending = new Map(); // api request id -> resolve
let nextId = 1;

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function serveFile(res, rel) {
  const path = normalize(join(root, rel));
  if (!path.startsWith(root)) return send(res, 403, { error: "forbidden" });
  try {
    send(res, 200, await readFile(path), TYPES[extname(path)] || "application/octet-stream");
  } catch {
    send(res, 404, { error: "not found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  try {
    if (path === "/dev/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": connected\n\n");
      tvPages.add(res);
      req.on("close", () => tvPages.delete(res));
      return;
    }
    if (path === "/dev/reply" && req.method === "POST") {
      const m = JSON.parse(await readBody(req));
      pending.get(m.id)?.(m);
      pending.delete(m.id);
      return send(res, 200, { ok: true });
    }
    if (path.startsWith("/api/")) {
      if (!tvPages.size) return send(res, 503, { error: "LampLauncher isn't running: open the TV page first" });
      const id = nextId++;
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const reply = new Promise((resolve) => {
        pending.set(id, resolve);
        setTimeout(() => resolve({ status: 504, body: { error: "LampLauncher didn't answer" } }), 15000);
      });
      const msg = `data: ${JSON.stringify({ id, method: req.method, path: path + url.search, body })}\n\n`;
      for (const page of tvPages) page.write(msg);
      const r = await reply;
      pending.delete(id);
      return send(res, r.status, r.body);
    }
    if (path === "/proxy") {
      const target = new URL(url.searchParams.get("url") || "");
      if (target.protocol !== "https:" || !PROXY_HOSTS.has(target.hostname)) return send(res, 403, { error: "host not allowed" });
      try {
        const r = await fetch(target, {
          headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            Cookie: "SOCS=CAI; CONSENT=YES+",
          },
        });
        return send(res, r.status, await r.text(), "text/html; charset=utf-8");
      } catch (e) {
        return send(res, 502, { error: String(e.cause?.message || e.message) });
      }
    }
    if (path === "/" || path === "/index.html") return serveFile(res, "index.html");
    if (path === "/admin" || path === "/admin/") return serveFile(res, "admin.html");
    return serveFile(res, path.slice(1));
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(port, host, () => {
  console.log(`LampLauncher dev server: TV page http://${host}:${port}/  cam manager http://${host}:${port}/admin`);
});

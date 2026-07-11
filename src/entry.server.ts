import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const { default: server } = await import("../dist/server/server.js");

const clientDir = join(__dirname, "../dist/client");

const nodeServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Serve static assets from dist/client
  const filePath = join(clientDir, pathname);
  if (existsSync(filePath) && !filePath.endsWith("/")) {
    try {
      const data = await readFile(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
      return;
    } catch {
      // fall through to SSR handler
    }
  }

  // Convert Node req to web-standard Request
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body:
      req.method !== "GET" && req.method !== "HEAD"
        ? (req as unknown as ReadableStream)
        : undefined,
    duplex: "half",
  } as RequestInit);

  // Delegate to TanStack Start handler
  const response = await server.fetch(request);

  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (response.body) {
    const readable = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    readable.pipe(res);
    readable.on("error", () => {
      res.end();
    });
  } else {
    res.end();
  }
});

nodeServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

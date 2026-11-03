// Build bundled preview assets with the same Canvas renderer used by the app.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = join(root, "src-tauri/resources/builtins.json");
const records = JSON.parse(await readFile(sourcePath, "utf8"));
const browserPath = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((path) => path && existsSync(path));
if (!browserPath) {
  throw new Error("Set BROWSER_PATH to a Chromium browser executable.");
}
const temporaryRoot = await realpath(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, "creator-library-previews-"));
let accept;
let reject;
let demoBytes;
const generated = new Promise((resolve, fail) => {
  accept = resolve;
  reject = fail;
});
const server = await createServer({
  root,
  clearScreen: false,
  plugins: [
    {
      name: "creator-library-previews",
      configureServer(server) {
        server.middlewares.use(previewMiddleware);
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
async function previewMiddleware(request, response, next) {
  if (request.url === "/__library-previews" && request.method === "GET") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><meta charset="utf-8"><title>Build resource previews</title>
      <script type="module">
        try {
          const [{ createRenderer }, { resourceDocument, resourcePreview }, { thumbnailDataUrl }, { default: records }] = await Promise.all([
            import('/src/editor/renderer.ts'), import('/src/editor/library-protocol.ts'), import('/src/editor/thumbnail.ts'), import('/src-tauri/resources/builtins.json')
          ]);
          const demoCanvas = document.createElement('canvas');
          demoCanvas.width = 512;
          demoCanvas.height = 512;
          const demoContext = demoCanvas.getContext('2d');
          demoContext.fillStyle = '#FFFFFF';
          demoContext.fillRect(0, 0, 512, 512);
          demoContext.fillStyle = '#26362F';
          demoContext.font = '40px "Microsoft YaHei", sans-serif';
          demoContext.textAlign = 'center';
          demoContext.textBaseline = 'middle';
          demoContext.fillText('演示图片', 256, 256);
          const demo = demoCanvas.toDataURL('image/png');
          const binary = atob(demo.split(',')[1]);
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          const renderer = createRenderer({
            async readAsset(path) {
              if (!path.replaceAll('\\\\', '/').endsWith('/demo.png') && path !== 'demo.png') {
                throw new Error('Unexpected bundled resource: ' + path);
              }
              return { bytes: bytes.slice(), version: 'builtin-demo' };
            },
            async assetVersion() { return 'builtin-demo'; }
          });
          const previews = [];
          for (const record of records) {
            const payload = resourcePreview(record.kind, resourceDocument(record.kind, record.payload), 'C:/creator-library-previews/demo.png');
            const result = await renderer.render(payload, 'C:/creator-library-previews', new AbortController().signal);
            try {
              if (!result.frame) { throw new Error(record.name + ': ' + result.issues.map(i => i.message).join('; ')); }
              previews.push({ id: record.id, thumbnail: thumbnailDataUrl(result.frame) });
            } finally { result.dispose(); }
          }
          await fetch('/__library-previews-save', { method: 'POST', body: JSON.stringify({ previews, demo }) });
        } catch (error) {
          await fetch('/__library-previews-save', { method: 'POST', body: JSON.stringify({ error: String(error) }) });
        }
      </script>`);
    return;
  }
  if (request.url === "/__library-previews-save" && request.method === "POST") {
    try {
      const parts = [];
      let length = 0;
      for await (const part of request) {
        length += part.length;
        if (length > 10_000_000) {
          throw new Error("Preview output is too large.");
        }
        parts.push(part);
      }
      const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (data.error) {
        throw new Error(data.error);
      }
      if (
        !Array.isArray(data.previews) ||
        data.previews.length !== records.length
      ) {
        throw new Error("Bundled preview count does not match resource count.");
      }
      for (const [index, preview] of data.previews.entries()) {
        if (
          preview.id !== records[index].id ||
          !preview.thumbnail?.startsWith("data:image/png;base64,")
        ) {
          throw new Error("Unexpected resource preview output.");
        }
        records[index].thumbnail = preview.thumbnail;
        delete records[index].previewError;
      }
      if (!data.demo?.startsWith("data:image/png;base64,")) {
        throw new Error("Missing bundled demonstration image.");
      }
      demoBytes = Buffer.from(data.demo.split(",")[1], "base64");
      response.end("ok");
      accept();
    } catch (error) {
      response.statusCode = 500;
      response.end("Preview generation failed.");
      reject(error);
    }
    return;
  }
  next();
}

let browser;
let timer;
let browserLog = "";
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-networking",
      `--user-data-dir=${profile}`,
      `http://127.0.0.1:${port}/__library-previews`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  browser.stderr.on("data", (data) => {
    browserLog = (browserLog + data.toString()).slice(-6000);
  });
  browser.once("error", reject);
  browser.once("exit", (code) =>
    reject(new Error(`Preview browser exited (${code}). ${browserLog}`)),
  );
  timer = setTimeout(
    () =>
      reject(new Error(`Preview asset generation timed out. ${browserLog}`)),
    45000,
  );
  await generated;
  await writeFile(join(root, "src-tauri/resources/demo.png"), demoBytes);
  await writeFile(sourcePath, JSON.stringify(records, null, 2) + "\n", "utf8");
  console.log(
    `Generated the demonstration PNG and ${records.length} bundled thumbnails with the application renderer.`,
  );
} finally {
  clearTimeout(timer);
  if (browser && browser.exitCode === null) {
    const ended = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await ended;
  }
  await server.close();
  const resolvedProfile = await realpath(profile);
  if (
    resolve(dirname(resolvedProfile)) !== resolve(temporaryRoot) ||
    !basename(resolvedProfile).startsWith("creator-library-previews-")
  ) {
    throw new Error(
      "Refusing to remove an unexpected browser profile directory.",
    );
  }
  await rm(resolvedProfile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

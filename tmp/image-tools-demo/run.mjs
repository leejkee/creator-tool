// Reproduce PNG outputs using the real TS library in a headless Chromium Canvas.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const { createServer } = await import(pathToFileURL(join(repository, "desktop/node_modules/vite/dist/node/index.js")).href);
const profile = await mkdtemp(join(tmpdir(), "creator-image-demo-"));
const server = await createServer({ configFile: join(root, "vite.config.mjs"), cacheDir: join(profile, "vite-cache") });
let browser;
let socket;
let browserError;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  const original = await readFile(join(root, "original.png"));
  const source = await readFile(join(repository, "tool_test/assets/安琪拉_棋手.png"));
  if (sha256(source) !== sha256(original)) throw new Error("Original does not match repository source");
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing Vite server address");
  browser = spawn(process.env.CHROMIUM_PATH || "chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: "ignore" });
  browser.once("error", error => { browserError = error; });
  let debugPort;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (browserError) throw browserError;
    try { debugPort = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await delay(100); }
  }
  if (!debugPort) throw new Error("Chromium did not open its debugging port");
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Page.enable");
  await call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
  let result;
  for (let attempt = 0; attempt < 150; attempt++) {
    const response = await call("Runtime.evaluate", { expression: "window.imageToolsDemo", returnByValue: true });
    result = response.result?.value;
    if (result) break;
    await delay(100);
  }
  if (result?.status !== "passed") throw new Error(result?.error || "Image processing did not complete");
  const images = [];
  for (const image of result.images) {
    const bytes = Buffer.from(image.pngDataUrl.split(",")[1], "base64");
    await writeFile(join(root, image.fileName), bytes);
    const { pngDataUrl, ...metadata } = image;
    images.push({ ...metadata, sha256: sha256(bytes) });
  }
  if (sha256(await readFile(join(root, "original.png"))) !== sha256(original)) throw new Error("Original file changed");
  const report = {
    source: "tool_test/assets/安琪拉_棋手.png", input: { ...result.input, fileName: "original.png", sha256: sha256(original) },
    checks: result.checks, images,
  };
  await writeFile(join(root, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, images: images.map(({ fileName, width, height }) => ({ fileName, width, height })) }, null, 2));
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    browser.kill("SIGTERM");
    await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode === null) browser.kill("SIGKILL");
  }
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

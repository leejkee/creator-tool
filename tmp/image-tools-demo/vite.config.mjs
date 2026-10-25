import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
export default {
  root,
  cacheDir: resolve(tmpdir(), "creator-image-tools-demo-vite-cache"),
  server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(root, "../..")] } },
};

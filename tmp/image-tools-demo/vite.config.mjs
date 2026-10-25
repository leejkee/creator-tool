import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
export default {
  root,
  server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(root, "../..")] } },
};

import { defineConfig, type Plugin } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");

/**
 * Serves the generator's output/ directory (which lives outside this
 * package, and is gitignored/regenerable) at /world-data/* during dev.
 * The viewer never writes to this directory -- it only ever reads
 * generator output, per the engine-independence contract in docs/01.
 */
function serveGeneratorOutput(): Plugin {
  return {
    name: "serve-generator-output",
    configureServer(server) {
      server.middlewares.use("/world-data", (req, res, next) => {
        // sirv-like static serve via vite's own static middleware isn't
        // trivially reusable here, so hand off to a minimal file server.
        import("node:fs").then((fs) => {
          const reqPath = decodeURIComponent(req.url?.split("?")[0] ?? "");
          const filePath = path.join(OUTPUT_DIR, reqPath);
          if (!filePath.startsWith(OUTPUT_DIR)) {
            res.statusCode = 403;
            res.end("forbidden");
            return;
          }
          fs.readFile(filePath, (err, data) => {
            if (err) {
              res.statusCode = 404;
              res.end("not found");
              return;
            }
            if (filePath.endsWith(".json")) res.setHeader("Content-Type", "application/json");
            else if (filePath.endsWith(".png")) res.setHeader("Content-Type", "image/png");
            else if (filePath.endsWith(".raw")) res.setHeader("Content-Type", "application/octet-stream");
            res.end(data);
          });
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [serveGeneratorOutput()],
  server: { port: 5183 },
});

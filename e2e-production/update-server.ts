import { readFileSync } from "node:fs";
import { preview } from "vite";

export async function startUpdateServer() {
  let updated = false;
  const server = await preview({
    configFile: false,
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
    plugins: [{
      name: "isolated-worker-update",
      configurePreviewServer(previewServer) {
        previewServer.middlewares.use((request, response, next) => {
          if (request.url === "/sw.js") {
            response.setHeader("Content-Type", "application/javascript");
            response.setHeader("Cache-Control", "no-store");
            const workerScript = readFileSync("dist/sw.js", "utf8");
            console.info("Worker update fixture served", { updated });
            response.end(updated ? workerScript.replace("const CACHE_NAME =", 'const CACHE_NAME = "edunoza-review-update-" +') : workerScript);
            return;
          }
          next();
        });
      }
    }]
  });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("The update fixture requires a TCP port.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    update: () => { updated = true; },
    close: async () => {
      await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    }
  };
}

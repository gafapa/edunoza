import { readFileSync } from "node:fs";
import { preview } from "vite";

// Real network failures avoid WebKit's offline-emulation service-worker bug.
await preview({
  preview: { host: "127.0.0.1", port: 5277, strictPort: true },
  plugins: [{
    name: "production-browser-fixtures",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.headers.cookie?.split(";").some(value => value.trim() === "review_offline=1")) {
          request.socket.destroy();
          return;
        }
        if (request.url === "/sw.js" && request.headers.cookie?.split(";").some(value => value.trim() === "review_update=1")) {
          response.setHeader("Content-Type", "application/javascript");
          response.setHeader("Cache-Control", "no-store");
          response.end(`${readFileSync("dist/sw.js", "utf8")}\n// Synthetic browser update.\n`);
          return;
        }
        next();
      });
    }
  }]
});

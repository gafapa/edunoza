import { preview } from "vite";

await preview({
  preview: { host: "127.0.0.1", port: 5277, strictPort: true }
});

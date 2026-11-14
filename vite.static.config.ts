// Builds the pages as plain static files, so the agent in chain/ can serve
// them without any other server:  npm run build:static
// Lovable's own build uses vite.config.ts and is not affected by this file.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: false,
  tanstackStart: {
    server: { entry: "server" },
    spa: { enabled: true },
  },
});

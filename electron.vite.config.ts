import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    build: {
      watch: {}
    }
  },
  preload: {
    build: {
      watch: {},
      rolldownOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs"
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": resolve(root, "shared")
      }
    },
    plugins: [react()]
  }
});

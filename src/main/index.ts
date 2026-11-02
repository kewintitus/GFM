import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { buildPlan, chooseRepo, createCommit, createManifest, createWorkBranch, installHook, listBranches, markPromoted, openProject, preparePromotion, removeHook, removeProject, saveCatalog, saveEnvironmentBranches, setStaged, snapshot } from "./service";
import type { Catalog } from "../../shared/catalog";
import type { CommitRequest, PlanRequest, PrepareRequest, WorkBranchRequest } from "../../shared/api";
import type { BranchNames } from "../../shared/manifest";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#12140f",
    title: "Git Feature Manager",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.on("console-message", (event) => {
    if (event.level === "warning" || event.level === "error") {
      console.error(event.message);
    }
  });

  if (process.env.FEATURE_RELEASE_SMOKE === "1") {
    win.webContents.once("did-finish-load", () => {
      void finishSmoke(win);
    });
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!devUrl) {
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:"
          ]
        }
      });
    });
  }

  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

async function finishSmoke(win: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 5000;
  try {
    let ready = false;
    while (Date.now() < deadline) {
      ready = await win.webContents.executeJavaScript(
        "Boolean(window.featureRelease && document.querySelector('[data-app=\"feature-release\"]'))"
      );
      if (ready) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    console.log(ready ? "feature-release-ready" : "feature-release-smoke-failed");
    app.exit(ready ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.log("feature-release-smoke-failed");
    app.exit(1);
  }
}

function parentFrom(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function handle<T>(channel: string, fn: (event: IpcMainInvokeEvent, input: T) => Promise<unknown>): void {
  ipcMain.handle(channel, async (event, input) => {
    try {
      return await fn(event, input as T);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
    }
  });
}

app.whenReady().then(() => {
  handle("app:snapshot", () => snapshot());
  handle("repo:choose", (event) => chooseRepo(parentFrom(event)));
  handle<string>("repo:open", (_event, repoPath) => openProject(repoPath));
  handle<string>("repo:remove", (_event, repoPath) => removeProject(repoPath));
  handle("manifest:create", () => createManifest());
  handle("hook:install", (event) => installHook(parentFrom(event)));
  handle("hook:remove", (event) => removeHook(parentFrom(event)));
  handle<string[]>("stage:paths", (_event, paths) => setStaged(paths, true));
  handle<string[]>("unstage:paths", (_event, paths) => setStaged(paths, false));
  handle<CommitRequest>("commit:create", (_event, input) => createCommit(input));
  handle<Catalog>("catalog:save", (_event, catalog) => saveCatalog(catalog));
  handle<BranchNames>("manifest:branches", (_event, names) => saveEnvironmentBranches(names));
  handle<PlanRequest>("promote:plan", (_event, input) => buildPlan(input));
  handle<PlanRequest>("promote:mark", (_event, input) => markPromoted(input));
  handle<PrepareRequest>("promote:prepare", (_event, input) => preparePromotion(input));
  handle("repo:branches", () => listBranches());
  handle<WorkBranchRequest>("branch:create", (_event, input) => createWorkBranch(input));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

import "@fontsource-variable/instrument-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./shell";
import { applyTheme, readTheme } from "./theme";
import { WorkspaceProvider } from "./workspace";
import "./styles.css";

applyTheme(readTheme());

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing application root.");
}

createRoot(root).render(
  <StrictMode>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </StrictMode>
);

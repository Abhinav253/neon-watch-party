import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { loadSavedTheme } from "./theme";
import App from "./App";

loadSavedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

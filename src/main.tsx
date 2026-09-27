import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { chooseRenderer } from "./gpu";
import "./styles.css";

await chooseRenderer();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

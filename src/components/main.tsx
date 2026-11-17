import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/app.css";
import { App, createServices } from "./App";

const container = document.getElementById("root");
if (container === null) throw new Error("The page has no #root element");

// The error boundary writes the error name and stack itself; React's default report would add the message, which can hold a path.
createRoot(container, { onCaughtError: () => undefined }).render(
  <StrictMode>
    <App services={createServices()} />
  </StrictMode>,
);
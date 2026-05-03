import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ChatOverlay from "./chatOverlay/ChatOverlay";
import "./index.css";

declare global {
  interface Window {
    __hideBootSplash?: () => void;
  }
}

// La fenêtre overlay chat (PVP) charge le même bundle mais ne monte que
// ChatOverlay. On branche sur le hash pour éviter un second build entry.
const isChatOverlay = typeof window !== "undefined" && window.location.hash === "#chat-overlay";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(isChatOverlay ? <ChatOverlay /> : <App />);
queueMicrotask(() => window.__hideBootSplash?.());

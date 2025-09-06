import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

declare global {
  interface Window {
    __hideBootSplash?: () => void;
  }
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

// On rend très vite un petit "pre-app" qui cache déjà le splash HTML,
// puis App prendra le relais et affichera son propre Splash si besoin.
root.render(<App />);

// Dès que React est monté (prochain tick), on retire le splash HTML.
queueMicrotask(() => window.__hideBootSplash?.());

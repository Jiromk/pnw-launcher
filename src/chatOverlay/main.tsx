/**
 * Entry point pour la fenêtre overlay chat.
 *
 * Le main.tsx du launcher détecte `location.hash === "#chat-overlay"` et
 * rend ce composant à la place de l'app normale. Une seule HTML est utilisée
 * (single bundle) — l'overlay charge le même JS mais ne monte que ChatOverlay.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import ChatOverlay from "./ChatOverlay";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<ChatOverlay />);

import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FaMinus, FaRegSquare, FaXmark } from "react-icons/fa6";
import { VscChromeRestore } from "react-icons/vsc";

interface TitlebarProps {
  version: string | null;
}

export default function Titlebar({ version }: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);

  const win = getCurrentWindow();

  async function toggleMaximize() {
    await win.toggleMaximize();
    setMaximized(await win.isMaximized());
  }

  // Sync maximized state on mount & resize
  useState(() => {
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(async () => {
      setMaximized(await win.isMaximized());
    });
    return () => { unlisten.then((f) => f()); };
  });

  return (
    <div
      data-tauri-drag-region
      className="titlebar"
    >
      {/* Left — logo + title */}
      <div className="titlebar-left" data-tauri-drag-region>
        <img
          src="/logo.png"
          alt=""
          className="titlebar-logo"
          draggable={false}
        />
        <span className="titlebar-title" data-tauri-drag-region>
          Pokémon New World
        </span>
        <span className="titlebar-sep" data-tauri-drag-region>—</span>
        <span className="titlebar-subtitle" data-tauri-drag-region>Launcher</span>
        {version && (
          <span className="titlebar-version" data-tauri-drag-region>
            v{version}
          </span>
        )}
      </div>

      {/* Right — window controls */}
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-minimize"
          onClick={() => win.minimize()}
          aria-label="Réduire"
        >
          <FaMinus className="text-[11px]" />
        </button>
        <button
          className="titlebar-btn titlebar-btn-maximize"
          onClick={toggleMaximize}
          aria-label={maximized ? "Restaurer" : "Agrandir"}
        >
          {maximized ? (
            <VscChromeRestore className="text-[13px]" />
          ) : (
            <FaRegSquare className="text-[10px]" />
          )}
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={() => win.close()}
          aria-label="Fermer"
        >
          <FaXmark className="text-[13px]" />
        </button>
      </div>
    </div>
  );
}

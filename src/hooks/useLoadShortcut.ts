import { useEffect, type RefObject } from "react";

/**
 * Bind the Briss "L" menu accelerator: pressing `L` (with no modifiers) opens
 * the OS file picker attached to the given input ref. Mirrors BrissSwingGUI's
 * `loadButton` (`KeyStroke.getKeyStroke(KeyEvent.VK_L, 0)`). Ignored while
 * typing in a form field so it never hijacks text entry.
 */
export function useLoadShortcut(inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      inputRef.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputRef]);
}

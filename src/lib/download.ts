export interface SaveFileOptions {
  suggestedName: string;
  mimeType: string;
  extension: string;
  description: string;
}

/** How long a blob URL opened in a new tab is kept alive before revoking. */
const OPEN_TAB_REVOCATION_DELAY = 10_000;

/**
 * Save a byte buffer to disk. Prefers the File System Access API save picker
 * when available, and falls back to an `<a download>` click otherwise (the
 * path used by Firefox/Safari and by automated tests).
 *
 * A user-initiated picker cancellation (AbortError / NotAllowedError) resolves
 * silently rather than throwing.
 */
export async function saveFile(data: Uint8Array, opts: SaveFileOptions): Promise<void> {
  // Copy into a fresh ArrayBuffer so DOM type-checkers are happy with Blob /
  // BufferSource (Uint8Array<ArrayBufferLike> may also wrap SharedArrayBuffer).
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  // Try the File System Access API save picker first, fall back to a download.
  const w = window as unknown as {
    showSaveFilePicker?: (o: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: BufferSource) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: opts.suggestedName,
        types: [
          {
            description: opts.description,
            accept: { [opts.mimeType]: [opts.extension] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(buffer);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError")) {
        return; // user cancelled
      }
      // fall through to download
    }
  }
  const blob = new Blob([buffer], { type: opts.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Open a blank new browser tab and return its window handle, or null if the
 * browser blocked it. Must be called synchronously within a user gesture (the
 * "Crop PDF" click) so the popup isn't treated as non-user-initiated and
 * blocked — hence this is split from `showBytesInTab`, which runs after the
 * (async) cropping finishes and navigates the tab to the result.
 */
export function openBlankTab(): Window | null {
  return window.open("about:blank", "_blank");
}

/**
 * Point an already-open tab at a blob URL built from `data`, and schedule the
 * URL to be revoked so the blob is freed once the new tab has loaded it. Used
 * to display the cropped PDF in the tab opened by `openBlankTab`.
 */
export function showBytesInTab(tab: Window, data: Uint8Array, mimeType: string): void {
  // Copy into a fresh ArrayBuffer so DOM type-checkers are happy with Blob /
  // BufferSource (Uint8Array<ArrayBufferLike> may also wrap SharedArrayBuffer).
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  tab.location.href = url;
  // The browser reads the blob data as the new tab loads. Revoke the URL after
  // a short grace period so the object is freed once it's no longer needed.
  setTimeout(() => URL.revokeObjectURL(url), OPEN_TAB_REVOCATION_DELAY);
}

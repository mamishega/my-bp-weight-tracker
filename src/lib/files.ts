// Saving files locally. Nothing is uploaded anywhere.

export type SaveOutcome =
  | { status: 'saved'; method: 'file-picker' }
  | { status: 'downloaded-unconfirmed'; method: 'download' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

interface PickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<{
    createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

/**
 * Save a file. Where the File System Access API is available we know for sure
 * whether it was written (cancel/failure is detected). Otherwise we start a
 * browser download, which cannot report success — the caller must ask the user
 * to confirm before counting it as a backup.
 */
export async function saveFile(name: string, content: string, mime: string): Promise<SaveOutcome> {
  const blob = new Blob([content], { type: mime });
  const w = window as unknown as PickerWindow;
  if (typeof w.showSaveFilePicker === 'function' && window.isSecureContext && window.self === window.top) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: ext === '.json' ? 'JSON backup' : ext === '.ics' ? 'Calendar file' : 'CSV file', accept: { [mime]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { status: 'saved', method: 'file-picker' };
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === 'AbortError') return { status: 'cancelled' };
      return { status: 'failed', error: err?.message ?? String(e) };
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { status: 'downloaded-unconfirmed', method: 'download' };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

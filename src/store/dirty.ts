// Tracks whether any form has unsaved changes so app updates and navigation
// never silently discard what the user is typing.
import { useEffect } from 'react';

const dirty = new Set<string>();
const listeners = new Set<() => void>();

export function hasUnsavedForm(): boolean {
  return dirty.size > 0;
}

export function onDirtyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useDirtyForm(id: string, isDirty: boolean) {
  useEffect(() => {
    if (isDirty) dirty.add(id);
    else dirty.delete(id);
    listeners.forEach((l) => l());
    return () => {
      dirty.delete(id);
      listeners.forEach((l) => l());
    };
  }, [id, isDirty]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (dirty.size > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

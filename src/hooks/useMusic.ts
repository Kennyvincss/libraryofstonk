import { useCallback, useEffect, useState } from 'react';
import { soundtrack } from '../lib/soundtrack';

const KEY = 'sfa.music';
const listeners = new Set<(on: boolean) => void>();

function read() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
soundtrack.setEnabled(read());

/** Soundtrack on/off, remembered per browser and shared by every player. On by default. */
export function useMusic() {
  const [on, setOn] = useState(read);
  useEffect(() => {
    listeners.add(setOn);
    return () => void listeners.delete(setOn);
  }, []);
  const toggle = useCallback(() => {
    const next = !read();
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    soundtrack.setEnabled(next);
    for (const l of listeners) l(next);
  }, []);
  return { on: on && soundtrack.supported, supported: soundtrack.supported, toggle };
}

/** Play the soundtrack while `active` (reference-counted across players). */
export function useSoundtrack(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return soundtrack.acquire();
  }, [active]);
}

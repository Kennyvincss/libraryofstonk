import { useCallback, useEffect, useState } from 'react';
import { narrator } from '../lib/narrator';

const KEY = 'sfa.voice';

/** Voiceover on/off, remembered per browser. On by default. */
export function useVoice() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [speaking, setSpeaking] = useState(narrator.speaking);
  useEffect(() => narrator.subscribe(setSpeaking), []);
  useEffect(() => () => narrator.stop(), []);
  const toggle = useCallback(() => {
    setOn((v) => {
      const next = !v;
      if (!next) narrator.stop();
      try {
        localStorage.setItem(KEY, next ? 'on' : 'off');
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);
  return { on: on && narrator.supported, supported: narrator.supported, toggle, speaking };
}

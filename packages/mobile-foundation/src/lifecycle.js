import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** Calls onForeground when the app returns to the foreground, onBackground when it leaves. */
export function useAppLifecycle({ onForeground, onBackground }) {
  const last = useRef(AppState.currentState);
  const handlers = useRef({ onForeground, onBackground });
  handlers.current = { onForeground, onBackground };
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (last.current.match(/inactive|background/) && next === 'active') handlers.current.onForeground?.();
      if (last.current === 'active' && next.match(/inactive|background/)) handlers.current.onBackground?.();
      last.current = next;
    });
    return () => sub.remove();
  }, []);
}

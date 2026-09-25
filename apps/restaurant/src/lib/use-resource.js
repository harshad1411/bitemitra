// Minimal data loading for the partner screens: loading / error / data, reload, and optimistic replace.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useResource(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const alive = useRef(true);
  const run = useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    try {
      const data = await load();
      if (alive.current) setState({ status: 'ready', data, error: null });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, status: 'error', error }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
    };
  }, [run]);
  return { ...state, reload: run, setData: (data) => setState({ status: 'ready', data, error: null }) };
}

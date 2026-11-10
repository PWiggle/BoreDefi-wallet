import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';

import {
  fetchGasHistory,
  fetchGasSnapshot,
  GAS_HISTORY_REFRESH_MS,
  GAS_REFRESH_MS,
  type GasHistory,
  type GasSnapshot,
} from '../wallet/gas';

/** Live gas while the screen is focused: snapshot every ~12 s, 24h history every 5 min. Stops when unfocused. */
export function useGas(options: { history?: boolean; poll?: boolean } = {}) {
  const poll = options.poll ?? true;
  const [snapshot, setSnapshot] = useState<GasSnapshot | null>(null);
  const [history, setHistory] = useState<GasHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const historyAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchGasSnapshot();
      setSnapshot(next);
      setError(null);
    } catch {
      setError('Gas data is busy. Retrying…');
    }
    if (options.history && Date.now() - historyAt.current > GAS_HISTORY_REFRESH_MS) {
      try {
        setHistory(await fetchGasHistory());
        historyAt.current = Date.now();
      } catch {
        // Keep the last chart.
      }
    }
  }, [options.history]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void refresh();
      if (!poll) {
        return () => {
          alive = false;
        };
      }
      const timer = setInterval(() => {
        if (alive) {
          void refresh();
        }
      }, GAS_REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [poll, refresh]),
  );

  return { snapshot, history, error, refresh };
}

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_LOAD_TIMEOUT_MS = 15000;

export function useLoad(loader, deps = [], timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const firstFocus = useRef(true);

  useEffect(() => {
    let alive = true;
    let timeoutId;
    setLoading(true);
    setError('');

    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('This page is taking too long to load. Check your internet connection and tap Retry.'));
      }, timeoutMs);
    });

    Promise.race([Promise.resolve().then(loader), timeout])
      .then(value => {
        if (alive) setData(value);
      })
      .catch(err => {
        console.error('[EqualLearn Mobile] Page load failed:', err?.code || err?.message || err);
        if (alive) setError(err?.message || 'Unable to load EqualLearn data.');
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [tick, timeoutMs, ...deps]);

  // Expo Router keeps tabs mounted. Reload when a user returns to a tab, but
  // never let an old request update a screen after it has been left.
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return undefined;
    }
    setTick(value => value + 1);
    return undefined;
  }, []));

  const refresh = useCallback(() => setTick(value => value + 1), []);
  return { data, loading, error, refresh };
}

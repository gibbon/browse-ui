"use client";
import { useState, useEffect } from "react";

const STORAGE_KEY_PREFIX = "browse-ui-pref:";

export function useUserPref<T>(
  key: string,
  defaultValue: T,
): readonly [T, (v: T) => void] {
  const storageKey = `${STORAGE_KEY_PREFIX}${key}`;
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) setValue(JSON.parse(stored) as T);
    } catch {
      // ignore parse errors
    }
  }, [storageKey]);

  function set(v: T) {
    setValue(v);
    try {
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch {
      // ignore storage errors
    }
  }

  return [value, set] as const;
}

/** Stub — standalone package has no server prefs load. */
export function userPrefsLoaded(): boolean {
  return true;
}

import { useEffect, useState } from 'react';

export const favoritesStorageKey = 'marketpulse:market-favorites';
type FavoritesStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readFavorites(storage: FavoritesStorage): string[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(favoritesStorageKey) ?? '[]',
    );
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (key): key is string => typeof key === 'string' && key.length > 0,
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

export function writeFavorites(storage: FavoritesStorage, favorites: string[]) {
  try {
    storage.setItem(favoritesStorageKey, JSON.stringify(favorites));
  } catch {
    // Keep favorites usable for this session when browser storage is unavailable.
  }
}

export function toggleFavorite(favorites: string[], key: string): string[] {
  return favorites.includes(key)
    ? favorites.filter((favorite) => favorite !== key)
    : [...favorites, key];
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return readFavorites(window.localStorage);
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      writeFavorites(window.localStorage, favorites);
    } catch {
      // Access to localStorage itself may be blocked by browser policy.
    }
  }, [favorites]);
  return {
    favorites,
    toggle: (key: string) =>
      setFavorites((previous) => toggleFavorite(previous, key)),
  };
}

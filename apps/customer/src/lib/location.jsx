// Where the customer wants delivery (D-55): the device's current location, or a saved address. A map pin
// picker needs the maps provider decision (Q-14).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { load, save } from './storage';

const KEY = 'jamzo.location.v1';
const LocationContext = createContext(null);

/** Development builds only: a fixed point in Unjha so the app can be tried on a simulator without GPS. */
export const DEMO_POINT = { lat: 23.805, lng: 72.39, label: 'Unjha (demo location)' };

export function LocationProvider({ children }) {
  const [place, setPlace] = useState(null); // { lat, lng, label, addressId? }
  const [ready, setReady] = useState(false);
  useEffect(() => {
    load(KEY, null).then((p) => {
      setPlace(p);
      setReady(true);
    });
  }, []);
  const choose = useCallback((p) => {
    setPlace(p);
    save(KEY, p);
  }, []);
  /** Asks for foreground permission and reads the current position. Returns { ok, reason }. */
  const detectLocation = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted')
      return {
        ok: false,
        reason: 'Location permission was not given. You can choose a saved address instead.',
      };
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const p = {
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        label: 'Current location',
      };
      choose(p);
      return { ok: true, place: p };
    } catch {
      return { ok: false, reason: 'Could not read your location. Check that location services are on.' };
    }
  }, [choose]);
  const value = useMemo(
    () => ({ place, ready, choose, detectLocation }),
    [place, ready, choose, detectLocation],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export const useLocation = () => useContext(LocationContext);

/** Query-string / body fields for the current place. */
export const locationParams = (place) =>
  place?.addressId ? { addressId: place.addressId } : place ? { lat: place.lat, lng: place.lng } : {};

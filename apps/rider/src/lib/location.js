// Location while online (D-74, MOBILE.md §5). A background task receives positions from the OS — also with
// the app in the background, where Android shows the "You are online" notification — and sends them in
// batches. Points that cannot be sent (no network) are queued on the device and sent later, oldest first.
// Location is never collected while the rider is offline.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCATION_TASK = 'jamzo-rider-location';
const QUEUE_KEY = 'jamzo.rider.locationQueue.v1';
const MAX_QUEUE = 500;

/** Set by the app while signed in: sends points to the API. */
let sender = null;
export function setLocationSender(fn) {
  sender = fn;
}

async function readQueue() {
  try {
    return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]');
  } catch {
    return [];
  }
}
async function writeQueue(points) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(points.slice(-MAX_QUEUE)));
}

/** Adds points and tries to send everything queued, 50 at a time. */
export async function enqueueAndFlush(points) {
  const queue = [...(await readQueue()), ...points];
  if (!sender) return writeQueue(queue);
  let rest = queue;
  while (rest.length) {
    const batch = rest.slice(0, 50);
    try {
      await sender(batch);
    } catch {
      break; // keep the rest for the next attempt
    }
    rest = rest.slice(50);
  }
  await writeQueue(rest);
}

export const toPoint = (loc) => ({
  lat: Number(loc.coords.latitude.toFixed(6)),
  lng: Number(loc.coords.longitude.toFixed(6)),
  accuracyM: loc.coords.accuracy != null ? Math.round(loc.coords.accuracy) : undefined,
  speedMps:
    loc.coords.speed != null && loc.coords.speed >= 0 ? Number(loc.coords.speed.toFixed(2)) : undefined,
  headingDeg:
    loc.coords.heading != null && loc.coords.heading >= 0 ? Math.round(loc.coords.heading) % 360 : undefined,
  recordedAt: new Date(loc.timestamp).toISOString(),
});

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await enqueueAndFlush(data.locations.map(toPoint));
});

/**
 * Asks for permission (foreground, then background after the in-app disclosure) and starts updates.
 * @returns {Promise<{ ok: boolean, reason?: string, background: boolean }>}
 */
export async function startTracking({ intervalSec }) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted')
    return { ok: false, background: false, reason: 'Location permission is needed to go online.' };
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' }));
  const background = bg.status === 'granted';
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) await stopTracking();
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: intervalSec * 1000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'You are online on Jamzo',
      notificationBody: 'Your location is shared while you are online for deliveries.',
    },
  });
  // Send one position immediately so dispatch knows where the rider is.
  const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
  if (now) await enqueueAndFlush([toPoint(now)]);
  return { ok: true, background };
}

export async function stopTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false))
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

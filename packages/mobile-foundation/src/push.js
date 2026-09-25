// Push registration (OD-26). Honest outcome: tells the caller exactly why a token could not be obtained.
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * @param {{ api: any, easProjectId: string | null,
 *           androidChannel?: { id: string, name: string, importance?: 'DEFAULT' | 'HIGH' | 'MAX', sound?: string } }} opts
 * `sound` is a bundled file name (see the app's notificationSounds); Android fixes a channel's sound when it is
 * first created.
 * @returns {Promise<{ status: 'registered' | 'denied' | 'unavailable' | 'error', reason?: string }>}
 */
export async function registerForPush({
  api,
  easProjectId,
  androidChannel = { id: 'default', name: 'General' },
}) {
  if (!Device.isDevice) return { status: 'unavailable', reason: 'Push tokens need a physical device.' };
  if (!easProjectId)
    return {
      status: 'unavailable',
      reason: 'EAS project id not configured (owner creates the Expo project).',
    };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(androidChannel.id, {
      name: androidChannel.name,
      importance: Notifications.AndroidImportance[androidChannel.importance ?? 'DEFAULT'],
      ...(androidChannel.sound ? { sound: androidChannel.sound, vibrationPattern: [0, 600, 300, 600] } : {}),
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { status: 'denied', reason: 'Notification permission was not granted.' };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })).data;
    await api.post(
      '/v1/me/devices',
      { platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID', pushToken: token, pushProvider: 'expo' },
      { idempotencyKey: false },
    );
    return { status: 'registered' };
  } catch (err) {
    return { status: 'error', reason: String(err?.message ?? err) };
  }
}

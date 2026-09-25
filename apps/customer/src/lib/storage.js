// Device storage for non-secret state (cart, chosen location). Never tokens — those use secure storage.
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function load(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function save(key, value) {
  try {
    if (value == null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage failures are not fatal: the cart simply is not remembered across restarts.
  }
}

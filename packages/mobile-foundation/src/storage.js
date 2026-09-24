// Refresh token in the OS keystore (iOS Keychain / Android Keystore via expo-secure-store); the access
// token only in memory (SECURITY.md §1).
import * as SecureStore from 'expo-secure-store';

export function createTokenStore(appId) {
  const key = `jamzo.${appId.toLowerCase()}.refreshToken`;
  let accessToken = null;
  return {
    getAccessToken: () => accessToken,
    getRefreshToken: () => SecureStore.getItemAsync(key),
    async setTokens({ accessToken: a, refreshToken }) {
      accessToken = a;
      if (refreshToken)
        await SecureStore.setItemAsync(key, refreshToken, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });
    },
    async clear() {
      accessToken = null;
      await SecureStore.deleteItemAsync(key);
    },
  };
}

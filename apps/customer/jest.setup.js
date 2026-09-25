// Official mock for the NetInfo native module (not available in the Jest environment).
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Official AsyncStorage mock (cart and chosen location persistence).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-location has no native module under Jest; tests control permission and position.
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 23.805, longitude: 72.39 } })),
}));

// socket.io-client: tests push realtime notices through global.__realtime.emit(event, payload).
jest.mock('socket.io-client', () => {
  const listeners = new Map();
  const socket = {
    on: (event, fn) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return socket;
    },
    emit: jest.fn(),
    connect: jest.fn(),
    close: () => listeners.clear(),
  };
  global.__realtime = { emit: (event, payload) => (listeners.get(event) ?? []).forEach((fn) => fn(payload)) };
  return { io: jest.fn(() => socket) };
});

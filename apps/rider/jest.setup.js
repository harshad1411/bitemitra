// Official mock for the NetInfo native module (not available in the Jest environment).
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Location and background tasks have no native module under Jest; tests observe calls through these mocks.
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 23.8005, longitude: 72.3905, accuracy: 8, speed: 0, heading: 0 },
    timestamp: Date.now(),
  })),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///doc.jpg', mimeType: 'image/jpeg' }],
  })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
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

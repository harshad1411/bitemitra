// Official mock for the NetInfo native module (not available in the Jest environment).
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// expo-audio has no native module under Jest; the new-order chime is observed through global.__player.
jest.mock('expo-audio', () => {
  const player = { loop: false, play: jest.fn(), pause: jest.fn(), seekTo: jest.fn() };
  global.__player = player;
  return { useAudioPlayer: () => player, setAudioModeAsync: jest.fn(async () => {}) };
});

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

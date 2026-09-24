// Official mock for the NetInfo native module (not available in the Jest environment).
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

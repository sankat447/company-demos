/* eslint-env jest */
// Native modules absent under Jest get their official mocks here.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

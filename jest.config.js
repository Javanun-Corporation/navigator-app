module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/__tests__/**/*.test.js'],
    transform: { '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { babelrc: false, configFile: false, presets: ['module:@react-native/babel-preset'] }] },
};

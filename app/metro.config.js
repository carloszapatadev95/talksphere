const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [
  ...new Set([
    ...config.resolver.sourceExts,
    'web.tsx',
    'web.ts',
    'web.jsx',
    'web.js',
  ]),
];

module.exports = config;

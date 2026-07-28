// Metro configuration for this pnpm monorepo.
//
// The native release build re-bundles the JS with the workspace-root `@expo/cli`,
// which resolves packages relative to this app. Watching the workspace root and
// listing both node_modules trees lets Metro find the workspace packages
// (@techpioasset/*) and hoisted dependencies during that step, not just during
// local `expo start`.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;

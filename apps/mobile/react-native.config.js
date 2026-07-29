// React Native autolinking override for this pnpm monorepo.
//
// expo ships its own `react-native.config.js` that reports the correct Android
// package for autolinking (`import expo.modules.ExpoModulesPackage;`). But that
// file does `require('expo-modules-autolinking/exports')`, and under pnpm's
// isolated node_modules that require is not resolvable from expo's own package
// directory, so `expo-modules-autolinking`'s `react-native-config` command
// fails to load it and silently falls back to computing the import from expo's
// Android namespace. In this layout that fallback resolves to the LEGACY
// `import expo.core.ExpoModulesPackage;` (an SDK-40-era class that no longer
// exists), which makes the native Android build fail at
// `:app:compileReleaseJavaWithJavac` with:
//   PackageList.java: error: cannot find symbol
//   import expo.core.ExpoModulesPackage;
//
// A project-level dependency override is merged on top of (and wins over) each
// library's own config, so we pin the correct modern Expo package here.
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
          packageInstance: 'new ExpoModulesPackage()',
        },
        // expo on iOS is linked via `use_expo_modules!` in the Podfile, so skip
        // React Native community autolinking for it there.
        ios: null,
      },
    },
  },
};

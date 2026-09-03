import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * APP_CHANNEL is injected per EAS build profile (see eas.json):
 *   preview    -> "direct"  (QR-sideload APK from get.bir.example)
 *   production -> "store"   (Play AAB / App Store IPA)
 * The app reads it at runtime for telemetry + the direct-channel notice.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Bir',
  slug: 'bir-app',
  version: '0.4.3',
  scheme: 'bir',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#17232B',
  },
  ios: {
    bundleIdentifier: 'org.birfestival.app',
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription:
        'Scanning festival passes and translating menus/signs requires the camera. / त्योहार पास स्कैन करने और मेनू/साइन अनुवाद के लिए कैमरा आवश्यक है।',
      NSLocationWhenInUseUsageDescription:
        'Your location is used only for SOS reporting (with consent) and shuttle ETAs. / आपका स्थान केवल SOS रिपोर्ट (सहमति से) और शटल ETA के लिए उपयोग होता है।',
      UIBackgroundModes: ['remote-notification'],
    },
  },
  android: {
    package: 'org.birfestival.app',
    versionCode: 5,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#17232B',
    },
    permissions: ['android.permission.CAMERA'],
    config: {
      // Injected via EAS secret at build time; venue-map pins fall back to
      // Apple Maps on iOS (no key needed).
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '' },
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    'expo-localization',
    [
      'expo-camera',
      {
        cameraPermission: 'Scan festival passes at the gate. / गेट पर महोत्सव पास स्कैन करें।',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Attach a photo to an incident report. / घटना रिपोर्ट में फ़ोटो जोड़ें।',
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission:
          'Add your festival registrations to your calendar. / अपने महोत्सव पंजीकरण कैलेंडर में जोड़ें।',
      },
    ],
    [
      'expo-font',
      {
        fonts: ['node_modules/@expo-google-fonts/fraunces/Fraunces_600SemiBold.ttf'],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  runtimeVersion: { policy: 'appVersion' },
  updates: {
    url: process.env.EAS_PROJECT_ID
      ? `https://u.expo.dev/${process.env.EAS_PROJECT_ID}`
      : undefined,
  },
  extra: {
    APP_CHANNEL: process.env.APP_CHANNEL ?? 'development',
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});

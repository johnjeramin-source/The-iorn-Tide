# Iron Tide – Android (APK / Play Store AAB)

Requirements: Node 20+, Android Studio (includes JDK + SDK).

1. `npm install`
2. `npm run cap:add`          (first time only – creates /android)
3. Test APK:  `npm run apk:debug`
   -> android/app/build/outputs/apk/debug/app-debug.apk
4. Play Store: create a keystore once:
   `keytool -genkey -v -keystore iron-tide.jks -keyalg RSA -keysize 2048 -validity 10000 -alias irontide`
   In Android Studio: Build > Generate Signed Bundle / APK > Android App Bundle (AAB).
   (or `npm run aab:release` after adding signingConfigs in android/app/build.gradle)
5. Landscape lock: in android/app/src/main/AndroidManifest.xml add
   `android:screenOrientation="sensorLandscape"` to <activity>.
6. Replace launcher icons: Android Studio > right-click res > New > Image Asset (use public/pwa-512x512.png).
7. Play Console needs: AAB, privacy policy URL, content rating, target API level (currently 35).

Offline note: Google Fonts in index.html load online; the game still runs without them.

## Build the APK without Android Studio
Push this folder to a GitHub repo, open Actions > "Build Iron Tide APK" > Run workflow,
then download `Iron-Tide-APK` (contains app-debug.apk). The workflow locks landscape,
goes fullscreen and generates the launcher icon automatically.

## Player profile
Title screen > top-right chip: callsign, emblem, color, rank and lifetime stats (saved on the phone).

## New controls (Stage 1)
- Q: wall; press Q again while placing to cycle Wood / Stone / Concrete / Steel
- X: cycle Barbed Wire / Laser Fence / Electric Fence (R rotates)
- I / O / Y / J: Little Bird, Hind, Chinook, Recon Drone

## Civilians & bunker
Move any ground unit (or Blackhawk/Chinook) next to a waiting civilian (yellow "!") – they follow you to the bunker.
Each saved civilian gives +20 REQ. The bunker holds a limited number (HUD "BUNKER x/y"); zombies kill civilians left outside.

## CI safeguards (GitHub Actions)

Every push to `main` (or a manual run) now:

1. Installs with `--legacy-peer-deps` (avoids optional peer-range ERESOLVE failures; also set in `.npmrc`).
2. Runs `npm run lint` and `npm test` as **non-blocking** checks (failures show as warnings, the APK still builds).
3. Builds the web app first and checks `dist/index.html` exists.
4. Generates PNG-only launcher icons and verifies the icon folders before Gradle runs.
5. Verifies the finished APK (size, manifest, game files) before uploading `Iron-Tide-APK`.
6. On failure, uploads `build-failure-reports` (Gradle reports + manifest) so the real error can be read.

A newer push cancels an older running build.

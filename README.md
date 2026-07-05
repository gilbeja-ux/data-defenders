# Data Defenders

A mobile game for iOS and Android featuring dual-node controls in a fiber-optic tunnel defense gameplay.

## About

Pilot a payload through a data tunnel by commanding two radial nodes to intercept incoming data traps. Features:
- Dual-thumb radial dial controls
- 3 progressive levels with increasing difficulty
- Custom soundtrack with dynamic audio
- Offline-capable gameplay
- Cross-platform (iOS & Android)

## Development

### Prerequisites
- Node.js 16+
- npm
- Xcode (for iOS builds)
- Android Studio (for Android builds)

### Quick Start

```bash
npm install
npm run build       # Build the web game
npm run sync        # Sync with native platforms
npm run ios         # Open iOS project in Xcode
npm run android     # Open Android project in Android Studio
```

### Project Structure

```
data-defenders/
├── src/                    # Web game source
│   └── index.html         # Main game file
├── assets/
│   └── audio/             # Game soundtrack (MP3s)
├── scripts/
│   └── build.js           # Build script
├── knowledge/             # Project documentation
└── capacitor.config.json  # Capacitor configuration
```

## Game Mechanics

- **Menu**: View From The Dashboard (background music)
- **Levels 1-3**: Randomized soundtrack from available tracks
- **Controls**:
  - Mobile: Touch the bottom corner dials to steer nodes
  - Keyboard: A/D for left node, arrows for right node

## Building for App Stores

### iOS (App Store)
```bash
npm run sync
npm run ios
# In Xcode: Product > Archive, then distribute via App Store Connect
```

### Android (Google Play)
```bash
npm run sync
npm run android
# In Android Studio: Build > Generate Signed Bundle/APK
```

## License

MIT

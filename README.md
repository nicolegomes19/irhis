# TwinRehabPRO Mobile Application

## Overview

TwinRehabPRO is a mobile health application designed for rehabilitation monitoring and movement analysis. The application enables healthcare professionals to monitor patient recovery progress through sensor-based movement analysis and provides patients with tools to track their rehabilitation exercises and health metrics.

The application supports real-time data collection from Movella DOT sensors via Bluetooth Low Energy (BLE), local analysis of movement data, and comprehensive patient management features for both doctors and patients.

## Technology Stack

### Frontend
- **Framework**: React Native 0.81.5 with Expo SDK 54
- **Language**: TypeScript 5.1.3
- **Navigation**: React Navigation 6 (Stack and Bottom Tabs)
- **State Management**: React Context API
- **Database**: Expo SQLite for local data persistence
- **Bluetooth**: react-native-ble-plx 3.5.0 for Movella DOT sensor communication
- **UI Components**: React Native Safe Area Context, Expo Vector Icons
- **Data Visualization**: react-native-chart-kit, Three.js for 3D visualization
- **Build System**: EAS Build (Expo Application Services)

### Backend
- **Framework**: Flask 3.0.0
- **Language**: Python 3
- **Authentication**: JWT (PyJWT 2.8.0)
- **CORS**: Flask-CORS 4.0.0
- **Deployment**: Gunicorn 22.0.0 (configured for Heroku/Azure)

### Development Tools
- **Package Manager**: npm
- **Code Quality**: TypeScript strict mode
- **Testing**: Jest (configured for analysis modules)
- **Version Control**: Git

## Architecture

### Application Structure

The application follows a modular architecture with clear separation of concerns:

```
frontend/
├── app/
│   ├── analysis/          # Movement analysis algorithms
│   ├── components/        # Reusable UI components
│   ├── context/           # React Context providers
│   ├── navigation/        # Navigation configuration
│   ├── screens/           # Screen components
│   ├── services/          # Business logic and API services
│   ├── storage/           # Database and data persistence
│   ├── theme/             # Theme configuration
│   └── types/             # TypeScript type definitions
├── android/               # Android native project
├── ios/                   # iOS native project
└── assets/                # Images, fonts, and static assets
```

### Key Services

- **MovellaBleService**: Handles BLE communication with Movella DOT sensors
- **HealthService**: Manages health data collection (steps, calories, distance)
- **AnalysisApi**: Processes movement data and generates analysis results
- **PatientService**: Manages patient data and assignments
- **LocalSessionService**: Handles local data storage and retrieval

### Data Flow

1. Sensor data is collected via BLE from Movella DOT sensors
2. Raw sensor data is converted to quaternion and Euler angle representations
3. Movement analysis algorithms process the data to extract metrics
4. Results are stored locally in SQLite and optionally synced with backend
5. UI components display analysis results and patient progress

## Prerequisites

### Required Software

- **Node.js**: Version 18.x or higher
- **npm**: Version 9.x or higher (comes with Node.js)
- **Git**: Latest stable version
- **Expo CLI**: Install globally with `npm install -g expo-cli eas-cli`

### Platform-Specific Requirements

#### iOS Development
- **macOS**: Required for iOS development
- **Xcode**: Version 14.0 or higher
- **CocoaPods**: Install with `sudo gem install cocoapods`
- **Apple Developer Account**: Required for device testing and App Store distribution

#### Android Development
- **Java Development Kit**: JDK 17 (OpenJDK recommended)
- **Android Studio**: Latest stable version
- **Android SDK**: API Level 33 or higher
- **Android SDK Platform Tools**: Included with Android Studio
- **Environment Variables**:
  - `ANDROID_HOME`: Path to Android SDK (typically `~/Library/Android/sdk` on macOS)
  - `JAVA_HOME`: Path to JDK installation
  - `PATH`: Must include `$ANDROID_HOME/platform-tools` and `$ANDROID_HOME/tools`

### EAS Build Account

- Expo account (free tier available)
- EAS Build access configured in `eas.json`

## Setup Instructions

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/joaopbs98/irhis.git
   cd irhis
   ```

2. **Install dependencies**
   ```bash
   cd frontend
   npm install
   ```

3. **Apply patches**
   The project uses `patch-package` to apply necessary patches to dependencies. Patches are automatically applied during `npm install` via the `postinstall` script.

4. **Configure environment variables**
   Create a `.env` file in the `frontend` directory if needed (currently not required for basic setup).

### iOS Setup

1. **Install CocoaPods dependencies**
   ```bash
   cd frontend/ios
   pod install
   cd ..
   ```

2. **Configure signing**
   - Open `frontend/ios/demoirhisn.xcworkspace` in Xcode
   - Select the project in the navigator
   - Go to "Signing & Capabilities"
   - Select your development team
   - Ensure bundle identifier matches `com.eucinovacao.irhismvp`

### Android Setup

1. **Configure Android SDK location**
   - Create or update `frontend/android/local.properties`:
     ```properties
     sdk.dir=/path/to/your/Android/sdk
     # Required for Android Studio (doesn't inherit terminal PATH). Find yours with: which node
     node.executable=/opt/homebrew/bin/node
     ```
   - On macOS, typically: `sdk.dir=/Users/username/Library/Android/sdk`

2. **Verify environment variables**
   ```bash
   echo $ANDROID_HOME
   echo $JAVA_HOME
   ```

3. **Test Android setup**
   ```bash
   cd frontend
   ./scripts/test-android-setup.sh
   ```

### Backend Setup

1. **Navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Create virtual environment** (recommended)
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the server**
   ```bash
   python app.py
   ```
   The server will start on `http://localhost:5000` by default.

## Development Workflow

### Running the Application

#### Development Client (Recommended for BLE features)

1. **Start the development server**
   ```bash
   cd frontend
   npm run start:dev-client
   ```

2. **Build and run on device**
   - iOS: `npm run ios:device` (requires connected iOS device)
   - Android: `npm run android` (requires connected Android device or emulator)

#### Expo Go (Limited functionality)

For quick testing without BLE features:
```bash
cd frontend
npm start
```
Scan the QR code with Expo Go app. Note: BLE functionality is not available in Expo Go.

### Development Builds

Create a development build for testing native features:

**iOS:**
```bash
cd frontend
eas build --profile development --platform ios
```

**Android:**
```bash
cd frontend
eas build --profile development --platform android
```

After the build completes, install the app on your device and run:
```bash
npm run start:dev-client
```

### Code Organization

- **Components**: Reusable UI components in `app/components/`
- **Screens**: Full-screen views in `app/screens/`
- **Services**: Business logic in `app/services/`
- **Types**: TypeScript definitions in `app/types/index.ts`
- **Context**: Global state management in `app/context/`

### TypeScript Configuration

The project uses strict TypeScript settings. Ensure all new code:
- Has proper type annotations
- Follows the existing type definitions
- Passes TypeScript compilation without errors

### Git Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes and commit**
   ```bash
   git add .
   git commit -m "feat: description of changes"
   ```

3. **Push and create pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

### Branch Naming Conventions

- `feature/`: New features
- `fix/`: Bug fixes
- `refactor/`: Code refactoring
- `docs/`: Documentation updates

## Key Features

### User Roles

The application supports two primary user roles:

**Doctor:**
- View and manage patient list
- Assign exercises to patients
- Review patient movement analysis results
- Monitor patient progress over time

**Patient:**
- View assigned exercises
- Record exercise sessions
- Track health metrics (steps, calories, distance)
- View analysis results and feedback

### Movement Analysis

- **Real-time sensor data collection** from Movella DOT sensors
- **Local analysis processing** for knee and hip movement assessment
- **Exercise detection** and repetition counting
- **Range of motion calculations**
- **Asymmetry metrics** for bilateral comparison
- **CSV export** of raw sensor data

### Bluetooth Low Energy Integration

- **Multi-sensor support**: Connect to up to 5 Movella DOT sensors simultaneously
- **Real-time streaming**: Continuous data collection during exercises
- **Sensor calibration**: Hardware tag identification and sensor mapping
- **Battery monitoring**: Track sensor battery levels
- **Connection management**: Automatic reconnection handling

### Health Tracking

- **Step counting**: Integration with device pedometer (iOS) and step tracking (Android)
- **Calorie estimation**: Based on step count and user metrics
- **Distance calculation**: Estimated from step count
- **Daily and weekly summaries**: Health data aggregation

### Data Management

- **Local storage**: SQLite database for offline functionality
- **Data export**: CSV and PDF export capabilities
- **Session management**: Local session storage and retrieval
- **Patient data**: Secure local storage of patient information

## Project Structure

### Frontend Directory Structure

```
frontend/
├── app/
│   ├── analysis/              # Movement analysis algorithms
│   │   ├── com.ts            # Center of mass calculations
│   │   ├── kinematics.ts    # Kinematic analysis
│   │   └── metrics.ts       # Movement metrics
│   ├── components/           # Reusable UI components
│   ├── context/              # React Context providers
│   ├── navigation/           # Navigation setup
│   ├── screens/              # Screen components
│   ├── services/             # Business logic services
│   ├── storage/              # Database and persistence
│   ├── theme/                # Theme configuration
│   └── types/                # TypeScript definitions
├── android/                  # Android native project
├── ios/                      # iOS native project
├── assets/                   # Static assets
├── App.tsx                   # Root component
├── app.json                  # Expo configuration
├── eas.json                  # EAS Build configuration
└── package.json             # Dependencies and scripts
```

### Backend Directory Structure

```
backend/
├── app.py                    # Flask application
├── requirements.txt         # Python dependencies
├── Procfile                 # Heroku deployment config
└── runtime.txt              # Python version specification
```

## Testing

### Running Tests

The project includes unit tests for analysis modules:

```bash
cd frontend
npm test
```

### Test Coverage

Current test coverage includes:
- Analysis pipeline tests (`app/analysis/__tests__/`)
- Kinematics calculations (`kinematics.test.ts`)
- Metrics calculations (`metrics.test.ts`)
- ZIP file reading (`io/__tests__/zipReader.test.ts`)
- Local analysis API (`services/__tests__/localAnalysisApi.test.ts`)

### Manual Testing

For features requiring device testing:
1. Build a development client
2. Install on physical device
3. Test BLE connectivity with Movella DOT sensors
4. Verify exercise recording and analysis

## Building and Deployment

### Development Builds

Development builds include debugging capabilities and are for internal testing:

```bash
cd frontend
eas build --profile development --platform ios
eas build --profile development --platform android
```

### Preview Builds

Preview builds are for internal distribution (APK for Android):

```bash
cd frontend
eas build --profile preview --platform android
```

### Production Builds

Production builds are optimized for App Store and Play Store distribution:

**iOS (App Store):**
```bash
cd frontend
eas build --profile production --platform ios
```

**Android (Play Store - App Bundle):**
```bash
cd frontend
eas build --profile production --platform android
```

### Build Configuration

Build profiles are configured in `frontend/eas.json`:
- `development`: Development client with debugging
- `preview`: Internal distribution (APK for Android)
- `production`: Store distribution (App Bundle for Android, IPA for iOS)

### Submission

After building, submit to app stores:

```bash
cd frontend
eas submit --platform ios
eas submit --platform android
```

## Troubleshooting

### Common Issues

#### Android Build Failures

**Issue**: SDK location not found
- **Solution**: Ensure `ANDROID_HOME` is set and `local.properties` exists in `frontend/android/`

**Issue**: Java version mismatch
- **Solution**: Verify JDK 17 is installed and `JAVA_HOME` points to it

**Issue**: Gradle build errors
- **Solution**: Clean build: `cd frontend/android && ./gradlew clean`

#### iOS Build Failures

**Issue**: CocoaPods installation errors
- **Solution**: Update CocoaPods: `sudo gem install cocoapods`, then `pod install --repo-update`

**Issue**: Code signing errors
- **Solution**: Configure signing in Xcode project settings

#### BLE Connection Issues

**Issue**: BLE not available in Expo Go
- **Solution**: Use a development build. BLE requires native modules not available in Expo Go

**Issue**: Sensors not discovered
- **Solution**: Ensure Bluetooth permissions are granted and sensors are in pairing mode

#### Pedometer Warnings (Android)

**Issue**: `Pedometer.getStepCountAsync` warnings on Android
- **Solution**: These warnings are expected. The app uses `watchStepCount` as a fallback on Android, which is the correct behavior.

### Debugging

1. **Check logs**: Use `npx expo start` and monitor console output
2. **React Native Debugger**: Use React Native Debugger for advanced debugging
3. **Device logs**: 
   - iOS: `xcrun simctl spawn booted log stream` or Xcode console
   - Android: `adb logcat` or Android Studio Logcat

### Getting Help

1. Check existing documentation in the `docs/` directory
2. Review error messages in console logs
3. Consult team members for platform-specific issues
4. Review Git history for similar issues and solutions

## Configuration Files

### Important Configuration Files

- `frontend/app.json`: Expo app configuration, permissions, and platform settings
- `frontend/eas.json`: EAS Build profiles and submission settings
- `frontend/android/app/src/main/AndroidManifest.xml`: Android permissions and app configuration
- `frontend/ios/demoirhisn/Info.plist`: iOS permissions and app configuration
- `frontend/package.json`: Dependencies and npm scripts

### Environment-Specific Settings

- **Bundle Identifiers**:
  - iOS: `com.eucinovacao.irhismvp`
  - Android: `com.joaosi98.irhis`

- **Version Management**:
  - iOS: Managed in `app.json` (`buildNumber`) and Xcode
  - Android: Managed in `app.json` (`versionCode`)

## Security Considerations

### Authentication

- Current implementation uses local authentication with preset users
- Production deployment should integrate with Azure AD or similar identity provider
- JWT tokens are used for session management

### Data Privacy

- Patient data is stored locally in SQLite
- Sensitive data should be encrypted at rest in production
- BLE communication uses standard BLE security protocols

### Permissions

The application requires the following permissions:
- **Bluetooth**: For Movella DOT sensor connectivity
- **Location**: Required for BLE scanning on Android
- **Activity Recognition**: For step counting on Android
- **Storage**: For data export functionality

## Contributing Guidelines

### Code Style

- Follow existing code patterns and conventions
- Use TypeScript for all new code
- Maintain consistent naming conventions
- Add comments for complex logic

### Commit Messages

Follow conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `refactor:` for code refactoring
- `docs:` for documentation
- `test:` for tests

### Pull Request Process

1. Create a feature branch from `main`
2. Implement changes with appropriate tests
3. Ensure all tests pass
4. Update documentation if needed
5. Create pull request with clear description
6. Request code review from team members

### Code Review Checklist

- Code follows project conventions
- TypeScript types are properly defined
- Error handling is implemented
- Tests are included for new features
- Documentation is updated
- No console.log statements in production code

## Additional Resources

### Documentation

- `docs/`: Project-specific documentation
- `docs/MOVELLA_DOT_LIMITATIONS.md`: Sensor limitations and known issues
- `docs/BLE_SETUP.md`: Bluetooth setup instructions
- `docs/API_CREDENTIALS_SETUP.md`: Backend API configuration

### External Resources

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [Movella DOT BLE Specification](https://www.movella.com/)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)

## License

This project is proprietary and confidential. All rights reserved.

## Contact

For questions or issues, contact the development team or create an issue in the repository.


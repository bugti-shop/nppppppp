# iOS Setup Guide for Npd

This guide covers the required iOS permissions and setup for push notifications, voice recording, and location-based reminders.

## Prerequisites

1. macOS with Xcode installed
2. Apple Developer Account (for push notifications)
3. Project exported to GitHub and cloned locally
4. Run `npm install` to install dependencies
5. Run `npx cap add ios` to add iOS platform
6. Run `npx cap sync` to sync the project

## Info.plist Permissions

After running `npx cap add ios`, you need to add the following permissions to your `ios/App/App/Info.plist` file:

### Required Permission Descriptions

Add these entries inside the `<dict>` tag:

```xml
<!-- Voice Recording Permission -->
<key>NSMicrophoneUsageDescription</key>
<string>Npd needs access to your microphone to record voice notes.</string>

<!-- Location Permissions for Location-Based Reminders -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>Npd needs your location to remind you of tasks when you arrive at or leave specific places.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Npd needs background location access to send you reminders when you arrive at or leave your saved locations, even when the app is closed.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>Npd needs background location access to send you reminders when you arrive at or leave your saved locations.</string>

<!-- Background Modes -->
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
    <string>location</string>
    <string>fetch</string>
    <string>processing</string>
</array>
```

### Full Info.plist Location Section Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- ... other entries ... -->
    
    <!-- Voice Recording -->
    <key>NSMicrophoneUsageDescription</key>
    <string>Npd needs access to your microphone to record voice notes.</string>
    
    <!-- Location Permissions -->
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>Npd needs your location to remind you of tasks when you arrive at or leave specific places.</string>
    
    <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
    <string>Npd needs background location access to send you reminders when you arrive at or leave your saved locations, even when the app is closed.</string>
    
    <key>NSLocationAlwaysUsageDescription</key>
    <string>Npd needs background location access to send you reminders when you arrive at or leave your saved locations.</string>
    
    <!-- Background Modes -->
    <key>UIBackgroundModes</key>
    <array>
        <string>remote-notification</string>
        <string>location</string>
        <string>fetch</string>
        <string>processing</string>
    </array>
    
    <!-- ... other entries ... -->
</dict>
</plist>
```

## Location-Based Reminders Setup

### Understanding iOS Location Permissions

iOS has a progressive permission model for location:

| Permission Level | When Granted | Use Case |
|-----------------|--------------|----------|
| When In Use | App is in foreground | Basic location features |
| Always | App in foreground OR background | Geofencing, background reminders |

### Background Location Capability in Xcode

1. Open the project in Xcode: `npx cap open ios`
2. Select your target (App)
3. Go to "Signing & Capabilities"
4. Click "+ Capability"
5. Add "Background Modes"
6. Check the following:
   - ✅ Location updates
   - ✅ Background fetch
   - ✅ Remote notifications

### Permission Flow

The app will request permissions in this order:
1. First, "When In Use" location permission
2. Then, if the user grants it, "Always" permission for background tracking

**Important:** Apple requires apps to first get "When In Use" permission before requesting "Always" permission.

### App Store Review Guidelines

When submitting to the App Store, you must:
1. Justify why your app needs background location
2. Include the location usage in your app's privacy policy
3. Add a note in App Store Connect explaining the background location use

## Push Notifications Setup

### Apple Push Notification Service (APNs) Setup

1. Log in to [Apple Developer Portal](https://developer.apple.com/)
2. Go to Certificates, Identifiers & Profiles
3. Create an App ID with Push Notifications capability
4. Create an APNs Key or Certificate
5. Configure your server with the APNs credentials

### Enable Push Notifications in Xcode

1. Open the project in Xcode: `npx cap open ios`
2. Select your target
3. Go to "Signing & Capabilities"
4. Click "+ Capability"
5. Add "Push Notifications"
6. Add "Background Modes" and check "Remote notifications"

## Voice Recording Setup

iOS requires permission description for microphone access. This is handled via the `NSMicrophoneUsageDescription` key in Info.plist.

The app will automatically prompt the user for microphone permission when they first try to record.

## Local Notifications Setup

Local notifications work out of the box with the Capacitor Local Notifications plugin. The user will be prompted for permission when scheduling the first notification.

## Building the App

1. Sync your project: `npx cap sync ios`
2. Open in Xcode: `npx cap open ios`
3. Select your development team in Signing & Capabilities
4. Build and run from Xcode

## Troubleshooting

### Location reminders not triggering in background

1. **Check Location Permission**: Go to Settings > Npd > Location
   - Ensure "Always" is selected (not "While Using")
   
2. **Check Background App Refresh**: Go to Settings > General > Background App Refresh
   - Ensure Npd is enabled
   
3. **Low Power Mode**: Location updates may be limited in Low Power Mode
   - Disable Low Power Mode for testing

4. **Verify Capability**: In Xcode, confirm "Location updates" is checked in Background Modes

### "Always" location permission not appearing

iOS only shows the "Always" option after you've granted "When In Use" permission and the app has demonstrated location use. The upgrade prompt may appear later.

Alternatively, users can go to Settings > Npd > Location and manually select "Always".

### Push notifications not working

- Ensure Push Notifications capability is enabled in Xcode
- Verify APNs certificate/key is configured correctly
- Check that the device is registered (simulators don't support push)

### Voice recording not working

- Ensure the NSMicrophoneUsageDescription is set in Info.plist
- Grant microphone permission when prompted

### Local notifications not appearing

- Ensure the app has notification permissions
- Check notification settings in iOS Settings app

### App rejected for background location

If Apple rejects your app for background location:
1. Ensure your usage description clearly explains why background location is needed
2. Add visible UI indicating when background location is active
3. Consider using region monitoring (geofencing) instead of continuous location updates
4. Update your privacy policy to mention location data usage

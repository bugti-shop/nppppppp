/**
 * Background Geolocation for native apps using Capacitor
 * This provides location tracking even when the app is in the background
 */

import { TodoItem, LocationReminder } from '@/types/note';
import { LocalNotifications } from '@capacitor/local-notifications';
import { triggerTripleHeavyHaptic } from './haptics';
import { calculateDistance, isInsideGeofence } from './geofencing';

const DEFAULT_NOTIFICATION_ICON = 'npd_notification_icon';

interface GeofenceState {
  taskId: string;
  wasInside: boolean;
  lastCheckTime: number;
}

// Store geofence states
const backgroundGeofenceStates: Map<string, GeofenceState> = new Map();

// Check if we're running in a native environment
export const isNativeApp = (): boolean => {
  return typeof (window as any).Capacitor !== 'undefined';
};

// Trigger notification for geofence
const triggerBackgroundNotification = async (
  task: TodoItem,
  isEntering: boolean
): Promise<void> => {
  if (!task.locationReminder) return;

  // Triple heavy haptic burst for location reminders
  await triggerTripleHeavyHaptic();

  const locationName = task.locationReminder.address.split(',')[0] || 'Location';
  const action = isEntering ? 'Arrived at' : 'Left';

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now(),
          title: `📍 ${action} ${locationName}`,
          body: task.text,
          schedule: { at: new Date(Date.now() + 100) },
          smallIcon: DEFAULT_NOTIFICATION_ICON,
          largeIcon: DEFAULT_NOTIFICATION_ICON,
          extra: {
            taskId: task.id,
            type: 'task',
            locationBased: true,
            action: isEntering ? 'enter' : 'exit',
          },
        },
      ],
    });
    console.log(`Background geofence notification for: ${task.text}`);
  } catch (error) {
    console.error('Error triggering background notification:', error);
  }
};

// Check geofences with given position
export const checkBackgroundGeofences = async (
  tasks: TodoItem[],
  latitude: number,
  longitude: number
): Promise<void> => {
  const tasksWithLocation = tasks.filter(
    (task) =>
      !task.completed &&
      task.locationReminder?.enabled &&
      task.locationReminder.latitude &&
      task.locationReminder.longitude
  );

  for (const task of tasksWithLocation) {
    if (!task.locationReminder) continue;

    const isInside = isInsideGeofence(latitude, longitude, task.locationReminder);
    const state = backgroundGeofenceStates.get(task.id);

    if (!state) {
      backgroundGeofenceStates.set(task.id, {
        taskId: task.id,
        wasInside: isInside,
        lastCheckTime: Date.now(),
      });
      continue;
    }

    if (isInside !== state.wasInside) {
      const isEntering = isInside;
      const isExiting = !isInside;

      if (isEntering && task.locationReminder.triggerOnEnter) {
        await triggerBackgroundNotification(task, true);
      } else if (isExiting && task.locationReminder.triggerOnExit) {
        await triggerBackgroundNotification(task, false);
      }

      backgroundGeofenceStates.set(task.id, {
        ...state,
        wasInside: isInside,
        lastCheckTime: Date.now(),
      });
    }
  }
};

// Configuration for background geolocation
export const backgroundGeolocationConfig = {
  backgroundMessage: 'NPD Todo is tracking your location for reminders',
  backgroundTitle: 'Location Reminders Active',
  requestPermissions: true,
  stale: false,
  distanceFilter: 50, // meters
};

// Start background location tracking
// Note: This requires @capacitor-community/background-geolocation to be installed
// and configured in the native project
export const startBackgroundLocationTracking = async (
  getTasksFn: () => TodoItem[]
): Promise<(() => void) | null> => {
  if (!isNativeApp()) {
    console.log('Background geolocation only available in native app');
    return null;
  }

  try {
    // Try to get the native plugin
    const Capacitor = (window as any).Capacitor;
    if (!Capacitor?.Plugins?.BackgroundGeolocation) {
      console.log('BackgroundGeolocation plugin not available');
      return null;
    }

    const BackgroundGeolocation = Capacitor.Plugins.BackgroundGeolocation;

    // Register watcher
    const watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: backgroundGeolocationConfig.backgroundMessage,
        backgroundTitle: backgroundGeolocationConfig.backgroundTitle,
        requestPermissions: backgroundGeolocationConfig.requestPermissions,
        stale: backgroundGeolocationConfig.stale,
        distanceFilter: backgroundGeolocationConfig.distanceFilter,
      },
      async (location: any, error: any) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            console.warn('Background location permission denied');
          }
          return;
        }

        if (location) {
          const tasks = getTasksFn();
          await checkBackgroundGeofences(tasks, location.latitude, location.longitude);
        }
      }
    );

    console.log('Background location tracking started');

    // Return cleanup function
    return () => {
      BackgroundGeolocation.removeWatcher({ id: watcherId });
      backgroundGeofenceStates.clear();
      console.log('Background location tracking stopped');
    };
  } catch (error) {
    console.error('Error starting background location:', error);
    return null;
  }
};

// Clear states
export const clearBackgroundGeofenceStates = (): void => {
  backgroundGeofenceStates.clear();
};

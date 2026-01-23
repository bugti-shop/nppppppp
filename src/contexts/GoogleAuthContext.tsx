import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { getSetting, setSetting, removeSetting } from '@/utils/settingsStorage';
import { getGoogleDriveSyncManager, startAutoSync, stopAutoSync, setupChangeListeners } from '@/utils/googleDriveSync';
import { startCalendarAutoSync, stopCalendarAutoSync } from '@/utils/calendarBidirectionalSync';
import { getCalendarSyncSettings } from '@/utils/googleCalendarSync';

// Google Auth types
export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  givenName?: string;
  familyName?: string;
  imageUrl?: string;
}

export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
}

interface GoogleAuthContextType {
  user: GoogleUser | null;
  tokens: GoogleAuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshTokens: () => Promise<boolean>;
}

const GoogleAuthContext = createContext<GoogleAuthContextType | undefined>(undefined);

// Web Client ID (serverClientId - required for backend token validation)
const GOOGLE_WEB_CLIENT_ID = '52777395492-vnlk2hkr3pv15dtpgp2m51p7418vll90.apps.googleusercontent.com';

// Scopes for Google APIs
const SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendars',
].join(' ');

const STORAGE_KEYS = {
  USER: 'google_user',
  TOKENS: 'google_tokens',
};

// Custom URL scheme for deep linking (matches capacitor.config.ts appId)
const APP_SCHEME = 'app.lovable.c4920824037c4205bb9ed6cc0d5a0385';

export const GoogleAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [tokens, setTokens] = useState<GoogleAuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const changeListenerCleanup = useRef<(() => void) | null>(null);
  const signInResolver = useRef<((value: boolean) => void) | null>(null);

  // Refresh access token
  const refreshAccessToken = useCallback(async (refreshToken: string): Promise<boolean> => {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_WEB_CLIENT_ID,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      const newTokens: GoogleAuthTokens = {
        accessToken: data.access_token,
        refreshToken: refreshToken,
        idToken: data.id_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
      };

      setTokens(newTokens);
      await setSetting(STORAGE_KEYS.TOKENS, newTokens);
      return true;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return false;
    }
  }, []);

  // Start background sync when we have valid tokens
  const startBackgroundSync = useCallback(async (accessToken: string) => {
    console.log('[GoogleAuth] Starting background sync...');
    
    // Stop any existing sync
    stopAutoSync();
    stopCalendarAutoSync();
    if (changeListenerCleanup.current) {
      changeListenerCleanup.current();
    }
    
    // Start 1-minute auto-sync for Drive backup
    startAutoSync(accessToken, 1);
    
    // Set up real-time change listeners
    changeListenerCleanup.current = setupChangeListeners(accessToken);
    
    // Start Calendar bidirectional sync (5-min interval + instant on task change)
    try {
      const calendarSettings = await getCalendarSyncSettings();
      if (calendarSettings.enabled) {
        await startCalendarAutoSync(accessToken, 5);
        console.log('[GoogleAuth] Calendar bidirectional sync started');
      }
    } catch (error) {
      console.warn('[GoogleAuth] Calendar sync initialization failed:', error);
    }
    
    console.log('[GoogleAuth] Background sync started');
  }, []);

  // Auto-restore data from Google Drive after login
  const restoreFromCloud = useCallback(async (accessToken: string) => {
    try {
      setIsRestoring(true);
      console.log('[GoogleAuth] Checking for cloud backup...');
      
      const syncManager = getGoogleDriveSyncManager(accessToken);
      const backupInfo = await syncManager.getCloudBackupInfo();
      
      if (backupInfo?.exists) {
        console.log('[GoogleAuth] Cloud backup found, downloading...');
        const backup = await syncManager.downloadBackup();
        
        if (backup) {
          console.log('[GoogleAuth] Restoring data from cloud backup...');
          const restored = await syncManager.restoreFromBackup(backup);
          
          if (restored) {
            console.log('[GoogleAuth] Data restored successfully!');
          } else {
            console.warn('[GoogleAuth] Failed to restore data');
          }
        }
      } else {
        console.log('[GoogleAuth] No cloud backup found, uploading local data...');
        const localData = await syncManager.collectBackupData();
        await syncManager.uploadBackup(localData);
      }
      
      // Start background sync after restore
      startBackgroundSync(accessToken);
    } catch (error) {
      console.error('[GoogleAuth] Error restoring from cloud:', error);
    } finally {
      setIsRestoring(false);
    }
  }, [startBackgroundSync]);

  // Handle OAuth callback from deep link or URL
  const handleOAuthCallback = useCallback(async (url: string): Promise<boolean> => {
    try {
      // Parse the URL to extract tokens from hash fragment
      const urlObj = new URL(url);
      const hashParams = new URLSearchParams(urlObj.hash.substring(1));
      
      const accessToken = hashParams.get('access_token');
      const expiresIn = hashParams.get('expires_in');
      const state = hashParams.get('state');
      const error = hashParams.get('error');
      
      if (error) {
        console.error('[GoogleAuth] OAuth error:', error);
        return false;
      }
      
      // Verify state
      const savedState = sessionStorage.getItem('google_oauth_state');
      if (state && savedState && state !== savedState) {
        console.error('[GoogleAuth] State mismatch');
        return false;
      }
      
      if (!accessToken) {
        console.error('[GoogleAuth] No access token in callback');
        return false;
      }
      
      // Fetch user info
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (!userResponse.ok) {
        console.error('[GoogleAuth] Failed to fetch user info');
        return false;
      }
      
      const userData = await userResponse.json();
      
      const googleUser: GoogleUser = {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        givenName: userData.given_name,
        familyName: userData.family_name,
        imageUrl: userData.picture,
      };

      const googleTokens: GoogleAuthTokens = {
        accessToken,
        expiresAt: Date.now() + (parseInt(expiresIn || '3600') * 1000),
      };

      setUser(googleUser);
      setTokens(googleTokens);
      await setSetting(STORAGE_KEYS.USER, googleUser);
      await setSetting(STORAGE_KEYS.TOKENS, googleTokens);

      // Auto-restore data from cloud after login
      restoreFromCloud(accessToken);
      
      return true;
    } catch (error) {
      console.error('[GoogleAuth] Error handling OAuth callback:', error);
      return false;
    }
  }, [restoreFromCloud]);

  // Load saved auth state on mount and set up deep link listener
  useEffect(() => {
    let isMounted = true;
    let appUrlListener: any = null;
    
    const loadAuthState = async () => {
      try {
        const savedUser = await getSetting<GoogleUser | null>(STORAGE_KEYS.USER, null);
        const savedTokens = await getSetting<GoogleAuthTokens | null>(STORAGE_KEYS.TOKENS, null);
        
        if (!isMounted) return;
        
        if (savedUser && savedTokens) {
          // Check if token is still valid
          if (savedTokens.expiresAt && savedTokens.expiresAt > Date.now()) {
            setUser(savedUser);
            setTokens(savedTokens);
            
            // Start background sync with existing valid token
            if (savedTokens.accessToken) {
              console.log('[GoogleAuth] Resuming background sync with saved token...');
              startBackgroundSync(savedTokens.accessToken);
            }
          } else if (savedTokens.refreshToken) {
            // Try to refresh the token
            console.log('[GoogleAuth] Token expired, refreshing...');
            const refreshed = await refreshAccessToken(savedTokens.refreshToken);
            if (refreshed && isMounted) {
              setUser(savedUser);
            }
          } else {
            console.log('[GoogleAuth] No valid token or refresh token available');
          }
        }
      } catch (error) {
        console.error('[GoogleAuth] Error loading auth state:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    // Set up deep link listener for native platforms
    const setupDeepLinkListener = async () => {
      if (Capacitor.isNativePlatform()) {
        appUrlListener = await App.addListener('appUrlOpen', async (event) => {
          console.log('[GoogleAuth] Deep link received:', event.url);
          
          // Check if this is an OAuth callback
          if (event.url.includes('access_token') || event.url.includes('error')) {
            // Close the browser
            try {
              await Browser.close();
            } catch {
              // Browser might already be closed
            }
            
            const success = await handleOAuthCallback(event.url);
            
            // Resolve the pending sign-in promise
            if (signInResolver.current) {
              signInResolver.current(success);
              signInResolver.current = null;
            }
          }
        });
      }
    };

    loadAuthState();
    setupDeepLinkListener();
    
    // Cleanup on unmount
    return () => {
      isMounted = false;
      stopAutoSync();
      if (changeListenerCleanup.current) {
        changeListenerCleanup.current();
      }
      if (appUrlListener) {
        appUrlListener.remove();
      }
    };
  }, [startBackgroundSync, refreshAccessToken, handleOAuthCallback]);

  const signIn = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const state = Math.random().toString(36).substring(7);
      sessionStorage.setItem('google_oauth_state', state);
      
      if (Capacitor.isNativePlatform()) {
        // Use in-app browser for OAuth on native platforms
        // Redirect URI uses the custom URL scheme for deep linking
        const redirectUri = `${APP_SCHEME}://oauth/callback`;
        
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_WEB_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', SCOPES);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('prompt', 'select_account');

        // Open OAuth URL in in-app browser
        await Browser.open({ 
          url: authUrl.toString(),
          presentationStyle: 'popover',
        });
        
        // Return a promise that resolves when we get the deep link callback
        return new Promise((resolve) => {
          signInResolver.current = resolve;
          
          // Timeout after 5 minutes
          setTimeout(() => {
            if (signInResolver.current) {
              signInResolver.current(false);
              signInResolver.current = null;
            }
          }, 5 * 60 * 1000);
        });
      } else {
        // Web OAuth flow using popup
        const redirectUri = window.location.origin + '/auth/callback';
        
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_WEB_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', SCOPES);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('prompt', 'select_account');

        const popup = window.open(authUrl.toString(), 'google-auth', 'width=500,height=600');
        
        return new Promise((resolve) => {
          const handleMessage = async (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            
            if (event.data?.type === 'google-auth-success') {
              window.removeEventListener('message', handleMessage);
              
              const { accessToken, expiresIn } = event.data;
              
              const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              
              if (userResponse.ok) {
                const userData = await userResponse.json();
                
                const googleUser: GoogleUser = {
                  id: userData.id,
                  email: userData.email,
                  name: userData.name,
                  givenName: userData.given_name,
                  familyName: userData.family_name,
                  imageUrl: userData.picture,
                };

                const googleTokens: GoogleAuthTokens = {
                  accessToken,
                  expiresAt: Date.now() + (expiresIn * 1000),
                };

                setUser(googleUser);
                setTokens(googleTokens);
                await setSetting(STORAGE_KEYS.USER, googleUser);
                await setSetting(STORAGE_KEYS.TOKENS, googleTokens);

                // Auto-restore data from cloud after login
                if (accessToken) {
                  restoreFromCloud(accessToken);
                }

                resolve(true);
              } else {
                resolve(false);
              }
            } else if (event.data?.type === 'google-auth-error') {
              window.removeEventListener('message', handleMessage);
              resolve(false);
            }
          };

          window.addEventListener('message', handleMessage);

          const checkClosed = setInterval(() => {
            if (popup?.closed) {
              clearInterval(checkClosed);
              window.removeEventListener('message', handleMessage);
              setIsLoading(false);
              resolve(false);
            }
          }, 1000);
        });
      }
    } catch (error) {
      console.error('[GoogleAuth] Sign-in error:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [restoreFromCloud]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      // Stop all background sync
      stopAutoSync();
      stopCalendarAutoSync();
      if (changeListenerCleanup.current) {
        changeListenerCleanup.current();
        changeListenerCleanup.current = null;
      }

      // Revoke token if we have one
      if (tokens?.accessToken) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.accessToken}`, {
          method: 'POST',
        }).catch(() => {});
      }

      setUser(null);
      setTokens(null);
      await removeSetting(STORAGE_KEYS.USER);
      await removeSetting(STORAGE_KEYS.TOKENS);
    } catch {
      // Silent error handling for sign-out
    }
  }, [tokens]);

  const refreshTokens = useCallback(async (): Promise<boolean> => {
    if (!tokens?.refreshToken) return false;
    return refreshAccessToken(tokens.refreshToken);
  }, [tokens, refreshAccessToken]);

  const value: GoogleAuthContextType = {
    user,
    tokens,
    isAuthenticated: !!user && !!tokens,
    isLoading,
    isRestoring,
    signIn,
    signOut,
    refreshTokens,
  };

  return (
    <GoogleAuthContext.Provider value={value}>
      {children}
    </GoogleAuthContext.Provider>
  );
};

export const useGoogleAuth = () => {
  const context = useContext(GoogleAuthContext);
  if (context === undefined) {
    throw new Error('useGoogleAuth must be used within a GoogleAuthProvider');
  }
  return context;
};

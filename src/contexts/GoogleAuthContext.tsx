import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
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

// Web Client ID (serverClientId - required for backend token validation and native sign-in)
const GOOGLE_WEB_CLIENT_ID = '52777395492-vnlk2hkr3pv15dtpgp2m51p7418vll90.apps.googleusercontent.com';

// iOS Client ID - Create this in Google Cloud Console for iOS app
// To get this: Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → iOS
// Bundle ID must match your app: app.lovable.c4920824037c4205bb9ed6cc0d5a0385
const GOOGLE_IOS_CLIENT_ID = ''; // Add your iOS Client ID here when available

// Scopes for Google APIs - using array format for Capgo plugin
const SCOPES_ARRAY = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendars',
];

const SCOPES = SCOPES_ARRAY.join(' ');

const STORAGE_KEYS = {
  USER: 'google_user',
  TOKENS: 'google_tokens',
};

export const GoogleAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [tokens, setTokens] = useState<GoogleAuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const changeListenerCleanup = useRef<(() => void) | null>(null);

  // Refresh access token - defined first so it can be used in useEffect
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
    
    console.log('[GoogleAuth] Background sync started (1-min interval + instant changes + calendar sync)');
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
        // Upload current local data as first backup
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

  // Load saved auth state on mount
  useEffect(() => {
    let isMounted = true;
    
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

    loadAuthState();
    
    // Cleanup on unmount
    return () => {
      isMounted = false;
      stopAutoSync();
      if (changeListenerCleanup.current) {
        changeListenerCleanup.current();
      }
    };
  }, [startBackgroundSync, refreshAccessToken]);


  // Exchange serverAuthCode for access token (needed for Android to get Drive API access)
  const exchangeAuthCodeForTokens = async (serverAuthCode: string): Promise<GoogleAuthTokens | null> => {
    try {
      console.log('[GoogleAuth] Exchanging auth code for tokens...');
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: serverAuthCode,
          client_id: GOOGLE_WEB_CLIENT_ID,
          redirect_uri: '', // Empty for native apps
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[GoogleAuth] Token exchange failed:', errorData);
        return null;
      }

      const data = await response.json();
      console.log('[GoogleAuth] Token exchange successful');
      
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
      };
    } catch (error) {
      console.error('[GoogleAuth] Token exchange error:', error);
      return null;
    }
  };

  const signIn = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // Native in-app Google Sign-In using @capgo/capacitor-social-login
        const platform = Capacitor.getPlatform();
        
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        
        // Build platform-specific configuration
        const googleConfig: any = {
          webClientId: GOOGLE_WEB_CLIENT_ID,
          mode: 'online', // Use online mode to get accessToken directly
        };
        
        // Add iOS-specific configuration
        if (platform === 'ios' && GOOGLE_IOS_CLIENT_ID) {
          googleConfig.iOSClientId = GOOGLE_IOS_CLIENT_ID;
        }
        
        try {
          await SocialLogin.initialize({
            google: googleConfig,
          });
        } catch (initError: any) {
          // Only log critical initialization errors in development
          if (initError?.message?.includes('Cannot find provider')) {
            console.warn('[GoogleAuth] Provider not found - check plugin installation');
          }
          return false;
        }

        // Perform native Google login
        let result;
        try {
          result = await SocialLogin.login({
            provider: 'google',
            options: {
              scopes: SCOPES_ARRAY,
              forceRefreshToken: true,
            },
          });
        } catch (loginError: any) {
          // User cancelled or other expected failures - return silently
          const errorCode = loginError?.code?.toString() || '';
          const errorMessage = loginError?.message || '';
          
          // User cancelled (12501 on Android, various on iOS)
          if (errorCode === '12501' || errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
            return false;
          }
          
          // SHA-1 mismatch - log for developer
          if (errorCode === '10' || errorMessage.includes('10')) {
            console.warn('[GoogleAuth] SHA-1 fingerprint mismatch');
          }
          
          return false;
        }
        
        if (result.provider === 'google' && result.result) {
          const googleResult = result.result as any;
          
          // Extract profile from various possible locations in the response
          const profile = googleResult.profile || googleResult.user || googleResult;
          
          const googleUser: GoogleUser = {
            id: profile?.id || profile?.sub || profile?.userId || '',
            email: profile?.email || '',
            name: profile?.name || profile?.displayName || profile?.givenName || '',
            givenName: profile?.givenName || profile?.given_name || profile?.firstName,
            familyName: profile?.familyName || profile?.family_name || profile?.lastName,
            imageUrl: profile?.imageUrl || profile?.picture || profile?.photoUrl,
          };

          // Extract access token - handle multiple response formats from Capgo plugin
          let accessToken = '';
          if (typeof googleResult.accessToken === 'string') {
            accessToken = googleResult.accessToken;
          } else if (googleResult.accessToken?.token) {
            accessToken = googleResult.accessToken.token;
          } else if (googleResult.authentication?.accessToken) {
            accessToken = googleResult.authentication.accessToken;
          }
          
          // Check for serverAuthCode (offline mode or when scopes require server exchange)
          const serverAuthCode = googleResult.serverAuthCode || googleResult.authCode || googleResult.authentication?.serverAuthCode;
          
          // Get idToken
          const idToken = googleResult.idToken || googleResult.authentication?.idToken || '';
          
          let googleTokens: GoogleAuthTokens;
          
          // If we have serverAuthCode but no accessToken, exchange it for tokens
          if (!accessToken && serverAuthCode) {
            const exchangedTokens = await exchangeAuthCodeForTokens(serverAuthCode);
            if (exchangedTokens) {
              googleTokens = exchangedTokens;
              accessToken = exchangedTokens.accessToken;
            } else {
              return false;
            }
          } else if (accessToken) {
            googleTokens = {
              accessToken,
              refreshToken: googleResult.refreshToken || googleResult.authentication?.refreshToken,
              idToken,
              expiresAt: Date.now() + 3600000, // 1 hour
            };
          } else {
            // No accessToken and no serverAuthCode - try to use idToken only
            if (idToken) {
              // For now, we can still authenticate the user but sync won't work
              googleTokens = {
                accessToken: '',
                idToken,
                expiresAt: Date.now() + 3600000,
              };
            } else {
              return false;
            }
          }

          // Final validation
          if (!googleTokens.accessToken && !googleTokens.idToken) {
            return false;
          }

          setUser(googleUser);
          setTokens(googleTokens);
          await setSetting(STORAGE_KEYS.USER, googleUser);
          await setSetting(STORAGE_KEYS.TOKENS, googleTokens);
          
          // Auto-restore data from cloud after login
          restoreFromCloud(googleTokens.accessToken);
          
          return true;
        }
        return false;
      } else {
        // Web OAuth flow
        const redirectUri = window.location.origin + '/auth/callback';
        const state = Math.random().toString(36).substring(7);
        
        sessionStorage.setItem('google_oauth_state', state);

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
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      // Stop all background sync
      stopAutoSync();
      stopCalendarAutoSync();
      if (changeListenerCleanup.current) {
        changeListenerCleanup.current();
        changeListenerCleanup.current = null;
      }
      
      if (Capacitor.isNativePlatform()) {
        try {
          const { SocialLogin } = await import('@capgo/capacitor-social-login');
          await SocialLogin.logout({ provider: 'google' });
        } catch {
          // Ignore logout errors
        }
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
  }, [tokens]);

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

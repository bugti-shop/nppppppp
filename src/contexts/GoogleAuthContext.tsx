import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { getSetting, setSetting, removeSetting } from '@/utils/settingsStorage';
import { getGoogleDriveSyncManager, startAutoSync, stopAutoSync, setupChangeListeners } from '@/utils/googleDriveSync';

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

  // Start background sync when we have valid tokens
  const startBackgroundSync = useCallback((accessToken: string) => {
    console.log('[GoogleAuth] Starting background sync...');
    
    // Stop any existing sync
    stopAutoSync();
    if (changeListenerCleanup.current) {
      changeListenerCleanup.current();
    }
    
    // Start 5-minute auto-sync
    startAutoSync(accessToken, 5);
    
    // Set up real-time change listeners
    changeListenerCleanup.current = setupChangeListeners(accessToken);
    
    console.log('[GoogleAuth] Background sync started (5-min interval + real-time changes)');
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
    const loadAuthState = async () => {
      try {
        const savedUser = await getSetting<GoogleUser | null>(STORAGE_KEYS.USER, null);
        const savedTokens = await getSetting<GoogleAuthTokens | null>(STORAGE_KEYS.TOKENS, null);
        
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
            const refreshed = await refreshAccessToken(savedTokens.refreshToken);
            if (refreshed) {
              setUser(savedUser);
            }
          }
        }
      } catch (error) {
        console.error('Error loading auth state:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAuthState();
    
    // Cleanup on unmount
    return () => {
      stopAutoSync();
      if (changeListenerCleanup.current) {
        changeListenerCleanup.current();
      }
    };
  }, [startBackgroundSync]);

  const refreshAccessToken = async (refreshToken: string): Promise<boolean> => {
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
  };

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
        console.log('[GoogleAuth] Starting native sign-in flow...');
        console.log('[GoogleAuth] Platform:', Capacitor.getPlatform());
        
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        
        // Initialize the plugin with proper configuration for Android
        console.log('[GoogleAuth] Initializing SocialLogin...');
        console.log('[GoogleAuth] WebClientId:', GOOGLE_WEB_CLIENT_ID);
        console.log('[GoogleAuth] Scopes:', SCOPES_ARRAY);
        
        try {
          await SocialLogin.initialize({
            google: {
              webClientId: GOOGLE_WEB_CLIENT_ID,
              mode: 'online', // Use online mode to get accessToken directly
            },
          });
          console.log('[GoogleAuth] SocialLogin initialized successfully');
        } catch (initError: any) {
          console.error('[GoogleAuth] Initialize error:', initError?.message || initError);
          console.error('[GoogleAuth] Initialize error details:', JSON.stringify(initError, null, 2));
          
          // Check for common errors
          if (initError?.message?.includes('Cannot find provider')) {
            console.error('[GoogleAuth] Provider not found - check plugin installation and capacitor.config.ts');
          }
          throw initError;
        }

        // Perform native Google login with proper options
        console.log('[GoogleAuth] Calling SocialLogin.login...');
        let result;
        try {
          result = await SocialLogin.login({
            provider: 'google',
            options: {
              scopes: SCOPES_ARRAY,
              forceRefreshToken: true, // Ensures we get fresh tokens with proper scopes
            },
          });
          console.log('[GoogleAuth] Login successful');
          console.log('[GoogleAuth] Login result keys:', Object.keys(result));
          console.log('[GoogleAuth] Login result:', JSON.stringify(result, null, 2));
        } catch (loginError: any) {
          console.error('[GoogleAuth] Login error:', loginError?.message || loginError);
          console.error('[GoogleAuth] Login error code:', loginError?.code);
          console.error('[GoogleAuth] Full error object:', JSON.stringify(loginError, null, 2));
          
          // Handle specific error codes
          if (loginError?.code === '10' || loginError?.message?.includes('10')) {
            console.error('[GoogleAuth] Error 10: SHA-1 fingerprint mismatch. Check Google Cloud Console configuration.');
          } else if (loginError?.code === '12501' || loginError?.message?.includes('cancelled')) {
            console.log('[GoogleAuth] User cancelled sign-in');
          }
          throw loginError;
        }
        
        if (result.provider === 'google' && result.result) {
          const googleResult = result.result as any;
          
          // Log the full result structure to debug token extraction
          console.log('[GoogleAuth] Full googleResult keys:', Object.keys(googleResult));
          console.log('[GoogleAuth] accessToken type:', typeof googleResult.accessToken);
          console.log('[GoogleAuth] idToken present:', !!googleResult.idToken);
          
          // Extract profile from various possible locations in the response
          const profile = googleResult.profile || googleResult.user || googleResult;
          
          console.log('[GoogleAuth] Profile keys:', Object.keys(profile || {}));
          
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
          
          console.log('[GoogleAuth] Extracted accessToken:', accessToken ? `${accessToken.substring(0, 20)}...` : 'NONE');
          console.log('[GoogleAuth] Extracted serverAuthCode:', serverAuthCode ? `${serverAuthCode.substring(0, 20)}...` : 'NONE');
          console.log('[GoogleAuth] Extracted idToken:', idToken ? 'Present' : 'NONE');
          
          let googleTokens: GoogleAuthTokens;
          
          // If we have serverAuthCode but no accessToken, exchange it for tokens
          if (!accessToken && serverAuthCode) {
            console.log('[GoogleAuth] No access token, exchanging auth code for tokens...');
            const exchangedTokens = await exchangeAuthCodeForTokens(serverAuthCode);
            if (exchangedTokens) {
              googleTokens = exchangedTokens;
              accessToken = exchangedTokens.accessToken;
              console.log('[GoogleAuth] Token exchange successful');
            } else {
              console.error('[GoogleAuth] Failed to exchange auth code for tokens');
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
            // No accessToken and no serverAuthCode - try to use idToken to get user info
            console.error('[GoogleAuth] No accessToken or serverAuthCode available');
            console.log('[GoogleAuth] Attempting to continue with idToken only...');
            
            if (idToken) {
              // For now, we can still authenticate the user but sync won't work
              googleTokens = {
                accessToken: '', // Empty - will need to request again
                idToken,
                expiresAt: Date.now() + 3600000,
              };
              console.warn('[GoogleAuth] Warning: No accessToken - Google Drive sync will not work');
            } else {
              console.error('[GoogleAuth] No tokens available at all');
              return false;
            }
          }

          // Final validation
          if (!googleTokens.accessToken && !googleTokens.idToken) {
            console.error('[GoogleAuth] No valid tokens obtained');
            return false;
          }

          setUser(googleUser);
          setTokens(googleTokens);
          await setSetting(STORAGE_KEYS.USER, googleUser);
          await setSetting(STORAGE_KEYS.TOKENS, googleTokens);

          console.log('[GoogleAuth] Sign-In successful:', googleUser.email);
          console.log('[GoogleAuth] Token expires at:', new Date(googleTokens.expiresAt || 0).toISOString());
          
          // Auto-restore data from cloud after login
          restoreFromCloud(googleTokens.accessToken);
          
          return true;
        }
        console.warn('[GoogleAuth] No valid result received');
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
      console.error('Sign in error:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      // Stop background sync
      stopAutoSync();
      if (changeListenerCleanup.current) {
        changeListenerCleanup.current();
        changeListenerCleanup.current = null;
      }
      
      if (Capacitor.isNativePlatform()) {
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        await SocialLogin.logout({ provider: 'google' });
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
      
      console.log('[GoogleAuth] Signed out and sync stopped');
    } catch (error) {
      console.error('Sign out error:', error);
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

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getSetting, setSetting, removeSetting } from '@/utils/settingsStorage';

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
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshTokens: () => Promise<boolean>;
}

const GoogleAuthContext = createContext<GoogleAuthContextType | undefined>(undefined);

// Android Client ID (for native Android sign-in)
const GOOGLE_ANDROID_CLIENT_ID = '52777395492-u1ftmivj74c038qt6gs4c6fc7bsti5ij.apps.googleusercontent.com';
// Web Client ID (serverClientId - required for backend token validation)
const GOOGLE_WEB_CLIENT_ID = '52777395492-vnlk2hkr3pv15dtpgp2m51p7418vll90.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendars',
  'https://www.googleapis.com/auth/drive.appdata',
  'profile',
  'email'
].join(' ');

const STORAGE_KEYS = {
  USER: 'google_user',
  TOKENS: 'google_tokens',
};

export const GoogleAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [tokens, setTokens] = useState<GoogleAuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
  }, []);

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

  const signIn = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // Native in-app Google Sign-In using @capgo/capacitor-social-login
        console.log('[GoogleAuth] Starting native sign-in flow...');
        
        const { SocialLogin } = await import('@capgo/capacitor-social-login');
        
        // Initialize the plugin with Web Client ID as serverClientId
        console.log('[GoogleAuth] Initializing SocialLogin with webClientId:', GOOGLE_WEB_CLIENT_ID);
        
        try {
          await SocialLogin.initialize({
            google: {
              webClientId: GOOGLE_WEB_CLIENT_ID,
            },
          });
          console.log('[GoogleAuth] SocialLogin initialized successfully');
        } catch (initError: any) {
          console.error('[GoogleAuth] Initialize error:', initError?.message || initError);
          throw initError;
        }

        // Perform native Google login
        console.log('[GoogleAuth] Calling SocialLogin.login...');
        let result;
        try {
          result = await SocialLogin.login({
            provider: 'google',
            options: {
              scopes: SCOPES.split(' '),
            },
          });
          console.log('[GoogleAuth] Login result:', JSON.stringify(result, null, 2));
        } catch (loginError: any) {
          console.error('[GoogleAuth] Login error:', loginError?.message || loginError);
          console.error('[GoogleAuth] Full error object:', JSON.stringify(loginError, null, 2));
          throw loginError;
        }
        
        if (result.provider === 'google' && result.result) {
          const googleResult = result.result as any;
          const profile = googleResult.profile || googleResult.user || googleResult;
          
          const googleUser: GoogleUser = {
            id: profile?.id || profile?.sub || '',
            email: profile?.email || '',
            name: profile?.name || profile?.displayName || '',
            givenName: profile?.givenName || profile?.given_name,
            familyName: profile?.familyName || profile?.family_name,
            imageUrl: profile?.imageUrl || profile?.picture,
          };

          const googleTokens: GoogleAuthTokens = {
            accessToken: googleResult.accessToken?.token || googleResult.accessToken || '',
            refreshToken: googleResult.refreshToken,
            idToken: googleResult.idToken,
            expiresAt: Date.now() + 3600000, // 1 hour
          };

          setUser(googleUser);
          setTokens(googleTokens);
          await setSetting(STORAGE_KEYS.USER, googleUser);
          await setSetting(STORAGE_KEYS.TOKENS, googleTokens);

          console.log('[GoogleAuth] Sign-In successful:', googleUser.email);
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

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

const GOOGLE_CLIENT_ID = '52777395492-u1ftmivj74c038qt6gs4c6fc7bsti5ij.apps.googleusercontent.com';
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
          client_id: GOOGLE_CLIENT_ID,
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
        // Native sign-in using Capacitor plugin
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
        
        await GoogleAuth.initialize({
          clientId: GOOGLE_CLIENT_ID,
          scopes: SCOPES.split(' '),
          grantOfflineAccess: true,
        });

        const result = await GoogleAuth.signIn();
        
        const googleUser: GoogleUser = {
          id: result.id || '',
          email: result.email || '',
          name: result.name || '',
          givenName: result.givenName,
          familyName: result.familyName,
          imageUrl: result.imageUrl,
        };

        const googleTokens: GoogleAuthTokens = {
          accessToken: result.authentication?.accessToken || '',
          refreshToken: result.authentication?.refreshToken,
          idToken: result.authentication?.idToken,
          expiresAt: Date.now() + 3600000, // 1 hour
        };

        setUser(googleUser);
        setTokens(googleTokens);
        await setSetting(STORAGE_KEYS.USER, googleUser);
        await setSetting(STORAGE_KEYS.TOKENS, googleTokens);

        return true;
      } else {
        // Web OAuth flow
        const redirectUri = window.location.origin + '/auth/callback';
        const state = Math.random().toString(36).substring(7);
        
        // Store state for verification
        sessionStorage.setItem('google_oauth_state', state);

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', SCOPES);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        // Open OAuth popup
        const popup = window.open(authUrl.toString(), 'google-auth', 'width=500,height=600');
        
        return new Promise((resolve) => {
          const handleMessage = async (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            
            if (event.data?.type === 'google-auth-success') {
              window.removeEventListener('message', handleMessage);
              
              const { accessToken, expiresIn } = event.data;
              
              // Fetch user info
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

          // Check if popup was closed
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
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
        await GoogleAuth.signOut();
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

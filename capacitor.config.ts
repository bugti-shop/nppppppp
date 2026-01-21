import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.c4920824037c4205bb9ed6cc0d5a0385',
  appName: 'Npd',
  webDir: 'dist',
  server: {
    url: 'https://c4920824-037c-4205-bb9e-d6cc0d5a0385.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#488AFF",
    },
    SocialLogin: {
      google: {
        webClientId: '52777395492-vnlk2hkr3pv15dtpgp2m51p7418vll90.apps.googleusercontent.com',
      },
    },
  },
};

export default config;

type AppEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

const appEnv = ((import.meta as AppEnv).env ?? {}) as Record<string, string | undefined>;

export const environment = {
  production: appEnv['NG_APP_PRODUCTION'] === 'true',
  apiUrl: appEnv['NG_APP_API_URL'] ?? '/api',
  firebase: {
    apiKey: appEnv['NG_APP_FIREBASE_API_KEY'] ?? 'AIzaSyCkExUnLV-oGvRp56PVnTJMPWPplLFIuXs',
    authDomain: appEnv['NG_APP_FIREBASE_AUTH_DOMAIN'] ?? 'work-nest-3936a.firebaseapp.com',
    projectId: appEnv['NG_APP_FIREBASE_PROJECT_ID'] ?? 'work-nest-3936a',
    storageBucket: appEnv['NG_APP_FIREBASE_STORAGE_BUCKET'] ?? 'work-nest-3936a.firebasestorage.app',
    messagingSenderId: appEnv['NG_APP_FIREBASE_MESSAGING_SENDER_ID'] ?? '722479405081',
    appId: appEnv['NG_APP_FIREBASE_APP_ID'] ?? '1:722479405081:web:48935f617c573c030e7288',
  },
};

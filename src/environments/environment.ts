type AppEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

const appEnv = ((import.meta as AppEnv).env ?? {}) as Record<string, string | undefined>;
const firebaseDefaults = {
  apiKey: 'AIzaSyCkExUnLV-oGvRp56PVnTJMPWPplLFIuXs',
  authDomain: 'work-nest-3936a.firebaseapp.com',
  projectId: 'work-nest-3936a',
  storageBucket: 'work-nest-3936a.firebasestorage.app',
  messagingSenderId: '722479405081',
  appId: '1:722479405081:web:48935f617c573c030e7288',
};

export const environment = {
  production: appEnv['NG_APP_PRODUCTION'] === 'true',
  apiUrl: appEnv['NG_APP_API_URL'] ?? '/api',
  firebase: {
    apiKey: appEnv['NG_APP_FIREBASE_API_KEY'] ?? firebaseDefaults.apiKey,
    authDomain: appEnv['NG_APP_FIREBASE_AUTH_DOMAIN'] ?? firebaseDefaults.authDomain,
    projectId: appEnv['NG_APP_FIREBASE_PROJECT_ID'] ?? firebaseDefaults.projectId,
    storageBucket: appEnv['NG_APP_FIREBASE_STORAGE_BUCKET'] ?? firebaseDefaults.storageBucket,
    messagingSenderId: appEnv['NG_APP_FIREBASE_MESSAGING_SENDER_ID'] ?? firebaseDefaults.messagingSenderId,
    appId: appEnv['NG_APP_FIREBASE_APP_ID'] ?? firebaseDefaults.appId,
  },
};

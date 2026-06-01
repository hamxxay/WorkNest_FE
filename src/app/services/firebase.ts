import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  GithubAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  Auth,
} from 'firebase/auth';
import { environment } from '../../environments/environment';

const firebaseConfig = environment.firebase;

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

// Only initialise Firebase when all required config values are present.
// When running without .env (e.g. CI preview), the app still loads —
// auth features are simply disabled and isFirebaseConfigured = false.
let firebaseApp: FirebaseApp | null = null;
let _firebaseAuth: Auth | null = null;

if (isFirebaseConfigured) {
  firebaseApp = initializeApp(firebaseConfig);
  _firebaseAuth = getAuth(firebaseApp);
  void setPersistence(_firebaseAuth, browserLocalPersistence);
}

export const firebaseAuth = _firebaseAuth as Auth;

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const githubProvider = new GithubAuthProvider();
githubProvider.setCustomParameters({ allow_signup: 'true' });

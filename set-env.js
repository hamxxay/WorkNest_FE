const fs = require('fs');
const path = require('path');

// Load .env file if it exists (local dev), otherwise rely on process.env (Vercel/CI)
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...rest] = line.trim().split('=');
      if (key && !key.startsWith('#') && !(key in process.env)) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    });
}

const required = [
  'API_URL', 'FROM_EMAIL', 'WHATSAPP_NUMBER',
  'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'
];

const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`ERROR: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const content = `// AUTO-GENERATED — do not edit manually. Edit .env instead.
export const environment = {
  production: ${process.env.NODE_ENV === 'production'},
  apiUrl: '${process.env.API_URL}',
  fromEmail: '${process.env.FROM_EMAIL}',
  whatsappNumber: '${process.env.WHATSAPP_NUMBER}',
  payfast: {
    sandbox: ${process.env.PAYFAST_SANDBOX !== 'false'},
  },
  firebase: {
    apiKey:            '${process.env.FIREBASE_API_KEY}',
    authDomain:        '${process.env.FIREBASE_AUTH_DOMAIN}',
    projectId:         '${process.env.FIREBASE_PROJECT_ID}',
    storageBucket:     '${process.env.FIREBASE_STORAGE_BUCKET}',
    messagingSenderId: '${process.env.FIREBASE_MESSAGING_SENDER_ID}',
    appId:             '${process.env.FIREBASE_APP_ID}',
  },
};
`;

const outPath = path.resolve(__dirname, 'src/environments/environment.ts');
fs.writeFileSync(outPath, content, 'utf8');
console.log('environment.ts generated successfully');

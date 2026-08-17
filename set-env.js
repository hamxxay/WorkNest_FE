const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env');
const outPath = path.resolve(__dirname, 'src/environments/environment.ts');

if (!fs.existsSync(envPath)) {
  console.error('ERROR: .env file not found. Copy .env.example to .env and fill in values.');
  process.exit(1);
}

const vars = {};
fs.readFileSync(envPath, 'utf8')
  .split('\n')
  .forEach(line => {
    const [key, ...rest] = line.trim().split('=');
    if (key && !key.startsWith('#')) vars[key.trim()] = rest.join('=').trim();
  });

const content = `// AUTO-GENERATED — do not edit manually. Edit .env instead.
export const environment = {
  production: false,
  apiUrl: '${vars.API_URL || ''}',
  fromEmail: '${vars.FROM_EMAIL || ''}',
  whatsappNumber: '${vars.WHATSAPP_NUMBER || ''}',
  payfast: {
    sandbox: ${vars.PAYFAST_SANDBOX === 'true'},
  },
  firebase: {
    apiKey:            '${vars.FIREBASE_API_KEY || ''}',
    authDomain:        '${vars.FIREBASE_AUTH_DOMAIN || ''}',
    projectId:         '${vars.FIREBASE_PROJECT_ID || ''}',
    storageBucket:     '${vars.FIREBASE_STORAGE_BUCKET || ''}',
    messagingSenderId: '${vars.FIREBASE_MESSAGING_SENDER_ID || ''}',
    appId:             '${vars.FIREBASE_APP_ID || ''}',
  },
};
`;

fs.writeFileSync(outPath, content, 'utf8');
console.log('environment.ts generated from .env');

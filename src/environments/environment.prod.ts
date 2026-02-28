type AppEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

const appEnv = ((import.meta as AppEnv).env ?? {}) as Record<string, string | undefined>;

export const environment = {
  production: appEnv['NG_APP_PRODUCTION']
    ? appEnv['NG_APP_PRODUCTION'] === 'true'
    : true,
  apiUrl: appEnv['NG_APP_API_URL'] ?? '/api',
};

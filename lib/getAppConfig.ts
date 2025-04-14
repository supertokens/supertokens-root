import { readFileSync } from 'fs';

export const getAppConfig = () => {
  const appConfigPath = process.argv[2];
  if (!appConfigPath) {
    console.error('App config path is required');
    process.exit(1);
  }

  const appConfig = JSON.parse(readFileSync(appConfigPath, 'utf8'));

  return appConfig;
};

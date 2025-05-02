import { readFileSync } from 'fs';

export const getAppConfig = (path: string) => {
  const appConfig = JSON.parse(readFileSync(path, 'utf8'));

  return appConfig;
};

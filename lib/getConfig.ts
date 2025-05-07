import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { AppConfig, validateAppConfig } from './validateAppConfig';
import { BASE_APP_DIR, BASE_TMP_DIR } from './constants';
import path from 'path';

export const getConfig = (configPath: string, force?: boolean) => {
  const rawOriginalConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  const appDir = path.join(BASE_APP_DIR, rawOriginalConfig.name);

  if (force) {
    rmSync(appDir, { recursive: true, force: true });
    mkdirSync(appDir, { recursive: true });
  } else if (!existsSync(appDir)) {
    mkdirSync(appDir, { recursive: true });
  }

  const cachedConfigPath = path.join(appDir, 'app.json');

  if (!rawOriginalConfig.name) {
    throw new Error('App name is required');
  }

  if (existsSync(cachedConfigPath)) {
    return { ...(JSON.parse(readFileSync(cachedConfigPath, 'utf8')) as AppConfig), appDir };
  } else {
    const originalConfig = validateAppConfig(rawOriginalConfig);

    writeFileSync(cachedConfigPath, JSON.stringify(originalConfig, null, 2));

    return { ...originalConfig, appDir };
  }
};

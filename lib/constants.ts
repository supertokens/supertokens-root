import path from 'path';

export const BASE_DIR = path.join(process.cwd(), '.');
export const BASE_APP_DIR = path.join(BASE_DIR, './.tmp/apps');
export const BASE_PACKAGE_DIR = path.join(BASE_DIR, './packages');

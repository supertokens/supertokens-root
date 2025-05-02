import path from 'path';

export const BASE_DIR = path.join(process.cwd(), '.');
export const BASE_TMP_DIR = path.join(BASE_DIR, './.tmp');
export const BASE_APP_DIR = path.join(BASE_TMP_DIR, 'apps');
export const BASE_PACKAGE_DIR = path.join(BASE_DIR, './packages');

export const DEFAULT_PYTHON_BACKEND_FRAMEWORK = 'flask';
export const DEFAULT_NODE_BACKEND_FRAMEWORK = 'express';
export const DEFAULT_FRONTEND_FRAMEWORK = 'react';

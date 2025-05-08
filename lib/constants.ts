import path from 'path';

export const BASE_DIR = path.join(process.cwd(), '.');
export const BASE_PACKAGES_DIR = path.join(BASE_DIR, 'packages');
export const BASE_TMP_DIR = path.join(BASE_DIR, './.tmp');
export const BASE_APP_DIR = path.join(BASE_TMP_DIR, 'apps');

export enum ItemTarget {
  Flask = 'flask',
  FastAPI = 'fastapi',
  Django = 'django',

  Express = 'express',
  Koa = 'koa',
  Nest = 'nest',

  React = 'react',
  Solid = 'solid',
  Vue = 'vue',
  Angular = 'angular',

  SupertokensCore = 'supertokens-core',
  SupertokensPython = 'supertokens-python',
  SupertokensWebJs = 'supertokens-web-js',
  SupertokensNode = 'supertokens-node',
  SupertokensAuthReact = 'supertokens-auth-react',
  SupertokensCreateApp = 'create-supertokens-app',
  Docs = 'docs',
  Dashboard = 'dashboard',
}

export const FRONTEND_TARGETS = [ItemTarget.React, ItemTarget.Solid, ItemTarget.Vue, ItemTarget.Angular] as const;
export const BACKEND_TARGETS = [
  ItemTarget.Flask,
  ItemTarget.FastAPI,
  ItemTarget.Django,
  ItemTarget.Express,
  ItemTarget.Koa,
  ItemTarget.Nest,
] as const;

export const PYTHON_RUNTIME_TARGETS = [ItemTarget.Flask, ItemTarget.FastAPI, ItemTarget.Django] as const;
export const NODE_RUNTIME_TARGETS = [...FRONTEND_TARGETS, ItemTarget.Express, ItemTarget.Koa, ItemTarget.Nest] as const;

export const LIB_TARGETS = [
  ItemTarget.SupertokensPython,
  ItemTarget.SupertokensWebJs,
  ItemTarget.SupertokensNode,
  ItemTarget.SupertokensAuthReact,
  ItemTarget.SupertokensCreateApp,
] as const;
export const MODULE_TARGETS = [ItemTarget.SupertokensCore, ItemTarget.Docs, ItemTarget.Dashboard] as const;
export const SERVICE_TARGETS = [...BACKEND_TARGETS, ...FRONTEND_TARGETS] as const;

export const DEFAULT_BACKEND_TARGET = ItemTarget.Express;
export const DEFAULT_FRONTEND_TARGET = ItemTarget.React;

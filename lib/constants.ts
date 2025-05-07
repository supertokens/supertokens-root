import path from 'path';

export const BASE_DIR = path.join(process.cwd(), '.');
export const BASE_PACKAGES_DIR = path.join(BASE_DIR, 'packages');
export const BASE_TMP_DIR = path.join(BASE_DIR, './.tmp');
export const BASE_APP_DIR = path.join(BASE_TMP_DIR, 'apps');

export enum ServiceTarget {
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

export const FRONTEND_TARGETS = [
  ServiceTarget.React,
  ServiceTarget.Solid,
  ServiceTarget.Vue,
  ServiceTarget.Angular,
] as const;
export const BACKEND_TARGETS = [
  ServiceTarget.Flask,
  ServiceTarget.FastAPI,
  ServiceTarget.Django,
  ServiceTarget.Express,
  ServiceTarget.Koa,
  ServiceTarget.Nest,
] as const;

export const PYTHON_RUNTIME_TARGETS = [ServiceTarget.Flask, ServiceTarget.FastAPI, ServiceTarget.Django] as const;
export const NODE_RUNTIME_TARGETS = [
  ...FRONTEND_TARGETS,
  ServiceTarget.Express,
  ServiceTarget.Koa,
  ServiceTarget.Nest,
] as const;

export const LIB_TARGETS = [
  ServiceTarget.SupertokensPython,
  ServiceTarget.SupertokensWebJs,
  ServiceTarget.SupertokensNode,
  ServiceTarget.SupertokensAuthReact,
  ServiceTarget.SupertokensCreateApp,
] as const;
export const MODULE_TARGETS = [ServiceTarget.SupertokensCore, ServiceTarget.Docs, ServiceTarget.Dashboard] as const;
export const SERVICE_TARGETS = [...BACKEND_TARGETS, ...FRONTEND_TARGETS] as const;

export const DEFAULT_BACKEND_TARGET = ServiceTarget.Express;
export const DEFAULT_FRONTEND_TARGET = ServiceTarget.React;

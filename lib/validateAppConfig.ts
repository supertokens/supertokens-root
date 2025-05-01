import fs from 'fs';
import { z } from 'zod';

const runtimeVersions = {
  java: ['15.0.1'],
  node: ['20', '21', '22'],
  python: ['3.8', '3.9', '3.10', '3.11', '3.12'],
  golang: ['1.18', '1.19', '1.20', '1.21', '1.22', '1.23', '1.24'],
};

const runtimeModules = {
  java: ['core'],
  node: ['node', 'auth-react', 'dashboard', 'docs', 'web-js'],
  python: ['python'],
  golang: ['golang'],
};

const portInterval = [3000, 6000];

const CoreServiceSchema = z.object({
  module: z.literal('core'),
  config: z.object({}).optional(),
});

const NodeServiceSchema = z.object({
  module: z.literal('node'),
  config: z
    .object({
      coreURI: z.string().optional(),
      appId: z.string().optional(),
      licenseKey: z.string().optional(),
      dashboardHost: z.string().optional(),
      dashboardPort: z.number().optional(),
      clientHost: z.string().optional(),
      clientPort: z.number().optional(),
      framework: z
        .enum([
          'express',
          'koa',
          'nest',
          // fullstack frameworks
          'astro',
          'nuxt',
          'sveltekit',
          'astro-react',
          'next',
          'next-multitenancy',
          'next-app-dir-multitenancy',
          'remix',
          'nuxt',
        ])
        .optional(),
    })
    .optional(),
});

const PythonServiceSchema = z.object({
  module: z.literal('python'),
  config: z
    .object({
      coreURI: z.string().optional(),
      appId: z.string().optional(),
      licenseKey: z.string().optional(),
      dashboardHost: z.string().optional(),
      dashboardPort: z.number().optional(),
      clientHost: z.string().optional(),
      clientPort: z.number().optional(),
      framework: z.enum(['flask', 'django', 'fastapi']).optional(),
    })
    .optional(),
});

const AuthReactServiceSchema = z.object({
  module: z.literal('auth-react'),
  config: z
    .object({
      apiHost: z.string().optional(),
      apiPort: z.number().optional(),
      framework: z
        .enum([
          // fullstack frameworks
          'astro-react',
          'next',
          'next-multitenancy',
          'next-app-dir-multitenancy',
          'remix',
          'nuxt',
        ])
        .optional(),
    })
    .optional(),
});

const WebJSServiceSchema = z.object({
  module: z.literal('web-js'),
  config: z
    .object({
      apiHost: z.string().optional(),
      apiPort: z.number().optional(),
      framework: z.enum([
        // 'plain',
        'solid',
        'vue',
        'angular',
        // fullstack frameworks
        'astro',
        'nuxt',
        'sveltekit',
      ]),
    })
    .optional(),
});

const DocsServiceSchema = z.object({
  module: z.literal('docs'),
  config: z.object({}).optional(),
});

const DashboardServiceSchema = z.object({
  module: z.literal('dashboard'),
  config: z.object({}).optional(),
});

export const AppConfigSchema = z
  .object({
    name: z.string(),
    strategy: z.enum(['local', 'docker-compose']),
    template: z
      .object({
        firstFactors: z
          .array(z.enum(['emailpassword', 'thirdparty', 'otp-phone', 'otp-email', 'link-phone', 'link-email']))
          .min(1),
        secondFactors: z.array(z.enum(['otp-phone', 'otp-email', 'link-phone', 'link-email', 'totp'])).optional(),
        providers: z.array(z.enum(['google', 'github', 'apple', 'twitter'])).optional(),
      })
      .optional()
      .refine(
        (template) => {
          if (!template) return true;

          if (
            template.firstFactors.includes('thirdparty') &&
            (!template.providers || template.providers.length === 0)
          ) {
            return false;
          }

          return true;
        },
        {
          message: 'thirdparty first factors require providers being set',
        },
      ),

    services: z
      .array(
        z
          .discriminatedUnion('module', [
            CoreServiceSchema,
            NodeServiceSchema,
            AuthReactServiceSchema,
            DocsServiceSchema,
            DashboardServiceSchema,
            WebJSServiceSchema,
            PythonServiceSchema,
          ])
          .and(
            z.object({
              id: z.string(),
              runtime: z.enum(['java', 'node', 'python', 'golang']),
              runtimeVersion: z.string(),
              srcPath: z.string().optional(),
              servicePath: z.string().optional(),
              host: z.string().optional().default('localhost'),
              port: z.number().default(() => {
                return Math.floor(Math.random() * (portInterval[1] - portInterval[0])) + portInterval[0];
              }),
              branch: z.string().optional(),
              scripts: z.record(z.string(), z.string()).optional(),
            }),
          )
          .refine(
            (service) => {
              if (service.branch && service.srcPath) {
                return false;
              }

              return true;
            },
            {
              message: 'branch and srcPath cannot both be set',
            },
          )
          .refine(
            (service) => {
              if (!service.branch && !service.srcPath) {
                return false;
              }

              return true;
            },
            {
              message: 'branch or srcPath is required',
            },
          )
          .refine(
            (service) => {
              const allowedRuntimeVersions = runtimeVersions[service.runtime];
              const isVersionAllowed = allowedRuntimeVersions.reduce((acc, version) => {
                if (service.runtimeVersion.startsWith(version)) {
                  return acc || true;
                }

                return acc;
              }, false);

              return isVersionAllowed;
            },
            (service) => {
              const allowedRuntimeVersions = runtimeVersions[service.runtime];
              return {
                message: `Runtime version not supported. Allowed versions: ${allowedRuntimeVersions.join(', ')}`,
              };
            },
          )
          .refine(
            (service) => {
              const allowedRuntimeModules = runtimeModules[service.runtime];
              return allowedRuntimeModules.includes(service.module);
            },
            (service) => {
              const allowedRuntimeModules = runtimeModules[service.runtime];
              return {
                message: `Runtime module not supported. Allowed modules: ${allowedRuntimeModules.join(', ')}`,
              };
            },
          )
          .refine(
            (service) => {
              if (service.srcPath) {
                return fs.existsSync(service.srcPath);
              }
              return true;
            },
            { message: 'srcPath does not exist' },
          ),
      )
      .min(1)
      .refine(
        (services) => {
          const serviceIds = services.map((service) => service.id);
          return new Set(serviceIds).size === serviceIds.length;
        },
        {
          message: 'Service IDs must be unique',
        },
      )
      .refine(
        (services) => {
          const authReactServicesWithFullstackFrameworks = services.filter(
            (service) => service.module === 'auth-react' && service.config?.framework,
          );
          const webJSServicesWithFullstackFrameworks = services.filter(
            (service) => service.module === 'web-js' && service.config?.framework,
          );
          const nodeServicesWithFullstackFrameworks = services.filter(
            (service) =>
              service.module === 'node' &&
              service.config?.framework &&
              [
                'astro',
                'nuxt',
                'sveltekit',
                'astro-react',
                'next',
                'next-multitenancy',
                'next-app-dir-multitenancy',
                'remix',
                'nuxt',
              ].includes(service.config?.framework),
          );

          if (authReactServicesWithFullstackFrameworks.length > 1) {
            return false;
          }
          if (webJSServicesWithFullstackFrameworks.length > 1) {
            return false;
          }
          if (nodeServicesWithFullstackFrameworks.length > 1) {
            return false;
          }

          return true;
        },
        {
          message:
            'Multiple services with fullstack frameworks found. Only one service (auth-react, web-js, node) with a fullstack framework is allowed.',
        },
      )
      .refine(
        (services) => {
          const authReactServicesWithFullstackFrameworks = services.find(
            (service) => service.module === 'auth-react' && service.config?.framework,
          );
          const webJSServicesWithFullstackFrameworks = services.find(
            (service) => service.module === 'web-js' && service.config?.framework,
          );
          const nodeServicesWithFullstackFrameworks = services.find(
            (service) =>
              service.module === 'node' &&
              service.config?.framework &&
              [
                'astro',
                'nuxt',
                'sveltekit',
                'astro-react',
                'next',
                'next-multitenancy',
                'next-app-dir-multitenancy',
                'remix',
                'nuxt',
              ].includes(service.config?.framework),
          );

          if (webJSServicesWithFullstackFrameworks && authReactServicesWithFullstackFrameworks) {
            return false;
          }

          if (
            !(webJSServicesWithFullstackFrameworks || authReactServicesWithFullstackFrameworks) &&
            !nodeServicesWithFullstackFrameworks
          ) {
            return false;
          }

          return true;
        },
        {
          message:
            'At least one node service with a fullstack framework is required and at least one auth-react or web-js service with a fullstack framework is required.',
        },
      ),
  })
  .transform((appConfig) => {
    const coreServices = appConfig.services.filter((service) => service.module === 'core');
    const backendServices = appConfig.services.filter(
      (service) => service.module === 'node' || service.module === 'python',
    );
    const frontendServices = appConfig.services.filter(
      (service) => service.module === 'auth-react' || service.module === 'web-js',
    );
    const docsServices = appConfig.services.filter((service) => service.module === 'docs');
    const dashboardServices = appConfig.services.filter((service) => service.module === 'dashboard');

    let baseSdkServiceConfig = {};
    if (coreServices.length === 1) {
      baseSdkServiceConfig = {
        // assume is localhost
        coreURI: `http://${coreServices[0].host}:${coreServices[0].port}`,
      };
    } else if (coreServices.length > 1) {
      console.warn('Multiple core services found, you will need to set the coreURI manually for the SDK services');
    }

    // set the dashboard host and port for the SDK services
    if (dashboardServices.length === 1) {
      baseSdkServiceConfig = {
        ...baseSdkServiceConfig,
        // assume is localhost
        dashboardHost: dashboardServices[0].host,
        dashboardPort: dashboardServices[0].port,
      };
    } else if (dashboardServices.length > 1) {
      console.warn(
        'Multiple dashboard services found, you will need to set the dashboardHost and dashboardPort manually for the SDK services',
      );
    }

    if (frontendServices.length === 1) {
      baseSdkServiceConfig = {
        ...baseSdkServiceConfig,
        clientHost: frontendServices[0].host,
        clientPort: frontendServices[0].port,
      };
    } else if (frontendServices.length > 1) {
      console.warn(
        'Multiple auth-react or web-js services found, you will need to set the clientHost and clientPort manually for the SDK services',
      );
    }

    let baseClientServiceConfig = {};
    if (backendServices.length === 1) {
      baseClientServiceConfig = {
        // assume is localhost
        apiHost: backendServices[0].host,
        apiPort: backendServices[0].port,
      };
    } else if (backendServices.length > 1) {
      console.warn(
        'Multiple node or python services found, you will need to set the apiHost and apiPort manually for the client services',
      );
    }

    // mutations are bad, but it would be complicated to do this without mutating the original appConfig
    for (let index = 0; index < appConfig.services.length; index += 1) {
      if (appConfig.services[index].module === 'node' || appConfig.services[index].module === 'python') {
        appConfig.services[index].config = {
          ...baseSdkServiceConfig,
          ...appConfig.services[index].config,
        };
      }

      if (appConfig.services[index].module === 'auth-react' || appConfig.services[index].module === 'web-js') {
        appConfig.services[index].config = {
          ...baseClientServiceConfig,
          ...appConfig.services[index].config,
        };
      }
    }

    return appConfig;
  })
  .refine(
    (appConfig) => {
      if (!appConfig.template && appConfig.services.some((service) => !service.servicePath)) {
        return false;
      }
      return true;
    },
    {
      message: 'servicePath is required when not using a template',
    },
  )
  .refine(
    (appConfig) => {
      if (appConfig.strategy === 'local' && appConfig.services.some((service) => !service.srcPath)) {
        return false;
      }
      return true;
    },
    {
      message: 'srcPath is required when using the "docker-compose" strategy',
    },
  );

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const validateAppConfig = (appConfig: AppConfig) => {
  const result = AppConfigSchema.safeParse(appConfig);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      return `${issue.path.join('.')}: ${issue.message}`;
    });

    throw new Error(`Invalid app config\n${messages.join('\n')}`);
  }

  return result.data;
};

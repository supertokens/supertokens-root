import fs, { readSync } from 'fs';
import { z } from 'zod';
import { getModules } from './getModules';
import { BACKEND_TARGETS, FRONTEND_TARGETS, LIB_TARGETS, MODULE_TARGETS, ServiceTarget } from './constants';

const allowedModules = getModules();

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

export const AppConfigSchema = z
  .object({
    name: z.string(),
    strategy: z
      .enum(['local', 'docker'])
      .describe(
        'Defines how the app will be run. local - will run the app locally. docker - will run the app using docker compose.',
      ),
    template: z
      .object({
        firstFactors: z
          .array(z.enum(['emailpassword', 'thirdparty', 'otp-phone', 'otp-email', 'link-phone', 'link-email']))
          .min(1),
        secondFactors: z.array(z.enum(['otp-phone', 'otp-email', 'link-phone', 'link-email', 'totp'])).optional(),
        providers: z
          .array(z.enum(['google', 'github', 'apple', 'twitter']))
          .optional()
          .describe(
            'Defines the providers that will be used for the first factors. If the first factor is not thirdparty, this will be ignored, otherwise it is mandatory to set the providers.',
          ),
      })
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
      )
      .describe(
        'Defines the template for how the SDKs will be configured in the apps. It matches the inputs from the create-supertokens-app command.',
      ),

    services: z
      .array(
        z
          .object({
            id: z.string(),
            libs: z.array(z.enum(allowedModules.map((module) => module.name) as [string, ...string[]])).optional(),
            runtime: z.enum(['java', 'node', 'python']),
            runtimeVersion: z
              .string()
              .describe('The version of the runtime to use for the service. It will be automatically set.'),
            scripts: z
              .record(z.string(), z.string())
              .optional()
              .describe(
                'The scripts that the service will have available to run. The key is the name of the script and the value is the command to run the script. A start and a build script should be provided, though they are not mandatory.',
              ),
          })
          .and(
            z.union([
              z.object({
                target: z.enum(LIB_TARGETS),
              }),
              z.object({
                target: z.enum(MODULE_TARGETS),
                host: z
                  .string()
                  .default('localhost')
                  .describe('The host to run the service on. It will be automatically set if the service allows it.'),
                port: z
                  .number()
                  .default(() => {
                    return Math.floor(Math.random() * (portInterval[1] - portInterval[0])) + portInterval[0];
                  })
                  .describe('The port to run the service on. It will be automatically set if not provided.'),
              }),
              z.object({
                target: z.enum(BACKEND_TARGETS),
                host: z
                  .string()
                  .default('localhost')
                  .describe('The host to run the service on. It will be automatically set if the service allows it.'),
                port: z
                  .number()
                  .default(() => {
                    return Math.floor(Math.random() * (portInterval[1] - portInterval[0])) + portInterval[0];
                  })
                  .describe('The port to run the service on. It will be automatically set if not provided.'),
                config: z
                  .object({
                    coreURI: z.string().optional().describe('The URI of the core service.'),
                    dashboardHost: z
                      .string()
                      .optional()
                      .describe(
                        'The host that the dashboard will be available on. If not set, this will be automatically resolved using the dashboard service (if defined and only one is present).',
                      ),
                    dashboardPort: z
                      .number()
                      .optional()
                      .describe(
                        'The port that the dashboard will be available on. If not set, this will be automatically resolved using the dashboard service (if defined and only one is present).',
                      ),
                    clientHost: z
                      .string()
                      .optional()
                      .describe(
                        'The host that the client will be available on. If not set, this will be automatically resolved using the auth-react or web-js service (if defined and only one of them is present).',
                      ),
                    clientPort: z
                      .number()
                      .optional()
                      .describe(
                        'The port that the client will be available on. If not set, this will be automatically resolved using the auth-react or web-js service (if defined and only one of them is present).',
                      ),
                  })
                  .optional(),
              }),
              z.object({
                target: z.enum(FRONTEND_TARGETS),
                host: z
                  .string()
                  .default('localhost')
                  .describe('The host to run the service on. It will be automatically set if the service allows it.'),
                port: z
                  .number()
                  .default(() => {
                    return Math.floor(Math.random() * (portInterval[1] - portInterval[0])) + portInterval[0];
                  })
                  .describe('The port to run the service on. It will be automatically set if not provided.'),
                config: z
                  .object({
                    apiHost: z
                      .string()
                      .optional()
                      .describe(
                        'The host that the API will be available on. If not set, this will be automatically resolved using the node or python service (if defined and only one is present).',
                      ),
                    apiPort: z
                      .number()
                      .optional()
                      .describe(
                        'The port that the API will be available on. If not set, this will be automatically resolved using the node or python service (if defined and only one is present).',
                      ),
                  })
                  .optional(),
              }),
            ]),
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
      ),
  })
  .transform((appConfig) => {
    const coreServices = appConfig.services.filter((service) => service.target === ServiceTarget.SupertokensCore);

    const backendServices = appConfig.services.filter((service) =>
      (BACKEND_TARGETS as unknown as string[]).includes(service.target),
    );
    const frontendServices = appConfig.services.filter((service) =>
      (FRONTEND_TARGETS as unknown as string[]).includes(service.target),
    );
    const docsServices = appConfig.services.filter((service) => service.target === ServiceTarget.Docs);
    const dashboardServices = appConfig.services.filter((service) => service.target === ServiceTarget.Dashboard);

    let baseSdkServiceConfig = {};
    if (coreServices.length === 1) {
      baseSdkServiceConfig = {
        // assume is localhost
        // @ts-ignore
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
        // @ts-ignore
        dashboardHost: dashboardServices[0].host,
        // @ts-ignore
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
        // @ts-ignore
        clientHost: frontendServices[0].host,
        // @ts-ignore
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
        // @ts-ignore
        apiHost: backendServices[0].host,
        // @ts-ignore
        apiPort: backendServices[0].port,
      };
    } else if (backendServices.length > 1) {
      console.warn(
        'Multiple node or python services found, you will need to set the apiHost and apiPort manually for the client services',
      );
    }

    // mutations are bad, but it would be complicated to do this without mutating the original appConfig
    for (let index = 0; index < appConfig.services.length; index += 1) {
      if (BACKEND_TARGETS.includes(appConfig.services[index].target as any)) {
        (appConfig.services[index] as any).config = {
          ...baseSdkServiceConfig,
          ...(appConfig.services[index] as any).config,
        };
      }

      if (FRONTEND_TARGETS.includes(appConfig.services[index].target as any)) {
        (appConfig.services[index] as any).config = {
          ...baseClientServiceConfig,
          ...(appConfig.services[index] as any).config,
        };
      }
    }

    return appConfig;
  });

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

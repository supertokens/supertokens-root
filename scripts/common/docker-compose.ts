#!/usr/bin/env ts-node

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AppConfig } from '../../lib/validateAppConfig';

const execAsync = promisify(exec);

interface DockerServiceConfig {
  build: {
    context: string;
    dockerfile: string;
  };
  ports: string[];
  environment: Record<string, string>;
}

export async function generateDockerCompose(appConfig: AppConfig, appDir: string) {
  const dockerComposePath = join(appDir, 'docker-compose.yml');

  // Generate docker-compose.yml content
  const services: Record<string, DockerServiceConfig> = {};

  for (const service of appConfig.services) {
    const serviceConfig: DockerServiceConfig = {
      build: {
        context: '.',
        dockerfile: `Dockerfile.${service.id}`,
      },
      ports: [`${service.port}:${service.port}`],
      environment: {} as Record<string, string>,
    };

    // Add environment variables based on service type
    switch (service.module) {
      case 'core':
        serviceConfig.environment = {
          ...serviceConfig.environment,
          PORT: service.port.toString(),
        };
        break;
      case 'node':
        serviceConfig.environment = {
          ...serviceConfig.environment,
          PORT: service.port.toString(),
          NODE_ENV: 'development',
        };
        if (service.config?.coreURI) {
          serviceConfig.environment.CORE_URI = service.config.coreURI;
        }
        if (service.config?.dashboardHost) {
          serviceConfig.environment.DASHBOARD_HOST = service.config.dashboardHost;
        }
        if (service.config?.dashboardPort) {
          serviceConfig.environment.DASHBOARD_PORT = service.config.dashboardPort.toString();
        }
        if (service.config?.clientHost) {
          serviceConfig.environment.CLIENT_HOST = service.config.clientHost;
        }
        if (service.config?.clientPort) {
          serviceConfig.environment.CLIENT_PORT = service.config.clientPort.toString();
        }
        break;
      case 'python':
        serviceConfig.environment = {
          ...serviceConfig.environment,
          PORT: service.port.toString(),
          PYTHON_VERSION: service.runtimeVersion,
        };
        if (service.config?.coreURI) {
          serviceConfig.environment.CORE_URI = service.config.coreURI;
        }
        if (service.config?.dashboardHost) {
          serviceConfig.environment.DASHBOARD_HOST = service.config.dashboardHost;
        }
        if (service.config?.dashboardPort) {
          serviceConfig.environment.DASHBOARD_PORT = service.config.dashboardPort.toString();
        }
        if (service.config?.clientHost) {
          serviceConfig.environment.CLIENT_HOST = service.config.clientHost;
        }
        if (service.config?.clientPort) {
          serviceConfig.environment.CLIENT_PORT = service.config.clientPort.toString();
        }
        break;
      case 'auth-react':
      case 'web-js':
        serviceConfig.environment = {
          ...serviceConfig.environment,
          PORT: service.port.toString(),
        };
        if (service.config?.apiHost) {
          serviceConfig.environment.API_HOST = service.config.apiHost;
        }
        if (service.config?.apiPort) {
          serviceConfig.environment.API_PORT = service.config.apiPort.toString();
        }
        break;
    }

    services[service.id] = serviceConfig;
  }

  const dockerComposeContent = `version: '3'
services:
${Object.entries(services)
  .map(([name, config]) => {
    const configStr = Object.entries(config)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `  ${key}:\n${Object.entries(value)
            .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
            .join('\n')}`;
        }
        return `  ${key}: ${JSON.stringify(value)}`;
      })
      .join('\n');
    return `  ${name}:\n${configStr}`;
  })
  .join('\n')}
`;

  writeFileSync(dockerComposePath, dockerComposeContent);

  // Generate Dockerfiles for each service
  for (const service of appConfig.services) {
    const dockerfilePath = join(appDir, `Dockerfile.${service.id}`);
    let dockerfileContent = '';

    switch (service.runtime) {
      case 'node':
        dockerfileContent = `FROM node:${service.runtimeVersion}-alpine
WORKDIR /app
COPY ${service.srcPath} .
RUN npm install
EXPOSE ${service.port}
CMD ["npm", "start"]`;
        break;
      case 'python':
        dockerfileContent = `FROM python:${service.runtimeVersion}-slim
WORKDIR /app
COPY ${service.srcPath} .
RUN pip install -r requirements.txt
EXPOSE ${service.port}
CMD ["python", "app.py"]`;
        break;
      case 'java':
        dockerfileContent = `FROM openjdk:${service.runtimeVersion}-jdk
WORKDIR /app
COPY ${service.srcPath} .
EXPOSE ${service.port}
CMD ["java", "-jar", "app.jar"]`;
        break;
    }

    writeFileSync(dockerfilePath, dockerfileContent);
  }
}

export async function startDockerCompose(appDir: string) {
  try {
    // Build and start containers
    await execAsync('docker-compose up --build -d', { cwd: appDir });
    console.log('Docker containers started successfully');
  } catch (error) {
    console.error('Failed to start docker containers:', error);
    throw error;
  }
}

export async function stopDockerCompose(appDir: string) {
  try {
    await execAsync('docker-compose down', { cwd: appDir });
    console.log('Docker containers stopped successfully');
  } catch (error) {
    console.error('Failed to stop docker containers:', error);
    throw error;
  }
}

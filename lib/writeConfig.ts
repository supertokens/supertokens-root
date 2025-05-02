import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { AppConfig } from './validateAppConfig';

export const writePythonSDKServiceConfig = (
  service: Extract<AppConfig['services'][number] & { servicePath: string }, { module: 'python' }>,
) => {
  if (service.module !== 'python') {
    throw new Error('Service is not a supertokens-python service');
  }

  if (!service.servicePath) {
    throw new Error('Service path is not set');
  }

  console.log(`Writing config for ${service.id}`);

  let config = readFileSync(path.join(service.servicePath, 'config.py'), 'utf8');
  if (!config) {
    throw new Error(`${path.join(service.servicePath, 'config.py')} file not found`);
  }

  config = config.replace('api_port = str(3001)', `api_port = str(${service.port})`);
  config = config.replace('api_url = f"http://localhost:{api_port}"', `api_url = f"http://${service.host}:{api_port}"`);
  config = config.replace('app_name="SuperTokens Demo App"', `app_name = "${service.id}"`);

  if (service.config?.coreURI) {
    config = config.replace(
      'connection_uri="https://try.supertokens.com"',
      `connection_uri="${service.config?.coreURI}"`,
    );
  } else {
    console.warn(`${service.id} coreURI is not set, using the service config`);
  }

  if (service.config?.clientPort) {
    config = config.replace('website_port = str(3000)', `website_port = str(${service.config?.clientPort})`);
  } else {
    console.warn(`${service.id} clientPort is not set, using the service config`);
  }

  if (service.config?.clientHost) {
    config = config.replace(
      'website_url = f"http://localhost:{website_port}"',
      `website_url = f"http://${service.config?.clientHost}:{website_port}"`,
    );
  } else {
    console.warn(`${service.id} clientHost is not set, using the service config`);
  }

  writeFileSync(path.join(service.servicePath, 'config.py'), config);
};

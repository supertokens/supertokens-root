# SuperTokens Development Environment

This repository provides a unified development environment for SuperTokens repositories. It brings all supported repositories together in one place and allows running them or running apps using them (for SDK repos), making development significantly easier.

## Supported Repositories

- `supertokens-core`
- `supertokens-node`
- `supertokens-auth-react`
- `supertokens-web-js`
- `supertokens-python`
- `create-supertokens-app`
- `dashboard`
- `docs`

> Note: Support for additional repositories will be added progressively.

## Quick Start

1. Add desired modules to `modules.txt`:
   ```
   module-name,branch-name,username(optional)
   ```
   Example:
   ```
   node,main
   auth-react,main
   core,main
   ```

2. Run `npm run load` to:
   - Set up core modules
   - Set up all other modules defined in `modules.txt`
   - Install dependencies for each module

3. Start services:
   ```bash
   npm run st -- ./app.json start
   ```

## Configuration

The `app.config.json` file defines your application setup:

### Basic Configuration
```json
{
  "name": "String",           // Name of your app
  "strategy": "local|docker", // Runtime strategy
  "template": {               // Optional SDK setup
    "firstFactors": ["emailpassword", "thirdparty", "otp-phone", "otp-email", "link-phone", "link-email"],
    "secondFactors": ["otp-phone", "otp-email", "link-phone", "link-email", "totp"],
    "providers": ["google", "github", "apple", "twitter"]
  },
  "services": []              // Service configurations
}
```

### Service Configuration

Each service requires:
- `id`: Unique identifier
- `module`: Service type ('core', 'node', 'python', 'auth-react', 'web-js', 'dashboard', 'docs')
- `runtime`: 'java', 'node', or 'python'
- `runtimeVersion`: Version string
- `srcPath`: Relative path to source files
- `port`: Port number (random 3000-6000 if unspecified)
- `scripts`: Optional script name to command mappings

#### Backend Services (Node/Python)
- `coreURI`: Core service URI
- `dashboardHost/Port`: Dashboard connection
- `clientHost/Port`: Client connection
- `framework`: Backend framework
  - Node: 'express', 'koa', 'nest'
  - Python: 'flask', 'django', 'fastapi'

#### Frontend Services (auth-react/web-js)
- `apiHost/Port`: Backend API connection
- `framework`: Frontend framework
  - auth-react: 'next', 'remix'
  - web-js: 'solid', 'vue', 'angular'

## Running Scripts

Use the `run.ts` script with:
```bash
./scripts/common/run.ts ./app.json <script-name> [options]
```

> **Note**: It is recommended that all runnable services define a `start` script in their configuration, as this is the most commonly used script for running services.
> 
Options:
- `--force`: Force service setup even if already configured

First-time script execution will:
- Set up all configured services
- Create example apps
- Link packages
- Handle initialization

> **Tip**: Use `npm start` as shorthand for `npm run st -- ./app.json start`

## Known Limitations

1. **Hot Reloading**: Not supported for front-end SDK due to package linking using `npm pack`
2. **Repository Support**: Only main repositories are currently supported
3. **Windows Support**: Not tested as Windows is not used for development

## Validation Rules

- Service IDs must be unique
- Third-party authentication requires provider configuration
- All required fields must be specified for each service
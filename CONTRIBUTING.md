# Contributing to SuperTokens

This document provides guidelines and instructions for contributing to the project.

## Project Structure

The project follows a modular structure with clear separation of concerns:

```
supertokens-root/
├── lib/                    # Code library
│   ├── validateAppConfig.ts  # Configuration validation
│   ├── setupSdkService.ts    # SDK service setup
│   ├── runService.ts         # Service execution
│   ├── createExampleApp.ts   # Example app creation
│   └── types.ts             # Type definitions
│
├── scripts/                # Scripts and utilities
│   ├── common/             # Common scripts
│   │   ├── run.ts          # Main execution script
│   │   └── loadModules.ts  # Module loading
│   └── core/              # Core-specific scripts
|                          # This was kept separate in order to preserve compatibility with previous folder structure
│
├── packages/              # Downloaded packages. This is where work will be done on the desired repositories. 
|                          # These are part of .gitignore and should not be commited.
└── .tmp/                # Temporary files and build artifacts
                        # Contains:
                        # - Version information
                        # - Build outputs for example apps
                        # - Temporary configuration files
                        # This directory is git-ignored and should not be committed
```

## Setting Up Your Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/supertokens-root.git
   cd supertokens-root
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Modules**
   Edit `modules.txt` to include the modules you want to work with:
   ```
   module-name,branch-name,github-username(optional)
   ```
   Example:
   ```
   core,main
   node,main
   auth-react,main
   ```

4. **Load Modules**
   ```bash
   npm run load
   ```

## Development Workflow

### 1. Creating Feature Branches

Each package should checkout using the same feature branch name, as this is not managed by this repository.

```bash
git checkout -b feat/your-feature-name
```

### 2. Making Changes

- Add tests for new functionality
- Update documentation as needed
- Ensure backward compatibility

### 3. Testing Your Changes

- Define app following the steps from the README.md file

- Define the `start` and `test` scripts

- Run the example app:
  ```bash
  npm start
  ```
- Run tests:
  ```bash
  npm test
  ```
- Test with different configurations
- Verify backward compatibility

### 4. Committing Changes

- Follow conventional commit messages
- Make sure to commit each of the packages, using the same branch name

## Documentation

- Update README.md for significant changes
- Add inline documentation for complex logic
- Keep CHANGELOG.md updated


## Adding Support for New Modules

Currently, only a predefined set of modules are supported (see README.md for the list). To add support for additional modules, you'll need to implement the following requirements:

1. **Runtime Version Management**
   - Implement version management for the module's runtime environment
   - Use appropriate version managers (e.g., nvm for Node.js, pyenv for Python, mise for everything, etc)
   - Ensure compatibility with different runtime versions

2. **Package Dependencies**
   - Set up linking between related packages

3. **Build and Test Infrastructure**
   - Implement necessary build and test scripts
   - Configure start scripts for local development
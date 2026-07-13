#!/usr/bin/env node

import { Command } from 'commander';
import process from 'process';
import { readFileSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ConfigManager } from './lib/config.js';
import { CommandRegistry } from './lib/command-registry.js';
import { QueryCommand } from './commands/query-command.js';
import { ConfigCommand } from './commands/config-command.js';
import { JobListCommand, JobCrudCommand } from './commands/job-command.js';
import { JobToTestCommand } from './commands/job-to-test-command.js';
import { JobPlanCommand } from './commands/job-plan-command.js';
import { JobDraftCommand } from './commands/job-draft-command.js';
import { JobApplyCommand } from './commands/job-apply-command.js';
import { IntegrationListCommand, IntegrationCrudCommand } from './commands/integration-command.js';
import { DatasetListCommand, DatasetCrudCommand } from './commands/dataset-command.js';
import { GrokParseCommand } from './commands/grok-command.js';
import { DocsSearchCommand } from './commands/docs-command.js';
import { DocsGetCommand } from './commands/docs-get-command.js';
import { SqlValidateCommand } from './commands/sql-validate-command.js';
import { BackfillCommand } from './commands/backfill-command.js';
import type { CliOptions } from './types.js';
import { parseAuthMethod, parseEnvUrl, parseQueryEngine, parseUrl } from './lib/option-parsers.js';

/**
 * Type predicate that narrows a Partial<CliOptions> to a fully-resolved CliOptions.
 * Returns true when every required field has been populated (either by user input,
 * saved config, env vars, or default values).
 */
function isResolvedCliOptions(options: Partial<CliOptions>): options is CliOptions {
  return (
    typeof options.orgName === 'string' &&
    typeof options.authBaseUrl === 'string' &&
    typeof options.clientId === 'string' &&
    (options.authMethod === 'oauth' || options.authMethod === 'client-credentials')
  );
}

/**
 * Get the version from package.json
 */
function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Try multiple possible locations for package.json
    const possiblePaths = [
      join(__dirname, '../../../package.json'), // Development: src/main/typescript/grepr.ts -> package.json
      join(__dirname, '../../package.json'), // Development: build/dist/grepr.js -> package.json
      join(__dirname, 'package.json'),       // Distribution: grepr.js in same dir as package.json
      join(__dirname, '../package.json'),    // Alternative distribution structure
    ];

    for (const packageJsonPath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        return packageJson.version;
      } catch {
        // Continue to next path
      }
    }

    throw new Error('package.json not found in any expected location');
  } catch (error) {
    console.warn('Could not read version from package.json:', error);
    return '1.1.0'; // fallback version
  }
}

/**
 * Main CLI application for Grepr query tool using self-registering commands
 */
export class GreprQueryCLI {
  private program: Command;
  private commandRegistry: CommandRegistry;

  constructor() {
    this.program = new Command();
    this.commandRegistry = new CommandRegistry();
  }

  /**
   * Merge configuration with CLI options.
   * Priority order: CLI args > env vars > saved config > defaults
   */
  async mergeConfiguration(options: Partial<CliOptions>): Promise<CliOptions> {
    const configManager = new ConfigManager();
    // Snapshot CLI args before the saved-config merge so the env-var fallbacks
    // below can override saved config but still yield to explicit CLI args.
    const cliOptions = { ...options };

    if (options.conf) {
      try {
        const savedConfig = await configManager.getConfig(options.conf);
        if (savedConfig) {
          options = ConfigManager.mergeConfigWithOptions(savedConfig, options);
          delete options.conf;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error loading configuration '${options.conf}': ${errorMessage}`);
        process.exit(1);
      }
    } else if (!options.orgName) {
      try {
        const defaultConfig = await configManager.getDefaultConfig();
        if (defaultConfig) {
          const defaultName = await configManager.getDefaultConfigName();
          if (!options.quiet) {
            console.error(`Using default configuration: ${defaultName || 'unknown'}`);
          }
          options = ConfigManager.mergeConfigWithOptions(defaultConfig, options);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Warning: Could not load default configuration: ${errorMessage}`);
      }
    }

    // Apply environment variable fallbacks. These are overridden by explicit
    // CLI args but take priority over saved config.
    if (!cliOptions.orgName && process.env.GREPR_ORG_NAME) {
      options.orgName = process.env.GREPR_ORG_NAME;
    }
    if (!cliOptions.apiBaseUrl && process.env.GREPR_API_BASE_URL) {
      options.apiBaseUrl = parseEnvUrl('GREPR_API_BASE_URL', process.env.GREPR_API_BASE_URL);
    }
    if (!cliOptions.clientId && process.env.GREPR_CLIENT_ID) {
      options.clientId = process.env.GREPR_CLIENT_ID;
    }
    if (!cliOptions.clientSecret && process.env.GREPR_CLIENT_SECRET) {
      options.clientSecret = process.env.GREPR_CLIENT_SECRET;
    }
    if (!cliOptions.authBaseUrl && process.env.GREPR_AUTH_BASE_URL) {
      options.authBaseUrl = parseEnvUrl('GREPR_AUTH_BASE_URL', process.env.GREPR_AUTH_BASE_URL);
    }
    // Unlike the fallbacks above, the auth method is always validated, since
    // it can also arrive via CLI arg or saved config.
    const authMethodInput =
      !cliOptions.authMethod && process.env.GREPR_AUTH_METHOD
        ? process.env.GREPR_AUTH_METHOD
        : options.authMethod;
    options.authMethod = parseAuthMethod(authMethodInput);

    // Query engine resolves from GREPR_QUERY_ENGINE only (no flag/saved config)
    // and is validated here. Left undefined when unset; the query command defaults.
    options.queryEngine = parseQueryEngine(process.env.GREPR_QUERY_ENGINE);

    if (!options.orgName) {
      console.error('Error: --org-name is required (unless using --conf with a saved configuration or a default configuration is set)');
      process.exit(1);
    }

    // Set all the defaults
    if (!options.authBaseUrl) {
      // Auth0 custom domain. Must match the domain used when generating the
      // Self-Service Enterprise Connection ticket in Auth0 — when Auth0
      // federates to the customer's IdP it uses {authBaseUrl}/login/callback,
      // and the customer's IdP only has that exact URL registered.
      options.authBaseUrl = 'https://auth.grepr.ai';
    }

    if (!options.apiBaseUrl) {
      options.apiBaseUrl = `https://${options.orgName}.app.grepr.ai/api`;
    }

    if (!options.clientId) {
      // prod app clientId.
      options.clientId = '4XOD92WjzdfT4yxWeHpwh4J2u8t9qPtS';
    }

    if (!options.authMethod) {
      options.authMethod = options.clientSecret ? 'client-credentials' : 'oauth';
    }

    if (!isResolvedCliOptions(options)) {
      throw new Error('Internal error: required CLI options missing after default resolution');
    }
    return options;
  }

  /**
   * Register all commands with the command registry
   */
  private registerCommands(): void {
    // Register streaming commands
    this.commandRegistry.register(new QueryCommand());

    // Register public write workflow commands
    this.commandRegistry.register(new BackfillCommand());

    // Register configuration commands
    this.commandRegistry.register(new ConfigCommand());

    // Register job commands
    this.commandRegistry.register(new JobListCommand());
    this.commandRegistry.register(new JobCrudCommand());
    this.commandRegistry.register(new JobToTestCommand());

    // Register pipeline-editing commands (terraform-style plan / draft / apply)
    this.commandRegistry.register(new JobPlanCommand());
    this.commandRegistry.register(new JobDraftCommand());
    this.commandRegistry.register(new JobApplyCommand());

    // Register integration commands
    this.commandRegistry.register(new IntegrationListCommand());
    this.commandRegistry.register(new IntegrationCrudCommand());

    // Register dataset commands
    this.commandRegistry.register(new DatasetListCommand());
    this.commandRegistry.register(new DatasetCrudCommand());

    // Register SQL commands
    this.commandRegistry.register(new SqlValidateCommand());

    // Register grok commands
    this.commandRegistry.register(new GrokParseCommand());

    // Register docs commands
    this.commandRegistry.register(new DocsSearchCommand());
    this.commandRegistry.register(new DocsGetCommand());
  }

  /**
   * Setup CLI commands and options
   */
  setupCLI(): Command {
    this.program
      .name('grepr')
      .description('Grepr Command Line Interface (CLI) Tool')
      .version(getVersion());

    // Global options for all commands
    this.program
      .option('--conf <name>', 'Use saved configuration from ~/.grepr/cli-config.json')
      .option('--org-name <name>', 'Organization name (required unless using --conf)')
      .option('--api-base-url <url>', 'API server base URL (default: https://<orgName>.app.grepr.ai/api)', parseUrl)
      .option('--auth-base-url <url>', 'Auth0 base URL', parseUrl)
      .option('--auth-method <method>', 'Authentication method (oauth, client-credentials)')
      .option('--client-id <id>', 'OAuth Client ID (optional, defaults to Web Client ID)')
      .option('--client-secret <secret>', 'Client secret for client-credentials authentication (required when using --auth-method client-credentials)')
      .option('--no-auth-cache', 'Force fresh authentication by ignoring cached tokens', true)
      .option('--no-browser', 'Do not automatically open browser for OAuth authentication', true)
      .option('--timezone <tz>', 'Timezone for timestamp formatting (e.g., UTC, America/New_York)', 'system')
      .option('-o, --output <file>', 'Output results to file instead of stdout')
      .option('-d, --debug', 'Enable debug output')
      .option('-q, --quiet', 'Suppress non-essential output');

    // Register all commands using the registry
    this.registerCommands();
    this.commandRegistry.registerAll(this.program, this.mergeConfiguration.bind(this));

    return this.program;
  }
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined
    && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPoint);
}

if (isMainModule()) {
  const cli = new GreprQueryCLI();
  cli.setupCLI().parse();
}

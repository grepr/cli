import { ListCommand, ListCommandOptions } from './list-command.js';
import { CrudCommand, CrudCommandOptions, CrudCreateUpdateOptions } from './crud-command.js';
import { CommandOption } from '../types.js';

// Integration-specific interfaces extending the base interfaces
export type IntegrationListCommandOptions = ListCommandOptions;

export type IntegrationCrudCommandOptions = CrudCommandOptions;

export type IntegrationCreateUpdateOptions = CrudCreateUpdateOptions;

/**
 * Integration list command implementation using the new architecture
 */
export class IntegrationListCommand extends ListCommand<IntegrationListCommandOptions> {
  getCommandName(): string {
    return 'integration:list';
  }

  getCommandDescription(): string {
    return 'List integrations with optional filtering';
  }

  getCommandOptions(): CommandOption[] {
    return [
      // Add integration-specific list options here
    ];
  }

  async executeList(options: IntegrationListCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      // Get all integrations across all types
      const allIntegrations = await this.apiClient.getAllIntegrations();

      // Flatten the results and add type information to each integration
      const integrationList = allIntegrations.flatMap(({ type, items }) =>
        items.map(item => ({
          ...item,
          type: type
        }))
      );

      await this.formatAndOutput(integrationList, options, 'integrations');
      this.showQuerySummary(options, integrationList.length);

    } catch (error) {
      console.error('Error listing integrations:', (error as Error).message);
      process.exit(1);
    }
  }
}

/**
 * Integration CRUD command implementation using the new architecture
 */
export class IntegrationCrudCommand extends CrudCommand<IntegrationCrudCommandOptions> {
  getCommandPrefix(): string {
    return 'integration';
  }

  getResourceName(): string {
    return 'integration';
  }

  protected supportsGet(): boolean {
    return true;
  }

  protected supportsCreate(): boolean {
    return false;
  }

  protected supportsUpdate(): boolean {
    return false;
  }

  protected supportsDelete(): boolean {
    return false;
  }

  async executeGet(integrationId: string, options: IntegrationCrudCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      // Try to find the integration across all integration types
      const integration = await this.apiClient.getIntegrationById(integrationId);

      if (!integration) {
        console.error(`Integration ${integrationId} not found`);
        process.exit(1);
      }

      const type = integration.type;

      await this.formatAndOutputSingle(integration as Record<string, unknown>, options);

      if (!options.quiet) {
        console.log(`\nIntegration Details:\n- ID: ${integration.id}\n- Name: ${integration.name}\n- Type: ${type}`);
      }

    } catch (error) {
      console.error(`Error getting integration ${integrationId}:`, (error as Error).message);
      process.exit(1);
    }
  }

}
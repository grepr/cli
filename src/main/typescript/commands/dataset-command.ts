import { ListCommand, ListCommandOptions } from './list-command.js';
import { CrudCommand, CrudCommandOptions, CrudCreateUpdateOptions } from './crud-command.js';
import { logHumanFooter } from '../lib/output-format.js';
import { CommandOption } from '../types.js';
import { SchemaDatasetCreate, SchemaDatasetUpdate } from '../openapi/openApiTypes.js';

// Dataset-specific interfaces extending the base interfaces
export type DatasetListCommandOptions = ListCommandOptions;

export type DatasetCrudCommandOptions = CrudCommandOptions;

export type DatasetCreateUpdateOptions = CrudCreateUpdateOptions;

/**
 * Dataset list command implementation using the new architecture
 */
export class DatasetListCommand extends ListCommand<DatasetListCommandOptions> {
  getCommandName(): string {
    return 'dataset:list';
  }

  getCommandDescription(): string {
    return 'List datasets with optional filtering';
  }

  getCommandOptions(): CommandOption[] {
    return [
      // Add dataset-specific list options here if needed in the future
    ];
  }

  async executeList(options: DatasetListCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      const datasets = await this.apiClient.listDatasets();
      const datasetList = datasets || [];

      await this.formatAndOutput(datasetList, options, 'datasets');
      this.showQuerySummary(options, datasetList.length);

    } catch (error) {
      console.error('Error listing datasets:', (error as Error).message);
      process.exit(1);
    }
  }
}

/**
 * Dataset CRUD command implementation using the new architecture
 */
export class DatasetCrudCommand extends CrudCommand<DatasetCrudCommandOptions> {
  getCommandPrefix(): string {
    return 'dataset';
  }

  getResourceName(): string {
    return 'dataset';
  }

  protected supportsGet(): boolean {
    return true;
  }

  protected supportsCreate(): boolean {
    return true;
  }

  protected supportsUpdate(): boolean {
    return true;
  }

  protected supportsDelete(): boolean {
    return true;
  }

  async executeGet(datasetId: string, options: DatasetCrudCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      const dataset = await this.apiClient.getDataset(datasetId);

      if (!dataset) {
        console.error(`Dataset ${datasetId} not found`);
        process.exit(1);
      }

      await this.formatAndOutputSingle(dataset as Record<string, unknown>, options);

      if (!options.quiet) {
        logHumanFooter(
          options.format,
          `\nDataset Details:\n- ID: ${dataset.id}\n- Name: ${dataset.name}`
        );
      }

    } catch (error) {
      console.error(`Error getting dataset ${datasetId}:`, (error as Error).message);
      process.exit(1);
    }
  }

  async executeCreate(options: CrudCreateUpdateOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      const datasetData = await this.loadResourceFromFile<SchemaDatasetCreate>(options.resourceFile);
      const createdDataset = await this.apiClient.createDataset(datasetData);

      if (createdDataset) {
        this.showCreateSuccess(createdDataset as Record<string, unknown>, options);
        await this.formatAndOutputSingle(createdDataset as Record<string, unknown>, options);
      }

    } catch (error) {
      console.error('Error creating dataset:', (error as Error).message);
      process.exit(1);
    }
  }

  async executeUpdate(datasetId: string, options: CrudCreateUpdateOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      const datasetData = await this.loadResourceFromFile<SchemaDatasetUpdate>(options.resourceFile);
      const updatedDataset = await this.apiClient.updateDataset(datasetId, datasetData);

      if (!updatedDataset) {
        console.error(`Failed to update dataset ${datasetId}`);
        process.exit(1);
      }

      this.showUpdateSuccess(datasetId, options);
      await this.formatAndOutputSingle(updatedDataset as Record<string, unknown>, options);

    } catch (error) {
      console.error(`Error updating dataset ${datasetId}:`, (error as Error).message);
      process.exit(1);
    }
  }

  async executeDelete(datasetId: string, options: DatasetCrudCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      await this.apiClient.deleteDataset(datasetId);

      this.showDeleteSuccess(datasetId, options);

    } catch (error) {
      console.error(`Error deleting dataset ${datasetId}:`, (error as Error).message);
      process.exit(1);
    }
  }
}

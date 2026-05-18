import { Command } from 'commander';
import { MergeConfiguration } from '../types.js';

/**
 * Interface for self-registering CLI commands
 */
export interface ICommand {
  /**
   * Add this command and its subcommands to the program
   * @param program - The main commander program
   * @param mergeConfiguration - Function to merge CLI options with configuration
   */
  addToProgram(
    program: Command,
    mergeConfiguration: MergeConfiguration
  ): void;
}

/**
 * Registry for managing CLI commands
 */
export class CommandRegistry {
  private commands: ICommand[] = [];

  /**
   * Register a command with the registry
   */
  register(command: ICommand): void {
    this.commands.push(command);
  }

  /**
   * Register all commands with the program
   */
  registerAll(program: Command, mergeConfiguration: MergeConfiguration): void {
    this.commands.forEach(command => {
      command.addToProgram(program, mergeConfiguration);
    });
  }

  /**
   * Get all registered commands
   */
  getCommands(): ICommand[] {
    return [...this.commands];
  }

  /**
   * Clear all registered commands (useful for testing)
   */
  clear(): void {
    this.commands = [];
  }
}
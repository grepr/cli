import { describe, it, expect, beforeEach } from 'bun:test';
import { DocsGetCommand } from '../../../../src/main/typescript/commands/docs-get-command.js';

describe('DocsGetCommand', () => {
  let command: DocsGetCommand;

  beforeEach(() => {
    command = new DocsGetCommand();
  });

  describe('Basic Properties', () => {
    it('test_getCommandName_shouldReturnDocsGet', () => {
      const result = command.getCommandName();

      expect(result).toBe('docs:get');
    });

    it('test_getCommandDescription_shouldReturnCorrectDescription', () => {
      const result = command.getCommandDescription();

      expect(result).toBe('Retrieve full documentation content by URI (doc://...)');
    });
  });
});

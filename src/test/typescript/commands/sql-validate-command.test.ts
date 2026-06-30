import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { SqlValidateCommand } from '@/commands/sql-validate-command.js';

vi.mock('@/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(),
}));

import { createApiClient } from '@/lib/api-client-factory.js';

describe('SqlValidateCommand', () => {
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('test_sqlValidate_validSql_printsValidAndExitsZero', async () => {
    const mockApi = { validateSql: vi.fn().mockResolvedValue({ valid: true }) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new SqlValidateCommand().addToProgram(program, async opts => ({ ...opts, quiet: false }) as never);
    await program.parseAsync(['node', 'test', 'sql:validate', 'SELECT 1']);

    expect(mockApi.validateSql).toHaveBeenCalledWith('SELECT 1');
    expect(consoleLogSpy).toHaveBeenCalledWith('SQL is valid.');
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('test_sqlValidate_validSql_quiet_printsNothing', async () => {
    const mockApi = { validateSql: vi.fn().mockResolvedValue({ valid: true }) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new SqlValidateCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'sql:validate', 'SELECT 1']);

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('test_sqlValidate_invalidSql_printsErrorAndExitsOne', async () => {
    const mockApi = {
      validateSql: vi.fn().mockResolvedValue({ valid: false, errorMessage: 'Unexpected token at line 1' }),
    };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new SqlValidateCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'sql:validate', 'SELECT * FORM table']),
    ).rejects.toThrow();

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Unexpected token at line 1');
  });

  it('test_sqlValidate_apiError_exitsOne', async () => {
    const mockApi = { validateSql: vi.fn().mockRejectedValue(new Error('network failure')) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new SqlValidateCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'sql:validate', 'SELECT 1']),
    ).rejects.toThrow();

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error validating SQL:', 'network failure');
  });
});

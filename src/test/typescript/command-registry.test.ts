import { describe, it, expect, beforeEach, vi } from 'bun:test'
import { Command } from 'commander'
import { CommandRegistry, ICommand } from '../../main/typescript/lib/command-registry.js'

// Mock command for testing
class MockCommand implements ICommand {
  private name: string
  private addToProgramSpy = vi.fn()

  constructor(name: string) {
    this.name = name
  }

  addToProgram(program: Command, mergeConfiguration: (options: any) => Promise<any>): void {
    // Mock implementation - just add a simple command
    program.command(this.name).description(`Mock ${this.name} command`)
    this.addToProgramSpy(program, mergeConfiguration)
  }

  // Expose the spy for testing
  getAddToProgramSpy() {
    return this.addToProgramSpy
  }
}

describe('CommandRegistry', () => {
  let registry: CommandRegistry
  let program: Command
  let mockMergeConfig: (options: any) => Promise<any>

  beforeEach(() => {
    registry = new CommandRegistry()
    program = new Command()
    mockMergeConfig = vi.fn().mockResolvedValue({})
  })

  describe('Command registration', () => {
    it('should register a single command', () => {
      const mockCommand = new MockCommand('test')

      registry.register(mockCommand)

      expect(registry.getCommands()).toHaveLength(1)
      expect(registry.getCommands()[0]).toBe(mockCommand)
    })

    it('should register multiple commands', () => {
      const command1 = new MockCommand('test1')
      const command2 = new MockCommand('test2')

      registry.register(command1)
      registry.register(command2)

      expect(registry.getCommands()).toHaveLength(2)
      expect(registry.getCommands()).toContain(command1)
      expect(registry.getCommands()).toContain(command2)
    })

    it('should allow duplicate registrations of the same command', () => {
      const mockCommand = new MockCommand('test')

      registry.register(mockCommand)
      registry.register(mockCommand)

      expect(registry.getCommands()).toHaveLength(2)
    })
  })

  describe('Command registration with program', () => {
    it('should call addToProgram on all registered commands', () => {
      const command1 = new MockCommand('test1')
      const command2 = new MockCommand('test2')

      registry.register(command1)
      registry.register(command2)

      registry.registerAll(program, mockMergeConfig)

      expect(command1.getAddToProgramSpy()).toHaveBeenCalledWith(program, mockMergeConfig)
      expect(command2.getAddToProgramSpy()).toHaveBeenCalledWith(program, mockMergeConfig)
    })

    it('should handle empty registry gracefully', () => {
      expect(() => {
        registry.registerAll(program, mockMergeConfig)
      }).not.toThrow()
    })
  })

  describe('Registry management', () => {
    it('should return a copy of commands array', () => {
      const mockCommand = new MockCommand('test')
      registry.register(mockCommand)

      const commands = registry.getCommands()
      commands.push(new MockCommand('should-not-affect-registry'))

      expect(registry.getCommands()).toHaveLength(1)
    })

    it('should clear all registered commands', () => {
      const command1 = new MockCommand('test1')
      const command2 = new MockCommand('test2')

      registry.register(command1)
      registry.register(command2)

      expect(registry.getCommands()).toHaveLength(2)

      registry.clear()

      expect(registry.getCommands()).toHaveLength(0)
    })
  })

  describe('Integration with Commander.js', () => {
    it('should create commands that are accessible on program', () => {
      class TestCommand implements ICommand {
        addToProgram(program: Command, _mergeConfiguration: (options: any) => Promise<any>): void {
          program.command('test:example')
            .description('Test example command')
            .action(() => {
              // Mock action
            })
        }
      }

      const testCommand = new TestCommand()
      registry.register(testCommand)
      registry.registerAll(program, mockMergeConfig)

      // Verify the command was added to the program
      const commands = program.commands
      expect(commands).toHaveLength(1)
      expect(commands[0]?.name()).toBe('test:example')
      expect(commands[0]?.description()).toBe('Test example command')
    })

    it('should pass merge configuration function to commands', () => {
      const mergeConfigSpy = vi.fn().mockResolvedValue({ orgName: 'test-org' })

      class TestCommand implements ICommand {
        addToProgram(program: Command, _mergeConfiguration: (options: any) => Promise<any>): void {
          program.command('test:config')
            .action(async (options: any) => {
              const merged = await _mergeConfiguration(options)
              expect(merged.orgName).toBe('test-org')
            })
        }
      }

      const testCommand = new TestCommand()
      registry.register(testCommand)
      registry.registerAll(program, mergeConfigSpy)

      expect(program.commands).toHaveLength(1)
    })
  })
})
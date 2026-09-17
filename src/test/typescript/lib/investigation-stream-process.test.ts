import { expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('ends a native Node follower cleanly when its downstream reader closes', async () => {
  const module = fileURLToPath(new URL('../../../main/typescript/lib/investigation-output.ts', import.meta.url));
  const child = spawn('node', ['--import', 'tsx', '--input-type=module', '--eval', `
    import { writeReadStream } from ${JSON.stringify(module)};
    async function* events() {
      try {
        yield { type: 'status' };
        await new Promise(resolve => setTimeout(resolve, 50));
        yield { type: 'turn' };
      } finally { process.stderr.write('reader closed'); }
    }
    await writeReadStream(events(), { format: 'raw' });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.stdout.once('data', () => child.stdout.destroy());
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  });
  expect(code).toBe(0);
  expect(stderr).toBe('reader closed');
});

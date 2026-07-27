import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { convertOpenAPIToMarkdown } from '../../../../scripts/convert-openapi-to-markdown.js';

const testRoot = path.resolve(
  'build',
  `openapi-converter-test-${process.pid}-${Date.now()}`
);
const specPath = path.join(testRoot, 'openapi.json');
const outputDir = path.join(testRoot, 'openapi-docs');

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function writeOpenAPISpec(
  operationId: string,
  operationSummary: string,
  schemaName: string
): void {
  mkdirSync(testRoot, { recursive: true });
  writeFileSync(
    specPath,
    JSON.stringify({
      openapi: '3.0.0',
      info: {
        title: 'Test API',
        description: 'OpenAPI conversion regression fixture',
        version: '1.0.0'
      },
      paths: {
        '/widgets': {
          get: {
            operationId,
            summary: operationSummary,
            tags: ['Widgets'],
            responses: {
              '200': {
                description: 'Success'
              }
            }
          }
        }
      },
      components: {
        schemas: {
          [schemaName]: {
            type: 'object',
            description: `${schemaName} schema`
          }
        }
      }
    }),
    'utf-8'
  );
}

describe('convertOpenAPIToMarkdown', () => {
  it('replaces generated Markdown when the OpenAPI spec changes', async () => {
    writeOpenAPISpec('listOldWidgets', 'List old widgets', 'OldWidget');
    await convertOpenAPIToMarkdown(specPath, outputDir);

    const oldOperation = path.join(outputDir, 'api/Widgets/listOldWidgets.md');
    const oldSchema = path.join(outputDir, 'schemas/OldWidget.md');
    expect(existsSync(oldOperation)).toBe(true);
    expect(existsSync(oldSchema)).toBe(true);

    writeOpenAPISpec('listNewWidgets', 'List new widgets', 'NewWidget');
    await convertOpenAPIToMarkdown(specPath, outputDir);

    const newOperation = path.join(outputDir, 'api/Widgets/listNewWidgets.md');
    const newSchema = path.join(outputDir, 'schemas/NewWidget.md');
    expect(readFileSync(newOperation, 'utf-8')).toContain('# List new widgets');
    expect(existsSync(newSchema)).toBe(true);
    expect(existsSync(oldOperation)).toBe(false);
    expect(existsSync(oldSchema)).toBe(false);
  });
});

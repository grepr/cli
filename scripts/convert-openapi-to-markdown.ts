#!/usr/bin/env tsx

/**
 * Convert OpenAPI spec to AI-friendly markdown files for semantic search.
 *
 * This script parses the OpenAPI JSON spec and generates individual markdown
 * files for each API operation and schema definition. The markdown format is
 * optimized for:
 * - Semantic search via vector embeddings
 * - AI/LLM consumption (clean, contextual text)
 * - Human readability
 *
 * Output structure:
 * - build/dist/openapi-docs/api/{tag}/{operationId}.md - API operations
 * - build/dist/openapi-docs/schemas/{schemaName}.md - Schema definitions
 *
 * Each file contains:
 * - Natural language descriptions
 * - Request/response details
 * - Examples and related schemas
 * - Proper context for understanding usage
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, Schema>;
  };
  tags?: Array<{ name: string; description: string }>;
}

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
}

interface RequestBody {
  description?: string;
  content: Record<string, { schema: Schema }>;
  required?: boolean;
}

interface Response {
  description: string;
  content?: Record<string, { schema: Schema }>;
}

interface Schema {
  type?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  $ref?: string;
  oneOf?: Schema[];
  allOf?: Schema[];
  anyOf?: Schema[];
  enum?: string[];
}

function extractSchemaName(ref: string): string {
  return ref.split('/').pop() || ref;
}

function formatSchemaType(schema: Schema): string {
  if (schema.$ref) {
    return `\`${extractSchemaName(schema.$ref)}\``;
  }
  if (schema.type === 'array' && schema.items) {
    return `array of ${formatSchemaType(schema.items)}`;
  }
  if (schema.oneOf) {
    return `one of: ${schema.oneOf.map(s => formatSchemaType(s)).join(', ')}`;
  }
  if (schema.enum) {
    return `enum: ${schema.enum.map(e => `\`${e}\``).join(', ')}`;
  }
  return schema.type || 'object';
}

function generateOperationMarkdown(
  path: string,
  method: string,
  operation: Operation
): string {
  const lines: string[] = [];

  lines.push(`# ${operation.summary || operation.operationId || 'API Operation'}`);
  lines.push('');
  lines.push(`**${method.toUpperCase()}** \`${path}\``);
  lines.push('');
  lines.push(`**Operation ID**: \`${operation.operationId || 'N/A'}\``);
  lines.push(`**Summary**: ${operation.summary || 'No summary provided.'}`);

  if (operation.description) {
    lines.push(operation.description);
    lines.push('');
  }

  if (operation.tags && operation.tags.length > 0) {
    lines.push('## Tags');
    operation.tags.forEach(tag => lines.push(`- ${tag}`));
  }

  if (operation.parameters && operation.parameters.length > 0) {
    lines.push('## Parameters');
    lines.push('');
    operation.parameters.forEach(param => {
      const required = param.required ? ' (required)' : ' (optional)';
      lines.push(`- **${param.name}**${required} - ${param.in}`);
      if (param.description) {
        lines.push(`  - ${param.description}`);
      }
      if (param.schema) {
        lines.push(`  - Type: ${formatSchemaType(param.schema)}`);
      }
    });
    lines.push('');
  }

  if (operation.requestBody) {
    lines.push('## Request Body');
    lines.push('');
    if (operation.requestBody.description) {
      lines.push(operation.requestBody.description);
      lines.push('');
    }

    Object.entries(operation.requestBody.content).forEach(([contentType, content]) => {
      lines.push(`**Content-Type**: \`${contentType}\``);
      lines.push('');
      if (content.schema) {
        lines.push(`**Schema**: ${formatSchemaType(content.schema)}`);
        lines.push('');
      }
    });
  }

  if (operation.responses) {
    lines.push('## Responses');
    lines.push('');
    Object.entries(operation.responses).forEach(([code, response]) => {
      lines.push(`### ${code}`);
      lines.push('');
      lines.push(response.description);
      lines.push('');

      if (response.content) {
        Object.entries(response.content).forEach(([contentType, content]) => {
          lines.push(`- **Content-Type**: \`${contentType}\` / ${content?.schema ? formatSchemaType(content.schema) : 'No schema defined'}`);
        });
      }
    });
  }

  return lines.join('\n');
}

function generateSchemaMarkdown(schemaName: string, schema: Schema): string {
  const lines: string[] = [];

  lines.push(`# ${schemaName}`);
  lines.push('');

  if (schema.description) {
    lines.push(schema.description);
    lines.push('');
  }

  if (schema.type) {
    lines.push(`**Type**: \`${schema.type}\``);
    lines.push('');
  }

  if (schema.enum) {
    lines.push('## Possible Values');
    lines.push('');
    schema.enum.forEach(value => lines.push(`- \`${value}\``));
  }

  if (schema.oneOf) {
    lines.push('## One Of');
    lines.push('');
    lines.push('This schema accepts one of the following types:');
    lines.push('');
    schema.oneOf.forEach((subSchema, idx) => {
      lines.push(`### Option ${idx + 1}`);
      if (subSchema.$ref) {
        lines.push(`${formatSchemaType(subSchema)}`);
      }
      if (subSchema.description) {
        lines.push(subSchema.description);
      }
      lines.push('');
    });
  }

  if (schema.properties) {
    lines.push('## Properties');
    lines.push('');
    Object.entries(schema.properties).forEach(([propName, propSchema]) => {
      const required = schema.required?.includes(propName) ? ' (required)' : ' (optional)';
      lines.push(`- name: ${propName}${required}`);
      lines.push(`  type: ${formatSchemaType(propSchema)}`);
      if (propSchema.description) {
        lines.push(`  description: ${propSchema.description}`);
      }
      lines.push('')
    });
  }

  return lines.join('\n');
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function convertOpenAPIToMarkdown(): Promise<void> {
  console.log('Converting OpenAPI spec to markdown...\n');

  const specPath = path.resolve(__dirname, '../../../docs/public/openapi.json');
  if (!existsSync(specPath)) {
    console.warn(`⚠ OpenAPI spec not found: ${specPath}`);
    console.warn('  Skipping OpenAPI conversion.\n');
    return;
  }

  const spec: OpenAPISpec = JSON.parse(readFileSync(specPath, 'utf-8'));

  const outputDir = path.resolve(__dirname, '../build/dist/openapi-docs');
  const apiDir = path.join(outputDir, 'api');
  const schemasDir = path.join(outputDir, 'schemas');

  if (existsSync(apiDir) && existsSync(schemasDir)) {
    console.log('OpenAPI markdown docs already exist. Skipping conversion.\n');
    return;
  }

  mkdirSync(apiDir, { recursive: true });
  mkdirSync(schemasDir, { recursive: true });

  let apiCount = 0;
  let schemaCount = 0;

  console.log('Generating API operation markdown files...\n');

  for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        const op = operation as Operation;
        const operationId = op.operationId || `${method}-${pathStr.replace(/[^a-zA-Z0-9]/g, '-')}`;

        // Skip hidden operations (operationId ending with -hidden)
        if (operationId.endsWith('-hidden')) {
          continue;
        }

        const tag = op.tags?.[0] || 'general';

        const tagDir = path.join(apiDir, sanitizeFilename(tag));
        mkdirSync(tagDir, { recursive: true });

        const filename = `${sanitizeFilename(operationId)}.md`;
        const filepath = path.join(tagDir, filename);

        const markdown = generateOperationMarkdown(pathStr, method, op);
        writeFileSync(filepath, markdown, 'utf-8');

        apiCount++;
        if (apiCount % 10 === 0) {
          process.stdout.write(`  Generated ${apiCount} API operations...\r`);
        }
      }
    }
  }
  console.log(`\n✓ Generated ${apiCount} API operation files\n`);

  console.log('Generating schema markdown files...\n');

  if (spec.components?.schemas) {
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      const filename = `${sanitizeFilename(schemaName)}.md`;
      const filepath = path.join(schemasDir, filename);

      const markdown = generateSchemaMarkdown(schemaName, schema);
      writeFileSync(filepath, markdown, 'utf-8');

      schemaCount++;
      if (schemaCount % 50 === 0) {
        process.stdout.write(`  Generated ${schemaCount} schemas...\r`);
      }
    }
  }
  console.log(`\n✓ Generated ${schemaCount} schema files\n`);

  console.log('✓ OpenAPI conversion complete!');
  console.log(`  API operations: ${apiCount}`);
  console.log(`  Schemas: ${schemaCount}`);
  console.log(`  Output directory: ${outputDir}`);
}

convertOpenAPIToMarkdown().catch((error) => {
  console.error('\n✗ Error converting OpenAPI spec:');
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error('\nStack trace:');
    console.error(error.stack);
  }
  process.exit(1);
});

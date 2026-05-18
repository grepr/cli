import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import {
  extractFrontmatter,
  htmlToMarkdown,
  mdxToMarkdown,
  unflattenTables,
  unescapeMarkdown,
} from '../../../../scripts/mdx-to-markdown.js';

/**
 * Creates a temporary "docs" directory structure with an MDX file
 * and optional supporting files, suitable for testing mdxToMarkdown.
 */
function createTempDocsDir(): string {
  const dir = path.join(tmpdir(), `mdx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.join(dir, 'app'), { recursive: true });
  mkdirSync(path.join(dir, 'components'), { recursive: true });
  mkdirSync(path.join(dir, 'app', 'shared'), { recursive: true });
  return dir;
}

function writeMdxFile(docsDir: string, relativePath: string, content: string): string {
  const fullPath = path.join(docsDir, 'app', relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

/* ------------------------------------------------------------------ */
/*  extractFrontmatter                                                */
/* ------------------------------------------------------------------ */

describe('extractFrontmatter', () => {
  it('test_extractFrontmatter_withDescription_shouldReturnDescription', () => {
    const source = '---\ndescription: Some page description\n---\n\n# Title\n\nBody text.';
    const { frontmatter, content } = extractFrontmatter(source);

    expect(frontmatter.description, 'should extract description').toBe('Some page description');
    expect(content.trim().startsWith('# Title'), 'content should start with heading').toBe(true);
  });

  it('test_extractFrontmatter_noFrontmatter_shouldReturnEmptyObject', () => {
    const source = '# Title\n\nNo frontmatter here.';
    const { frontmatter, content } = extractFrontmatter(source);

    expect(frontmatter, 'should return empty frontmatter').toEqual({});
    expect(content, 'content should be unchanged').toBe(source);
  });

  it('test_extractFrontmatter_quotedDescription_shouldStripQuotes', () => {
    const source = '---\ndescription: "A quoted description"\n---\n\nBody.';
    const { frontmatter } = extractFrontmatter(source);

    expect(frontmatter.description, 'should strip quotes').toBe('A quoted description');
  });

  it('test_extractFrontmatter_singleQuotedDescription_shouldStripQuotes', () => {
    const source = "---\ndescription: 'Single quoted'\n---\n\nBody.";
    const { frontmatter } = extractFrontmatter(source);

    expect(frontmatter.description, 'should strip single quotes').toBe('Single quoted');
  });
});

/* ------------------------------------------------------------------ */
/*  htmlToMarkdown                                                    */
/* ------------------------------------------------------------------ */

describe('htmlToMarkdown', () => {
  it('test_htmlToMarkdown_headingsAndParagraphs_shouldConvert', async () => {
    const html = '<h1>Title</h1><p>A paragraph.</p><h2>Subtitle</h2><p>More text.</p>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain h1').toContain('# Title');
    expect(md, 'should contain paragraph').toContain('A paragraph.');
    expect(md, 'should contain h2').toContain('## Subtitle');
    expect(md, 'should contain second paragraph').toContain('More text.');
  });

  it('test_htmlToMarkdown_images_shouldBeStripped', async () => {
    const html = '<p>Text before</p><img src="test.png" alt="test" /><p>Text after</p>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should not contain image markdown').not.toContain('![');
    expect(md, 'should not contain image src').not.toContain('test.png');
    expect(md, 'should keep text before').toContain('Text before');
    expect(md, 'should keep text after').toContain('Text after');
  });

  it('test_htmlToMarkdown_codeBlocks_shouldPreserveLanguage', async () => {
    const html = '<pre><code class="language-yaml">key: value</code></pre>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain fenced code block with language').toContain('```yaml');
    expect(md, 'should contain code content').toContain('key: value');
  });

  it('test_htmlToMarkdown_inlineCode_shouldPreserve', async () => {
    const html = '<p>Use <code>npm install</code> to install.</p>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain inline code').toContain('`npm install`');
  });

  it('test_htmlToMarkdown_blockquote_shouldConvert', async () => {
    const html = '<blockquote><p>Important note here.</p></blockquote>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain blockquote marker').toContain('> ');
    expect(md, 'should contain blockquote text').toContain('Important note here.');
  });

  it('test_htmlToMarkdown_links_shouldPreserve', async () => {
    const html = '<p>See <a href="/docs/page">the docs</a> for info.</p>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain markdown link').toContain('[the docs](/docs/page)');
  });

  it('test_htmlToMarkdown_unorderedList_shouldConvert', async () => {
    const html = '<ul><li>Item one</li><li>Item two</li></ul>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain first item').toContain('Item one');
    expect(md, 'should contain second item').toContain('Item two');
  });

  it('test_htmlToMarkdown_orderedList_shouldConvert', async () => {
    const html = '<ol><li>First</li><li>Second</li></ol>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain ordered list items').toMatch(/1\.\s+First/);
    expect(md, 'should contain second ordered item').toMatch(/2\.\s+Second/);
  });

  it('test_htmlToMarkdown_table_shouldConvertToGfm', async () => {
    const html = '<table><thead><tr><th>Name</th><th>Value</th></tr></thead>' +
      '<tbody><tr><td>foo</td><td>bar</td></tr></tbody></table>';
    const md = await htmlToMarkdown(html);

    expect(md, 'should contain table header').toContain('Name');
    expect(md, 'should contain table separator').toContain('---');
    expect(md, 'should contain table data').toContain('foo');
  });
});

/* ------------------------------------------------------------------ */
/*  mdxToMarkdown                                                     */
/* ------------------------------------------------------------------ */

describe('mdxToMarkdown', () => {
  let docsDir: string;

  beforeAll(() => {
    docsDir = createTempDocsDir();
  });

  it('test_mdxToMarkdown_plainMarkdown_shouldPassThrough', async () => {
    const source = '# Hello World\n\nThis is plain markdown.\n\n- Item 1\n- Item 2\n';
    const filePath = writeMdxFile(docsDir, 'test-plain/page.mdx', source);

    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(result, 'should contain heading').toContain('Hello World');
    expect(result, 'should contain paragraph').toContain('This is plain markdown.');
    expect(result, 'should contain list items').toContain('Item 1');
  });

  it('test_mdxToMarkdown_frontmatterDescription_shouldBePrepended', async () => {
    const source = '---\ndescription: Page summary here.\n---\n\n# Title\n\nBody content.';
    const filePath = writeMdxFile(docsDir, 'test-frontmatter/page.mdx', source);

    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(
      (result ?? '').startsWith('Page summary here.'),
      'description should be prepended as first line'
    ).toBe(true);
    expect(result, 'should contain body').toContain('Body content.');
  });

  it('test_mdxToMarkdown_calloutComponent_shouldRenderAsBlockquote', async () => {
    const source = [
      "import { Callout } from 'nextra/components'",
      '',
      '# Test Page',
      '',
      '<Callout>',
      '  This is an important warning.',
      '</Callout>',
    ].join('\n');

    const filePath = writeMdxFile(docsDir, 'test-callout/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(result, 'should contain callout text').toContain('This is an important warning.');
  });

  it('test_mdxToMarkdown_tabsComponent_shouldFlattenAllTabs', async () => {
    const source = [
      "import { Tabs } from 'nextra/components'",
      '',
      '# Config',
      '',
      '<Tabs items={["YAML", "JSON"]}>',
      '  <Tabs.Tab>',
      '    YAML configuration here.',
      '  </Tabs.Tab>',
      '  <Tabs.Tab>',
      '    JSON configuration here.',
      '  </Tabs.Tab>',
      '</Tabs>',
    ].join('\n');

    const filePath = writeMdxFile(docsDir, 'test-tabs/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(result, 'should contain YAML tab content').toContain('YAML configuration here.');
    expect(result, 'should contain JSON tab content').toContain('JSON configuration here.');
  });

  it('test_mdxToMarkdown_cardsComponent_shouldRenderTitleLinks', async () => {
    const source = [
      "import { Cards } from 'nextra/components'",
      '',
      '# Home',
      '',
      '<Cards>',
      '  <Cards.Card title="Getting Started" href="/start" />',
      '  <Cards.Card title="API Docs" href="/api" />',
      '</Cards>',
    ].join('\n');

    const filePath = writeMdxFile(docsDir, 'test-cards/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(result, 'should contain first card link').toContain('[Getting Started](/start)');
    expect(result, 'should contain second card link').toContain('[API Docs](/api)');
  });

  it('test_mdxToMarkdown_hiddenFAQ_shouldRenderQAPairs', async () => {
    const source = [
      "import { HiddenFAQ } from '@/components/HiddenFAQ'",
      '',
      '# FAQ Page',
      '',
      '<HiddenFAQ faqs={[',
      '  { q: "What is Grepr?", a: "An observability platform." },',
      '  { q: "How much does it cost?", a: "Contact sales." }',
      ']} />',
    ].join('\n');

    // Write the HiddenFAQ stub to the docs/components directory
    writeFileSync(
      path.join(docsDir, 'components', 'HiddenFAQ.tsx'),
      [
        "import React from 'react';",
        'interface FAQ { q: string; a: string; }',
        'interface HiddenFAQProps { faqs: FAQ[]; }',
        'export function HiddenFAQ({ faqs }: HiddenFAQProps) {',
        '  return React.createElement("section", null,',
        '    ...faqs.map((faq, i) =>',
        '      React.createElement(React.Fragment, { key: i },',
        '        React.createElement("h4", null, `Q: ${faq.q}`),',
        '        React.createElement("p", null, `A: ${faq.a}`)',
        '      )',
        '    )',
        '  );',
        '}',
      ].join('\n'),
      'utf-8'
    );

    const filePath = writeMdxFile(docsDir, 'test-faq/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(result, 'should contain first question').toContain('Q: What is Grepr?');
    expect(result, 'should contain first answer').toContain('A: An observability platform.');
    expect(result, 'should contain second question').toContain('Q: How much does it cost?');
    expect(result, 'should contain second answer').toContain('A: Contact sales.');
  });

  it('test_mdxToMarkdown_imagesInContent_shouldBeStripped', async () => {
    const source = [
      '# Page with Images',
      '',
      'Some text before.',
      '',
      '![Screenshot](/images/screenshot.png)',
      '',
      'Some text after.',
    ].join('\n');

    const filePath = writeMdxFile(docsDir, 'test-images/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(result, 'should not contain image reference').not.toContain('screenshot.png');
    expect(result, 'should not contain image markdown syntax').not.toContain('![');
    expect(result, 'should keep surrounding text').toContain('Some text before.');
    expect(result, 'should keep text after image').toContain('Some text after.');
  });

  it('test_mdxToMarkdown_codeBlocks_shouldPreserveLanguageTag', async () => {
    const source = [
      '# Code Example',
      '',
      '```yaml',
      'server:',
      '  port: 8080',
      '```',
    ].join('\n');

    const filePath = writeMdxFile(docsDir, 'test-code/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(result, 'should preserve yaml language tag').toContain('```yaml');
    expect(result, 'should preserve code content').toContain('port: 8080');
  });

  it('test_mdxToMarkdown_apiSpecPage_shouldReturnNull', async () => {
    const source = [
      "import ApiSpecPage from './ApiSpecPage'",
      '',
      '<ApiSpecPage />',
    ].join('\n');

    // Create the directory and write the stub ApiSpecPage before the MDX file
    const apiSpecDir = path.join(docsDir, 'app', 'test-apispec');
    mkdirSync(apiSpecDir, { recursive: true });

    writeFileSync(
      path.join(apiSpecDir, 'ApiSpecPage.tsx'),
      [
        'export default function ApiSpecPage() { return null; }',
      ].join('\n'),
      'utf-8'
    );

    const filePath = writeMdxFile(docsDir, 'test-apispec/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'ApiSpecPage-only files should return null').toBeNull();
  });

  it('test_mdxToMarkdown_emptyFile_shouldReturnNull', async () => {
    const source = '';
    const filePath = writeMdxFile(docsDir, 'test-empty/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'empty file should return null').toBeNull();
  });

  it('test_mdxToMarkdown_multipleComponentsMixed_shouldRenderAll', async () => {
    const source = [
      '---',
      'description: Mixed component test page.',
      '---',
      '',
      "import { Callout, Tabs } from 'nextra/components'",
      '',
      '# Mixed Page',
      '',
      'Intro paragraph.',
      '',
      '<Callout>',
      '  Warning message.',
      '</Callout>',
      '',
      '<Tabs items={["A", "B"]}>',
      '  <Tabs.Tab>',
      '    Tab A content.',
      '  </Tabs.Tab>',
      '  <Tabs.Tab>',
      '    Tab B content.',
      '  </Tabs.Tab>',
      '</Tabs>',
      '',
      '## Section Two',
      '',
      'Final paragraph.',
    ].join('\n');

    const filePath = writeMdxFile(docsDir, 'test-mixed/page.mdx', source);
    const result = await mdxToMarkdown(source, { docsDir, filePath });

    expect(result, 'should not be null').not.toBeNull();
    expect(
      (result ?? '').startsWith('Mixed component test page.'),
      'should start with frontmatter description'
    ).toBe(true);
    expect(result, 'should contain heading').toContain('Mixed Page');
    expect(result, 'should contain intro').toContain('Intro paragraph.');
    expect(result, 'should contain callout text').toContain('Warning message.');
    expect(result, 'should contain tab A').toContain('Tab A content.');
    expect(result, 'should contain tab B').toContain('Tab B content.');
    expect(result, 'should contain section heading').toContain('Section Two');
    expect(result, 'should contain final paragraph').toContain('Final paragraph.');
  });
});

/* ------------------------------------------------------------------ */
/*  unflattenTables                                                   */
/* ------------------------------------------------------------------ */

describe('unflattenTables', () => {
  it('test_unflattenTables_simple2Column_shouldRestoreRows', () => {
    const input = '\\| A | B | |---|---| | 1 | 2 |';
    const result = unflattenTables(input);

    const expected = [
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');

    expect(result, 'should produce a proper 2-column GFM table').toBe(expected);
  });

  it('test_unflattenTables_4ColumnWithMultipleBodyRows_shouldRestoreAll', () => {
    const input = '\\| Col1 | Col2 | Col3 | Col4 | |---|---|---|---| | a | b | c | d | | e | f | g | h |';
    const result = unflattenTables(input);

    const expected = [
      '| Col1 | Col2 | Col3 | Col4 |',
      '| --- | --- | --- | --- |',
      '| a | b | c | d |',
      '| e | f | g | h |',
    ].join('\n');

    expect(result, 'should produce a proper 4-column table with 2 body rows').toBe(expected);
  });

  it('test_unflattenTables_spacesInSeparator_shouldHandle', () => {
    const input = '\\| Name | Value | | --- | --- | | foo | bar |';
    const result = unflattenTables(input);

    const expected = [
      '| Name | Value |',
      '| --- | --- |',
      '| foo | bar |',
    ].join('\n');

    expect(result, 'should handle separators with spaces').toBe(expected);
  });

  it('test_unflattenTables_noLeadingBackslash_shouldStillWork', () => {
    // The regex also matches lines starting with | (no backslash)
    const input = '| A | B | |---|---| | 1 | 2 |';
    const result = unflattenTables(input);

    const expected = [
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');

    expect(result, 'should unflatten tables without leading backslash').toBe(expected);
  });

  it('test_unflattenTables_noSeparator_shouldReturnUnchanged', () => {
    const input = '\\| A | B | C |';
    const result = unflattenTables(input);

    expect(result, 'should pass through unchanged when no separator found').toBe(input);
  });

  it('test_unflattenTables_regularText_shouldReturnUnchanged', () => {
    const input = 'This is just a regular paragraph of text.';
    const result = unflattenTables(input);

    expect(result, 'should pass through non-table text unchanged').toBe(input);
  });

  it('test_unflattenTables_multiLineInput_shouldOnlyAffectTableLines', () => {
    const input = [
      'Some text before.',
      '',
      '\\| A | B | |---|---| | 1 | 2 |',
      '',
      'Some text after.',
    ].join('\n');

    const result = unflattenTables(input);

    expect(result, 'should contain text before').toContain('Some text before.');
    expect(result, 'should contain text after').toContain('Some text after.');
    expect(result, 'should contain unflattened table header').toContain('| A | B |');
    expect(result, 'should contain table separator').toContain('| --- | --- |');
    expect(result, 'should contain table body row').toContain('| 1 | 2 |');
    expect(result, 'should not contain the flattened original').not.toContain('\\|');
  });

  it('test_unflattenTables_cellsWithBackticks_shouldNotCountPipesInsideCode', () => {
    const input = '\\| Code | Desc | |---|---| | `a|b` | has pipe |';
    const result = unflattenTables(input);

    const expected = [
      '| Code | Desc |',
      '| --- | --- |',
      '| `a|b` | has pipe |',
    ].join('\n');

    expect(result, 'should not split on pipe inside backticks').toBe(expected);
  });

  it('test_unflattenTables_datadogLikeTable_shouldRestoreProperly', () => {
    const input = '\\| CloudFormation Parameter | Lambda Environment Variable | Value | Description | |---|---|---|---| | `ddUrl` | `DD_URL` | `<ingestion-url>` | The Grepr ingestion URL | | `ddPort` | `DD_PORT` | `443` | Port for HTTPS |';
    const result = unflattenTables(input);

    const lines = result.split('\n');
    expect(lines.length, 'should have 4 lines (header + sep + 2 body rows)').toBe(4);
    expect(lines[0], 'header should start and end with pipe').toMatch(/^\|.*\|$/);
    expect(lines[1], 'separator should be properly formatted').toBe('| --- | --- | --- | --- |');
    expect(lines[2], 'first body row should contain ddUrl').toContain('`ddUrl`');
    expect(lines[2], 'first body row should start with pipe').toMatch(/^\|/);
    expect(lines[3], 'second body row should contain ddPort').toContain('`ddPort`');
    expect(lines[3], 'second body row should start with pipe').toMatch(/^\|/);
  });

  it('test_unflattenTables_singleColumnSeparator_shouldReturnUnchanged', () => {
    // A separator with less than 2 columns should not be treated as a table
    const input = '\\| A | |---| | 1 |';
    const result = unflattenTables(input);

    expect(result, 'single column tables should pass through unchanged').toBe(input);
  });

  it('test_unflattenTables_bodyRowsOnly_noHeaderMismatch_shouldHandleGracefully', () => {
    // Empty header part (separator starts at the beginning)
    const input = '\\|---|---| | a | b |';
    const result = unflattenTables(input);

    // With no header row, the function should return the original line
    expect(result, 'should return original when no header rows found').toBe(input);
  });
});

/* ------------------------------------------------------------------ */
/*  unescapeMarkdown                                                  */
/* ------------------------------------------------------------------ */

describe('unescapeMarkdown', () => {
  it('test_unescapeMarkdown_escapedUnderscores_shouldRemoveBackslashes', () => {
    const input = 'DD\\_API\\_KEY';
    const result = unescapeMarkdown(input);

    expect(result, 'should unescape underscores').toBe('DD_API_KEY');
  });

  it('test_unescapeMarkdown_multipleEscapedUnderscores_shouldRemoveAll', () => {
    const input = 'Use `DD\\_API\\_KEY` and `DD\\_SITE` values from your account.';
    const result = unescapeMarkdown(input);

    expect(result, 'should unescape all underscores').toBe(
      'Use `DD_API_KEY` and `DD_SITE` values from your account.'
    );
  });

  it('test_unescapeMarkdown_noEscapes_shouldReturnUnchanged', () => {
    const input = 'Normal text without any escapes.';
    const result = unescapeMarkdown(input);

    expect(result, 'should pass through unchanged').toBe(input);
  });

  it('test_unescapeMarkdown_mixedContent_shouldOnlyUnescapeUnderscores', () => {
    const input = 'Set \\`DD\\_URL\\` to the endpoint.';
    const result = unescapeMarkdown(input);

    // Only \_ should be unescaped; other backslash sequences should be left alone
    expect(result, 'should only unescape underscores').toBe('Set \\`DD_URL\\` to the endpoint.');
  });

  it('test_unescapeMarkdown_emptyString_shouldReturnEmpty', () => {
    expect(unescapeMarkdown(''), 'should return empty string').toBe('');
  });
});

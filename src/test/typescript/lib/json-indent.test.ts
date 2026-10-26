import { describe, it, expect } from 'bun:test';
import { indentJsonText } from '../../../main/typescript/lib/json-indent.js';

describe('indentJsonText', () => {
  it.each([
    '{"items":[{"id":"a","n":1},{"id":"b","n":2}],"hasMore":false}',
    '[]',
    '{}',
    '{"a":{},"b":[],"c":[{}],"d":[[]]}',
    '  { "spaced" :  [ 1 , 2 ] ,\n "x" : null }  ',
    '{"quote":"say \\"hi\\" {not: [a, b]}","slash":"a\\\\","unicode":"é"}',
    '"just a string"',
    '42',
    'true',
    '[1,-2.5,true,false,null,"s"]',
    '{"deep":{"deeper":{"deepest":[1,{"k":"v"}]}}}',
  ])('test_indentJsonText_%s_matchesJsonStringify', (text) => {
    expect(indentJsonText(text)).toBe(JSON.stringify(JSON.parse(text), null, 2));
  });

  it('test_indentJsonText_int64AndDecimals_keepExactDigits', () => {
    const text = '{"timestampNanos":1234567890123456789,"ratio":1.0,"jobId":[9007199254740993,-9223372036854775808]}';

    expect(indentJsonText(text)).toBe([
      '{',
      '  "timestampNanos": 1234567890123456789,',
      '  "ratio": 1.0,',
      '  "jobId": [',
      '    9007199254740993,',
      '    -9223372036854775808',
      '  ]',
      '}',
    ].join('\n'));
  });

  it('test_indentJsonText_escapesAndExponents_areCopiedAsSent', () => {
    // JSON.stringify would rewrite both: \u00e9 to é and 3e10 to 30000000000.
    expect(indentJsonText('{"name":"caf\\u00e9","big":3e10}')).toBe('{\n  "name": "caf\\u00e9",\n  "big": 3e10\n}');
  });

  it('test_indentJsonText_duplicateKeys_areKept', () => {
    expect(indentJsonText('{"a":1,"a":2}')).toBe('{\n  "a": 1,\n  "a": 2\n}');
  });

  it('test_indentJsonText_customIndent_isUsed', () => {
    expect(indentJsonText('{"a":[1]}', 4)).toBe('{\n    "a": [\n        1\n    ]\n}');
  });
});

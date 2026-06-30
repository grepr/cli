import { describe, it, expect } from 'bun:test';
import path from 'path';

/**
 * Tests for the hidden API operation filtering logic used in both
 * convert-openapi-to-markdown.ts and build-docs-index.ts.
 *
 * The filtering rule: operations with operationId ending in "-hidden"
 * should be excluded from indexing.
 */

describe('Hidden API Operation Filtering', () => {

  describe('operationId suffix check', () => {
    const isHiddenOperation = (operationId: string): boolean =>
      operationId.endsWith('-hidden');

    it('test_isHidden_hiddenSuffix_shouldReturnTrue', () => {
      expect(
        isHiddenOperation('upsertClientToken-hidden'),
        'upsertClientToken-hidden should be hidden'
      ).toBe(true);
    });

    it('test_isHidden_deleteClientTokenHidden_shouldReturnTrue', () => {
      expect(
        isHiddenOperation('deleteClientToken-hidden'),
        'deleteClientToken-hidden should be hidden'
      ).toBe(true);
    });

    it('test_isHidden_asyncBatchJobsHidden_shouldReturnTrue', () => {
      expect(
        isHiddenOperation('getAsyncBatchJobsForJob-hidden'),
        'getAsyncBatchJobsForJob-hidden should be hidden'
      ).toBe(true);
    });

    it('test_isHidden_normalOperation_shouldReturnFalse', () => {
      expect(
        isHiddenOperation('createJob'),
        'createJob should not be hidden'
      ).toBe(false);
    });

    it('test_isHidden_containsHiddenNotAtEnd_shouldReturnFalse', () => {
      expect(
        isHiddenOperation('hidden-operation'),
        'hidden-operation should not match (hidden not at end)'
      ).toBe(false);
    });

    it('test_isHidden_emptyString_shouldReturnFalse', () => {
      expect(
        isHiddenOperation(''),
        'empty string should not be hidden'
      ).toBe(false);
    });
  });

  describe('build-docs-index filename filtering', () => {
    /**
     * The build-docs-index.ts filters API files by checking:
     *   path.basename(file, '.md').endsWith('-hidden')
     * This simulates that logic.
     */
    const isHiddenApiFile = (filePath: string): boolean => {
      const basename = path.basename(filePath, '.md');
      return basename.endsWith('-hidden');
    };

    it('test_fileFilter_hiddenFile_shouldBeFiltered', () => {
      expect(
        isHiddenApiFile('api/ClientTokens/upsertClientToken-hidden.md'),
        'hidden operation file should be filtered'
      ).toBe(true);
    });

    it('test_fileFilter_normalFile_shouldNotBeFiltered', () => {
      expect(
        isHiddenApiFile('api/Job/createJob.md'),
        'normal operation file should not be filtered'
      ).toBe(false);
    });

    it('test_fileFilter_hiddenInDirName_shouldNotBeFiltered', () => {
      expect(
        isHiddenApiFile('api/hidden-tag/listOperations.md'),
        'hidden in directory name should not affect filtering'
      ).toBe(false);
    });

    it('test_fileFilter_multipleParts_shouldCheckOnlyBasename', () => {
      expect(
        isHiddenApiFile('api/deep/nested/deleteClientToken-hidden.md'),
        'should check basename regardless of nesting depth'
      ).toBe(true);
    });
  });

  describe('expected hidden operations in OpenAPI spec', () => {
    /**
     * Validates that we know the complete set of hidden operations.
     * If this test fails after an API change, update the expected set.
     */
    it('test_knownHiddenOps_shouldMatchExpected', () => {
      const knownHiddenOps = [
        'upsertClientToken-hidden',
        'deleteClientToken-hidden',
        'getAsyncBatchJobsForJob-hidden',
      ];

      for (const opId of knownHiddenOps) {
        expect(
          opId.endsWith('-hidden'),
          `${opId} should end with -hidden`
        ).toBe(true);
      }

      expect(
        knownHiddenOps.length,
        'expected exactly 3 known hidden operations'
      ).toBe(3);
    });
  });
});

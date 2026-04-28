import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getWaPhoneLookupVariants,
  normalizeWaPhoneForStorage,
} = require('../server/utils/phoneNormalization');

test('normalizeWaPhoneForStorage prefixes US local 10 digit numbers', () => {
  assert.equal(normalizeWaPhoneForStorage('(410) 801-0355'), '14108010355');
  assert.equal(normalizeWaPhoneForStorage('4108010355'), '14108010355');
  assert.equal(normalizeWaPhoneForStorage('+1 (410) 801-0355'), '14108010355');
});

test('normalizeWaPhoneForStorage preserves existing international prefixes', () => {
  assert.equal(normalizeWaPhoneForStorage('+86 177 4433 5037'), '8617744335037');
  assert.equal(normalizeWaPhoneForStorage('+852 5555 0001'), '85255550001');
});

test('getWaPhoneLookupVariants matches canonical US and old local forms', () => {
  assert.deepEqual(getWaPhoneLookupVariants('(410) 801-0355'), ['14108010355', '4108010355']);
  assert.deepEqual(getWaPhoneLookupVariants('14108010355'), ['14108010355', '4108010355']);
});

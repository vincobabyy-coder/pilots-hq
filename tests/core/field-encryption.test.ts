import { describe, it, expect } from '../runner'
import { encryptField, decryptField, getEncryptionKey } from '../../core/crypto/field-encryption'
import { randomBytes } from 'crypto'

const TEST_KEY = randomBytes(32)

describe('FieldEncryption', () => {
  it('encrypts and decrypts a string round-trip', () => {
    const plaintext = 'super-secret-api-key-123'
    const encrypted = encryptField(plaintext, TEST_KEY)
    const decrypted = decryptField(encrypted, TEST_KEY)
    expect(decrypted).toBe(plaintext)
  })

  it('produces dot-separated 3-part output', () => {
    const encrypted = encryptField('hello', TEST_KEY)
    const parts = encrypted.split('.')
    expect(parts).toHaveLength(3)
    // Each part should be non-empty base64url
    expect(parts[0].length > 0).toBe(true)
    expect(parts[1].length > 0).toBe(true)
    expect(parts[2].length > 0).toBe(true)
  })

  it('uses a different IV each time (two encryptions differ)', () => {
    const plaintext = 'same-plaintext'
    const enc1 = encryptField(plaintext, TEST_KEY)
    const enc2 = encryptField(plaintext, TEST_KEY)
    expect(enc1 !== enc2).toBe(true)
  })

  it('both still decrypt to the same plaintext', () => {
    const plaintext = 'same-plaintext'
    const enc1 = encryptField(plaintext, TEST_KEY)
    const enc2 = encryptField(plaintext, TEST_KEY)
    expect(decryptField(enc1, TEST_KEY)).toBe(plaintext)
    expect(decryptField(enc2, TEST_KEY)).toBe(plaintext)
  })

  it('throws on tampered ciphertext (GCM auth tag mismatch)', () => {
    const encrypted = encryptField('value', TEST_KEY)
    const parts = encrypted.split('.')
    // Corrupt the ciphertext part
    const tampered = parts[0] + '.' + parts[1].slice(0, -2) + 'AA' + '.' + parts[2]
    expect(() => decryptField(tampered, TEST_KEY)).toThrow()
  })

  it('throws on malformed input (wrong number of parts)', () => {
    expect(() => decryptField('onlytwoparts.here', TEST_KEY)).toThrow('3 parts')
  })

  it('throws if key is not 32 bytes', () => {
    const shortKey = randomBytes(16)
    expect(() => encryptField('value', shortKey)).toThrow('32 bytes')
    expect(() => decryptField('a.b.c', shortKey)).toThrow('32 bytes')
  })

  it('getEncryptionKey throws if ENCRYPTION_KEY env var is missing', () => {
    const original = process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY
    expect(() => getEncryptionKey()).toThrow('ENCRYPTION_KEY')
    if (original !== undefined) process.env.ENCRYPTION_KEY = original
  })

  it('getEncryptionKey returns 32-byte buffer when env var is valid', () => {
    const original = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex')
    const key = getEncryptionKey()
    expect(key.length).toBe(32)
    process.env.ENCRYPTION_KEY = original
  })

  it('getEncryptionKey throws if ENCRYPTION_KEY is wrong length', () => {
    const original = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = 'tooshort'
    expect(() => getEncryptionKey()).toThrow('64-character')
    if (original !== undefined) process.env.ENCRYPTION_KEY = original
    else delete process.env.ENCRYPTION_KEY
  })

  it('handles unicode plaintext correctly', () => {
    const unicode = 'webhook-sécrét-🔑-naïve'
    const encrypted = encryptField(unicode, TEST_KEY)
    const decrypted = decryptField(encrypted, TEST_KEY)
    expect(decrypted).toBe(unicode)
  })
})

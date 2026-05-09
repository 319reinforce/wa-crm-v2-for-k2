import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Phase 1: aiProvidersRouter is mounted under /api/admin exactly once', async () => {
  const source = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8')
  const mounts = source.match(/app\.use\('\/api\/admin',\s*aiProvidersRouter\);/g) || []
  assert.equal(mounts.length, 1)
})

test('Phase 1: WAMessageComposer message cache is bounded and pruned', async () => {
  const source = await readFile(new URL('../src/components/WAMessageComposer.jsx', import.meta.url), 'utf8')
  assert.match(source, /const MESSAGES_CACHE_MAX_ENTRIES\s*=\s*\d+;/)
  assert.match(source, /function pruneMessagesCache\(/)
  assert.match(source, /messagesCache\.size\s*-\s*MESSAGES_CACHE_MAX_ENTRIES/)
  assert.match(source, /sort\(\(a,\s*b\)\s*=>\s*\(a\[1\]\?\.ts \|\| 0\)\s*-\s*\(b\[1\]\?\.ts \|\| 0\)\)/)
  assert.match(source, /pruneMessagesCache\(\);/)
})

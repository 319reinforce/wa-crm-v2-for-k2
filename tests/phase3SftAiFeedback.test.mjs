import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function readRepoFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8')
}

test('SFTDashboard uses a cached aggregate evaluation request instead of five tab fetches', () => {
  const source = readRepoFile('src/components/SFTDashboard.jsx')
  assert.match(source, /sftDashboardRequestCache/)
  assert.match(source, /loadSftRequest\('evaluation:summary:v1'/)
  assert.match(source, /generation-log\/evaluation-summary\?days=7&hours=24&limit=20/)
  assert.doesNotMatch(source, /Promise\.all\(\[\s*[\s\S]*ab-evaluation[\s\S]*generation-log\/stats[\s\S]*generation-log\/recent[\s\S]*rag-observation[\s\S]*rag-sources/)
})

test('AI generation exposes staged progress and final provider metadata to the reply deck', () => {
  const routerSource = readRepoFile('src/components/WAMessageComposer/ai/experienceRouter.js')
  const composerSource = readRepoFile('src/components/WAMessageComposer.jsx')
  const pickerSource = readRepoFile('src/components/AIReplyPicker.jsx')

  assert.match(routerSource, /onProgress\?\.\(\{ stage: 'preparing'/)
  assert.match(routerSource, /stage: 'fallback'/)
  assert.match(routerSource, /setTimeout\(\(\) => \{\s*onProgress\?\.\(\{\s*stage: 'fallback'/)
  assert.match(routerSource, /AbortSignal\.timeout\(60000\)/)
  assert.match(routerSource, /error\?\.name === 'TimeoutError'/)
  assert.match(routerSource, /stage: 'failed'/)
  assert.match(routerSource, /provider: data\.provider \|\| null/)
  assert.match(composerSource, /const \[aiProgress, setAiProgress\]/)
  assert.match(composerSource, /onProgress: reportAiProgress/)
  assert.match(pickerSource, /aiProgressText/)
  assert.match(pickerSource, /aiProviderMeta/)
})

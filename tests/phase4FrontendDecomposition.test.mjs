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

test('Phase 4 extracts resize and kanban implementations out of App shell', () => {
  const appSource = readRepoFile('src/App.jsx')
  const resizeHook = readRepoFile('src/hooks/useResizablePanelWidths.js')
  const ownerTransferHook = readRepoFile('src/hooks/useOwnerTransfer.js')
  const kanbanSource = readRepoFile('src/components/KanbanView.jsx')

  assert.match(appSource, /useResizablePanelWidths/)
  assert.match(appSource, /useOwnerTransfer/)
  assert.match(appSource, /import KanbanView from '\.\/components\/KanbanView'/)
  assert.match(appSource, /ContactManagementPage/)
  assert.doesNotMatch(appSource, /function KanbanView\(/)
  assert.doesNotMatch(appSource, /function KanbanCard\(/)
  assert.doesNotMatch(appSource, /function ContactManagementPage\(/)
  assert.doesNotMatch(appSource, /function ManualCreatorModal\(/)
  assert.doesNotMatch(appSource, /function BulkImportSection\(/)
  assert.doesNotMatch(appSource, /setOwnerTransfer(Preview|Loading|Executing|Error)/)
  assert.match(resizeHook, /localStorage\.setItem\(storageKey/)
  assert.match(ownerTransferHook, /operator-roster\/transfer-preview/)
  assert.match(ownerTransferHook, /operator-roster\/transfer/)
  assert.match(kanbanSource, /role="list"/)
  assert.match(kanbanSource, /type="button"/)
})

test('Phase 4 standardizes panel error surfaces and keyboard access for event cards', () => {
  const feedbackSource = readRepoFile('src/components/common/PanelFeedback.jsx')
  const sftSource = readRepoFile('src/components/SFTDashboard.jsx')
  const eventSource = readRepoFile('src/components/EventPanel.jsx')

  assert.match(feedbackSource, /export function PanelError/)
  assert.match(feedbackSource, /role="alert"/)
  assert.match(sftSource, /<PanelError/)
  assert.match(eventSource, /<PanelError/)
  assert.match(eventSource, /<PanelLoading/)
  assert.match(eventSource, /<PanelEmpty/)
  assert.match(eventSource, /onKeyDown=\{\(e\) =>/)
  assert.match(eventSource, /aria-pressed=\{isSelected\}/)
  assert.match(readRepoFile('src/components/ContactManagementPage.jsx'), /role="dialog" aria-modal="true"/)
  assert.match(readRepoFile('src/components/ContactManagementPage.jsx'), /event\.key === 'Escape'/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const audit = require('../server/middleware/audit')
const db = require('../db')

function createReq() {
  return {
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    get(name) {
      return String(name || '').toLowerCase() === 'user-agent' ? 'audit-test-agent' : ''
    },
  }
}

async function withDbStub(stubDb, fn) {
  const originalGetDb = db.getDb
  db.getDb = () => stubDb
  try {
    await fn()
  } finally {
    db.getDb = originalGetDb
  }
}

test('sanitizeAuditValue redacts nested client identifiers recursively', () => {
  const payload = {
    client_id: '15550001111',
    nested: {
      wa_phone: '+1 (555) 000-2222',
      token: 'secret-token',
      records: [
        { phone: '+1 555 000 3333' },
        { meta: { record_id: '15550004444', password: 'hidden' } },
      ],
    },
  }

  assert.deepEqual(audit.sanitizeAuditValue(payload), {
    client_id: '[REDACTED]',
    nested: {
      wa_phone: '[REDACTED]',
      token: '[REDACTED]',
      records: [
        { phone: '[REDACTED]' },
        { meta: { record_id: '[REDACTED]', password: '[REDACTED]' } },
      ],
    },
  })
})

test('writeAudit redacts phone-like record_id and nested client ids before insert', async () => {
  audit._private.resetAuditRecordIdSupportCache()
  let capturedInsertArgs = null
  const stubDb = {
    prepare(sql) {
      if (sql.includes("SHOW COLUMNS FROM audit_log LIKE 'record_id'")) {
        return {
          async get() {
            return { Type: 'varchar(64)' }
          },
        }
      }
      if (sql.includes('INSERT INTO audit_log')) {
        return {
          async run(...args) {
            capturedInsertArgs = args
            return { changes: 1 }
          },
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  await withDbStub(stubDb, async () => {
    await audit.writeAudit(
      'client_profile_update',
      'client_profiles',
      '15550001111',
      {
        client_id: '15550001111',
        nested: [{ wa_phone: '+1 555 000 2222' }],
      },
      {
        details: {
          client_id: '15550003333',
          record_id: '15550004444',
        },
      },
      createReq(),
    )
  })

  // INSERT 参数顺序:
  // 0 action, 1 table_name, 2 record_id,
  // 3 operator, 4 user_id, 5 user_role, 6 auth_source, 7 token_principal,
  // 8 before_value, 9 after_value, 10 ip_address, 11 user_agent
  assert.equal(capturedInsertArgs[2], '[REDACTED]')
  assert.deepEqual(JSON.parse(capturedInsertArgs[8]), {
    client_id: '[REDACTED]',
    nested: [{ wa_phone: '[REDACTED]' }],
  })
  assert.deepEqual(JSON.parse(capturedInsertArgs[9]), {
    details: {
      client_id: '[REDACTED]',
      record_id: '[REDACTED]',
    },
  })
})

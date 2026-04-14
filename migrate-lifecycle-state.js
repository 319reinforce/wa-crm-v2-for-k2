require('dotenv').config();
const db = require('./db');
const {
    buildDefaultPayload,
    DEFAULT_POLICY_KEY,
} = require('./server/services/lifecycleConfigService');
const {
    rebuildLifecycleBatch,
} = require('./server/services/lifecyclePersistenceService');

const args = new Set(process.argv.slice(2));
const shouldBackfill = args.has('--backfill');

async function runStep(label, fn) {
    process.stdout.write(`${label}... `);
    await fn();
    console.log('OK');
}

async function ensureLifecyclePolicy(dbConn) {
    const payload = buildDefaultPayload();
    await dbConn.prepare(`
        INSERT INTO policy_documents (
            policy_key,
            policy_version,
            policy_content,
            applicable_scenarios,
            is_active
        ) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            updated_at = CURRENT_TIMESTAMP
    `).run(
        DEFAULT_POLICY_KEY,
        payload.policy_version,
        JSON.stringify({ config: payload.config }),
        JSON.stringify(payload.applicable_scenarios),
        payload.is_active ? 1 : 0,
    );
}

async function main() {
    const dbConn = db.getDb();
    console.log('=== Lifecycle State Migration ===');
    console.log(`backfill: ${shouldBackfill ? 'enabled' : 'disabled'}`);

    await runStep('[1/6] create creator_lifecycle_snapshot', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS creator_lifecycle_snapshot (
                creator_id           INT PRIMARY KEY,
                stage_key            VARCHAR(32) NOT NULL,
                stage_label          VARCHAR(64) NOT NULL,
                entry_reason         TEXT,
                entry_signals_json   JSON,
                flags_json           JSON,
                conflicts_json       JSON,
                option0_key          VARCHAR(64),
                option0_label        VARCHAR(128),
                option0_next_action  TEXT,
                snapshot_version     VARCHAR(32) NOT NULL DEFAULT 'lifecycle_v2',
                trigger_type         VARCHAR(64),
                trigger_id           VARCHAR(64),
                evaluated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_lifecycle_snapshot_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    await runStep('[2/6] create lifecycle snapshot indexes', async () => {
        await dbConn.prepare('CREATE INDEX idx_lifecycle_snapshot_stage ON creator_lifecycle_snapshot(stage_key)').run()
            .catch((err) => { if (!String(err?.message || '').includes('Duplicate key name')) throw err; });
        await dbConn.prepare('CREATE INDEX idx_lifecycle_snapshot_evaluated ON creator_lifecycle_snapshot(evaluated_at)').run()
            .catch((err) => { if (!String(err?.message || '').includes('Duplicate key name')) throw err; });
    });

    await runStep('[3/6] create creator_lifecycle_transition', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS creator_lifecycle_transition (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                creator_id          INT NOT NULL,
                from_stage          VARCHAR(32),
                to_stage            VARCHAR(32) NOT NULL,
                trigger_type        VARCHAR(64),
                trigger_id          VARCHAR(64),
                trigger_source      VARCHAR(64),
                reason              TEXT,
                signals_json        JSON,
                flags_json          JSON,
                operator            VARCHAR(64),
                created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_lifecycle_transition_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    await runStep('[4/6] create transition indexes', async () => {
        await dbConn.prepare('CREATE INDEX idx_lifecycle_transition_creator_time ON creator_lifecycle_transition(creator_id, created_at DESC)').run()
            .catch((err) => { if (!String(err?.message || '').includes('Duplicate key name')) throw err; });
    });

    await runStep('[5/6] normalize event status + seed lifecycle policy', async () => {
        await dbConn.prepare(`
            ALTER TABLE events
            MODIFY COLUMN status VARCHAR(16) DEFAULT 'draft' COMMENT "'draft'|'active'|'completed'|'cancelled'"
        `).run().catch((err) => {
            const message = String(err?.message || '');
            if (!message.includes('Unknown table') && !message.includes("doesn't exist")) throw err;
        });
        await dbConn.prepare(`UPDATE events SET status = 'draft' WHERE status = 'pending'`).run()
            .catch((err) => {
                const message = String(err?.message || '');
                if (!message.includes('Unknown table') && !message.includes("doesn't exist")) throw err;
            });
        await ensureLifecyclePolicy(dbConn);
    });

    await runStep('[6/6] verify counts', async () => {
        const snapshotCount = await dbConn.prepare('SELECT COUNT(*) AS count FROM creator_lifecycle_snapshot').get();
        const transitionCount = await dbConn.prepare('SELECT COUNT(*) AS count FROM creator_lifecycle_transition').get();
        console.log(`\n    snapshot rows: ${snapshotCount?.count || 0}`);
        console.log(`    transition rows: ${transitionCount?.count || 0}`);
    });

    if (shouldBackfill) {
        console.log('\n[backfill] rebuilding lifecycle snapshots...');
        const results = await rebuildLifecycleBatch(dbConn, {
            reason: 'migration_backfill',
            operator: 'system',
            writeSnapshot: true,
            writeTransition: true,
        });
        console.log(`[backfill] processed creators: ${results.length}`);
    } else {
        console.log('\nbackfill skipped. run `npm run lifecycle:backfill` when you are ready to persist current stages.');
    }
}

main()
    .catch((err) => {
        console.error('\nLifecycle migration failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb();
    });

function assertSafeIdentifier(value, kind = 'identifier') {
    const text = String(value || '').trim();
    if (!/^[A-Za-z0-9_]+$/.test(text)) {
        throw new Error(`Unsafe ${kind}: ${text || '(empty)'}`);
    }
    return text;
}

async function tableExists(dbConn, tableName) {
    const safeTable = assertSafeIdentifier(tableName, 'table name');
    const row = await dbConn.prepare(`SHOW TABLES LIKE ?`).get(safeTable);
    return !!row;
}

async function columnExists(dbConn, tableName, columnName) {
    const safeTable = assertSafeIdentifier(tableName, 'table name');
    const safeColumn = assertSafeIdentifier(columnName, 'column name');
    const row = await dbConn.prepare(`SHOW COLUMNS FROM ${safeTable} LIKE ?`).get(safeColumn);
    return !!row;
}

async function assertManagedSchemaReady(dbConn, {
    tables = [],
    columns = {},
    migration = 'schema.sql',
    feature = 'Managed schema',
} = {}) {
    const missing = [];

    for (const tableName of tables) {
        if (!(await tableExists(dbConn, tableName))) {
            missing.push(tableName);
        }
    }

    for (const [tableName, requiredColumns] of Object.entries(columns || {})) {
        const safeTable = assertSafeIdentifier(tableName, 'table name');
        if (missing.includes(safeTable)) continue;
        for (const columnName of requiredColumns || []) {
            if (!(await columnExists(dbConn, safeTable, columnName))) {
                missing.push(`${safeTable}.${columnName}`);
            }
        }
    }

    if (missing.length > 0) {
        throw new Error(`${feature} schema is missing ${missing.join(', ')}; run ${migration}`);
    }
}

module.exports = {
    assertManagedSchemaReady,
    tableExists,
    columnExists,
};

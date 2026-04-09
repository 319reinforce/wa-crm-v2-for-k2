---
name: build-and-test
description: "Build the WhatsApp CRM project and run tests, reporting results"
user-invocable: true
allowed-tools: Bash, Read, Grep
context: fork
---

# Build and Test Skill

Builds the Node.js/Express backend and tests the React frontend for the WhatsApp CRM v2 project.

## Project Paths
- **Project Root**: `/Users/depp/wa-bot/wa-crm-v2/`
- **Backend**: `server.js`, `db.js`, `routes/`
- **Frontend**: `src/` (React)
- **Database**: `crm.db`, `schema.sql`

## Build Steps

### Backend Build
```bash
cd /Users/depp/wa-bot/wa-crm-v2
node --check server.js 2>&1 || echo "Syntax errors found"
node --check db.js 2>&1 || echo "Syntax errors found"
```

### Dependencies Check
```bash
cd /Users/depp/wa-bot/wa-crm-v2
npm list --depth=0 2>&1 | head -20
```

### Database Validation
```bash
cd /Users/depp/wa-bot/wa-crm-v2
sqlite3 crm.db ".schema" 2>&1 | head -50
```

## Test Execution

Run backend tests if they exist:
```bash
cd /Users/depp/wa-bot/wa-crm-v2
npm test 2>&1 || echo "No tests configured"
```

## Output Format

Report findings in this format:
```
## Build Report

### Backend Check
- [PASS/FAIL] server.js syntax
- [PASS/FAIL] db.js syntax

### Dependencies
- [LIST] Installed packages

### Database
- [PASS/FAIL] Schema validation
- [LIST] Tables found

### Tests
- [PASS/FAIL] Test suite

### Overall Status
**READY** / **ISSUES FOUND**
```

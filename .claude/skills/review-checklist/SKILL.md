---
name: review-checklist
description: "Generate a code review checklist for WhatsApp CRM changes"
user-invocable: true
allowed-tools: Read, Grep, Glob
context: fork
---

# Code Review Checklist

Generate a domain-specific code review checklist for Node.js/Express/React changes in the WhatsApp CRM project.

## Checklist Categories

### Security
- [ ] All SQL queries use prepared statements
- [ ] User input is validated before processing
- [ ] No sensitive data in logs or error messages
- [ ] Authentication/authorization properly checked
- [ ] CORS configuration is appropriate

### Correctness
- [ ] API endpoints return proper HTTP status codes
- [ ] Error responses follow consistent format
- [ ] All required fields are validated
- [ ] Edge cases are handled
- [ ] Database transactions used for multi-step operations

### Performance
- [ ] No N+1 query patterns
- [ ] Appropriate indexes on frequently queried columns
- [ ] Large data operations are paginated
- [ ] No blocking operations in request handlers

### Code Quality
- [ ] Consistent naming conventions (snake_case tables, camelCase variables)
- [ ] No duplicate code
- [ ] Functions are small and focused
- [ ] Error messages are descriptive
- [ ] No commented-out debug code

### React Specific
- [ ] Components are functional with hooks
- [ ] Props are validated
- [ ] Loading and error states are handled
- [ ] No unnecessary re-renders (React.memo where appropriate)
- [ ] API calls have cleanup (abort on unmount)

## Usage

Run against modified files:
```bash
git diff --name-only
```

Generate checklist for specific file:
```bash
grep -n "TODO\|FIXME\|BUG" /path/to/file
```

## Output

Return the checklist with items marked based on code inspection:
```
## Review Checklist

### Security
- [x] Prepared statements
- [ ] Input validation (MISSING in line 42)

### Correctness
- [x] HTTP status codes
- [x] Error format

...
```

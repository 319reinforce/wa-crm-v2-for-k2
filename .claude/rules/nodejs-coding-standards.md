# Node.js / Express Coding Standards

## Naming Conventions

### Files
- Backend utilities: `camelCase.js` (e.g., `dbHelper.js`)
- React components: `PascalCase.jsx` (e.g., `Dashboard.jsx`)
- Configuration: `kebab-case.json` (e.g., `app-config.json`)
- Database schema: `snake_case.sql` (e.g., `schema.sql`)

### Variables and Functions
- Variables: `camelCase` (e.g., `userName`, `isActive`)
- Functions: `camelCase` (e.g., `getUserById`, `handleSubmit`)
- Classes: `PascalCase` (e.g., `DatabaseHelper`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_COUNT`)

### Database
- Tables: `snake_case`, singular (e.g., `client_profile`)
- Columns: `snake_case` (e.g., `created_at`)
- Primary keys: `id` (integer)
- Foreign keys: `table_name_id` (e.g., `client_id`)

### API Endpoints
- Use kebab-case: `/client-profiles`, `/sft-feedback`
- Resource nouns, not verbs: `/clients` not `/get-clients`

## Code Organization

### Express Project Structure
```
server.js           # Main app entry
db.js               # Database connection
schema.sql          # Database schema
routes/             # API route handlers
  ├── index.js      # Route aggregator
  ├── clients.js    # Client endpoints
  └── messages.js   # Message endpoints
middleware/         # Express middleware
  ├── auth.js       # Authentication
  ├── errorHandler.js
  └── validator.js
```

### React Project Structure
```
src/
  ├── components/   # Reusable components
  ├── pages/       # Page components
  ├── hooks/       # Custom hooks
  ├── api/         # API client functions
  └── utils/       # Utility functions
```

## Error Handling

### Backend
```javascript
// Always use try-catch for async operations
try {
  const result = await someAsyncOperation();
  res.json(result);
} catch (error) {
  console.error('Operation failed:', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
}

// For sync operations
router.get('/endpoint', (req, res) => {
  try {
    // operation
  } catch (error) {
    // handle error
  }
});
```

### Error Response Format
```javascript
{
  error: {
    code: 'ERROR_CODE',        // Machine-readable
    message: 'Human message'  // User-friendly
  }
}
```

## Database Operations

### Prepared Statements (REQUIRED)
```javascript
// GOOD
const stmt = db.prepare('SELECT * FROM clients WHERE id = ?');
const client = stmt.get(id);

// BAD - SQL injection risk
const client = db.prepare(`SELECT * FROM clients WHERE id = ${id}`).get();
```

### Transactions
```javascript
const transaction = db.transaction(() => {
  stmt1.run(param1);
  stmt2.run(param2);
});
transaction();
```

## Testing Requirements

### Backend
- Test all API endpoints
- Cover error cases
- Use integration tests for database operations

### Frontend
- Component tests for critical UI
- Test user interactions
- Verify loading/error states

## Performance Guidelines

1. Use pagination for list endpoints (default 20-100 items)
2. Index frequently queried columns
3. Avoid N+1 queries - use JOINs or batch operations
4. Cache expensive operations when appropriate
5. Use database transactions for related operations

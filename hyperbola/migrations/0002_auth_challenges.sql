CREATE TABLE IF NOT EXISTS auth_challenges (nonce TEXT PRIMARY KEY, account_id TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL);

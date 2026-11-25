import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

const directory = process.env.EXPAND_DATA ?? './data';
mkdirSync(directory, { recursive: true });
export const db = new DatabaseSync(directory + '/expand.sqlite');
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS members
    (id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, name TEXT NOT NULL, handle TEXT UNIQUE NOT NULL);
  CREATE TABLE IF NOT EXISTS access_keys
    (member TEXT PRIMARY KEY REFERENCES members(id), hash TEXT UNIQUE NOT NULL);
  CREATE TABLE IF NOT EXISTS device_sessions
    (token TEXT PRIMARY KEY, member TEXT NOT NULL REFERENCES members(id));
  CREATE INDEX IF NOT EXISTS device_sessions_member ON device_sessions(member);
  CREATE TABLE IF NOT EXISTS circle (
    id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, description TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS administrators
    (member TEXT PRIMARY KEY REFERENCES members(id));
  CREATE TABLE IF NOT EXISTS invite_history (
    id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL,
    created INTEGER NOT NULL, expires INTEGER NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0, used INTEGER, revoked INTEGER
  );
  CREATE TABLE IF NOT EXISTS member_bios
    (member TEXT PRIMARY KEY REFERENCES members(id), bio TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS follows
    (follower TEXT NOT NULL REFERENCES members(id), followed TEXT NOT NULL REFERENCES members(id),
     CHECK (follower <> followed), PRIMARY KEY (follower, followed));
  CREATE TABLE IF NOT EXISTS changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
    parent TEXT REFERENCES changes(id), member TEXT NOT NULL REFERENCES members(id), content TEXT NOT NULL
  );
`);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const memberId = () => 'm-' + randomUUID();
export const now = () => Math.floor(Date.now() / 1000);
export function transaction(run) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = run(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function createInvite(label = '', admin = false) {
  const code = secret();
  const id = randomUUID();
  const created = now();
  const expires = created + 86400;
  transaction(() => {
    db.prepare('INSERT INTO invites VALUES (?,?)').run(hash(code), expires);
    db.prepare('INSERT INTO invite_history(id,hash,label,created,expires,admin) VALUES (?,?,?,?,?,?)')
      .run(id, hash(code), label, created, expires, Number(admin));
  });
  return { id, code, label, created, expires };
}

import { randomBytes } from "node:crypto";
import { sql } from "./db";

/**
 * Repository helpers for the community forum.
 *
 * All timestamps returned from these helpers are unix milliseconds so the
 * server-rendered UI can format them with `Date` directly. Postgres stores the
 * underlying columns as `timestamptz` (see `supabase/migrations/0003_forum.sql`).
 */

export interface ThreadSummary {
  id: string;
  user_id: string;
  author_email: string;
  title: string;
  body: string;
  created_at: number;
  last_reply_at: number;
  reply_count: number;
}

export interface Thread extends ThreadSummary {}

export interface Reply {
  id: string;
  thread_id: string;
  user_id: string;
  author_email: string;
  body: string;
  created_at: number;
}

interface RawThread {
  id: string;
  user_id: string;
  author_email: string;
  title: string;
  body: string;
  created_at: Date | string;
  last_reply_at: Date | string;
  reply_count: number | string;
}

interface RawReply {
  id: string;
  thread_id: string;
  user_id: string;
  author_email: string;
  body: string;
  created_at: Date | string;
}

function toMillis(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

function toInt(value: number | string): number {
  return typeof value === "string" ? Number.parseInt(value, 10) : value;
}

function mapThread(row: RawThread): ThreadSummary {
  return {
    id: row.id,
    user_id: row.user_id,
    author_email: row.author_email,
    title: row.title,
    body: row.body,
    created_at: toMillis(row.created_at),
    last_reply_at: toMillis(row.last_reply_at),
    reply_count: toInt(row.reply_count),
  };
}

function mapReply(row: RawReply): Reply {
  return {
    id: row.id,
    thread_id: row.thread_id,
    user_id: row.user_id,
    author_email: row.author_email,
    body: row.body,
    created_at: toMillis(row.created_at),
  };
}

export function newThreadId(): string {
  return `thr_${randomBytes(16).toString("hex")}`;
}

export function newReplyId(): string {
  return `rep_${randomBytes(16).toString("hex")}`;
}

/**
 * Page through threads by `last_reply_at`. `before` is the unix-ms cursor of
 * the last item from the previous page; pass `undefined` for the first page.
 */
export async function listThreads(
  limit: number,
  before?: number,
): Promise<ThreadSummary[]> {
  const cappedLimit = Math.min(Math.max(limit, 1), 100);
  // Two queries to keep the SQL trivially typed; postgres.js doesn't compose
  // `WHERE` fragments as smoothly as raw template strings.
  const rows = before === undefined
    ? await sql()<RawThread[]>`
        SELECT t.id, t.user_id, u.email AS author_email, t.title, t.body,
               t.created_at, t.last_reply_at, t.reply_count
        FROM forum_threads t
        JOIN users u ON u.id = t.user_id
        ORDER BY t.last_reply_at DESC
        LIMIT ${cappedLimit}
      `
    : await sql()<RawThread[]>`
        SELECT t.id, t.user_id, u.email AS author_email, t.title, t.body,
               t.created_at, t.last_reply_at, t.reply_count
        FROM forum_threads t
        JOIN users u ON u.id = t.user_id
        WHERE t.last_reply_at < to_timestamp(${before / 1000})
        ORDER BY t.last_reply_at DESC
        LIMIT ${cappedLimit}
      `;
  return rows.map(mapThread);
}

export async function getThread(id: string): Promise<Thread | null> {
  const rows = await sql()<RawThread[]>`
    SELECT t.id, t.user_id, u.email AS author_email, t.title, t.body,
           t.created_at, t.last_reply_at, t.reply_count
    FROM forum_threads t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = ${id}
  `;
  const row = rows[0];
  return row ? mapThread(row) : null;
}

export async function listReplies(threadId: string): Promise<Reply[]> {
  const rows = await sql()<RawReply[]>`
    SELECT r.id, r.thread_id, r.user_id, u.email AS author_email, r.body,
           r.created_at
    FROM forum_replies r
    JOIN users u ON u.id = r.user_id
    WHERE r.thread_id = ${threadId}
    ORDER BY r.created_at ASC
  `;
  return rows.map(mapReply);
}

export interface CreateThreadInput {
  userId: string;
  title: string;
  body: string;
}

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  const id = newThreadId();
  const rows = await sql()<RawThread[]>`
    WITH inserted AS (
      INSERT INTO forum_threads (id, user_id, title, body)
      VALUES (${id}, ${input.userId}, ${input.title}, ${input.body})
      RETURNING *
    )
    SELECT i.id, i.user_id, u.email AS author_email, i.title, i.body,
           i.created_at, i.last_reply_at, i.reply_count
    FROM inserted i
    JOIN users u ON u.id = i.user_id
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("createThread: insert returned no rows");
  }
  return mapThread(row);
}

export interface CreateReplyInput {
  userId: string;
  threadId: string;
  body: string;
}

export async function createReply(input: CreateReplyInput): Promise<Reply> {
  const id = newReplyId();
  // Single round-trip: insert reply, bump thread counters, and join the
  // author email back in. The transaction guarantees `reply_count` cannot
  // drift from the row count under concurrent writes.
  const rows = await sql().begin<RawReply[]>(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO forum_replies (id, thread_id, user_id, body)
      VALUES (${id}, ${input.threadId}, ${input.userId}, ${input.body})
      RETURNING id
    `;
    const replyRow = inserted[0];
    if (!replyRow) {
      throw new Error("createReply: insert returned no rows");
    }
    await tx`
      UPDATE forum_threads
      SET reply_count = reply_count + 1,
          last_reply_at = now()
      WHERE id = ${input.threadId}
    `;
    const joined = await tx<RawReply[]>`
      SELECT r.id, r.thread_id, r.user_id, u.email AS author_email, r.body,
             r.created_at
      FROM forum_replies r
      JOIN users u ON u.id = r.user_id
      WHERE r.id = ${replyRow.id}
    `;
    return joined;
  });
  const row = rows[0];
  if (!row) {
    throw new Error("createReply: join returned no rows");
  }
  return mapReply(row);
}

import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { intervalsOverlap, SLOT_LOCK_DURATION_MS } from "@smile/shared";
import { RedisService } from "../../infra/redis.service";

export interface SlotLockRecord {
  lockId: string;
  clinicId: string;
  dateKey: string;
  dentistId: string;
  chairId: string;
  startTimeUtc: number;
  bufferEndTimeUtc: number;
  lockedBySessionId: string;
  expiresAtUtc: number;
}

/**
 * Atomic Redis Lua script for interval-aware dual-resource slot locking:
 *   1. Purges expired entries from `slot_locks:{clinicId}:{dateKey}`.
 *   2. Releases any previous lock held by the same `sessionId`.
 *   3. Checks half-open interval overlap [start, bufferEnd) for BOTH dentistId and chairId.
 *   4. Writes the new lock and refreshes TTL only if zero overlaps exist.
 */
const ACQUIRE_INTERVAL_LOCK_LUA = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local lockId = ARGV[2]
local dentistId = ARGV[3]
local chairId = ARGV[4]
local startUtc = tonumber(ARGV[5])
local bufferEndUtc = tonumber(ARGV[6])
local sessionId = ARGV[7]
local expiresAtUtc = tonumber(ARGV[8])
local payload = ARGV[9]

local entries = redis.call('HGETALL', key)
local toDelete = {}

for i = 1, #entries, 2 do
  local field = entries[i]
  local raw = entries[i + 1]
  local ok, item = pcall(cjson.decode, raw)
  if (not ok) or (not item) or (tonumber(item.expiresAtUtc or 0) <= nowMs) then
    table.insert(toDelete, field)
  elseif item.lockedBySessionId == sessionId then
    table.insert(toDelete, field)
  else
    local sameResource = (item.dentistId == dentistId) or (item.chairId == chairId)
    local overlaps = (tonumber(item.startTimeUtc) < bufferEndUtc) and (tonumber(item.bufferEndTimeUtc) > startUtc)
    if sameResource and overlaps then
      if #toDelete > 0 then
        redis.call('HDEL', key, unpack(toDelete))
      end
      return {'CONFLICT', field}
    end
  end
end

if #toDelete > 0 then
  redis.call('HDEL', key, unpack(toDelete))
end

redis.call('HSET', key, lockId, payload)
redis.call('EXPIRE', key, 3600)
return {'OK', lockId}
`;

const RELEASE_SESSION_LOCKS_LUA = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local sessionId = ARGV[2]
local entries = redis.call('HGETALL', key)
local toDelete = {}
local released = 0

for i = 1, #entries, 2 do
  local field = entries[i]
  local raw = entries[i + 1]
  local ok, item = pcall(cjson.decode, raw)
  if (not ok) or (not item) or (tonumber(item.expiresAtUtc or 0) <= nowMs) then
    table.insert(toDelete, field)
  elseif item.lockedBySessionId == sessionId then
    table.insert(toDelete, field)
    released = released + 1
  end
end

if #toDelete > 0 then
  redis.call('HDEL', key, unpack(toDelete))
end
return released
`;

@Injectable()
export class SlotLockService {
  /** Fallback in-memory lock table when REDIS_URL is unconfigured (tests/offline dev). */
  private readonly memoryBuckets = new Map<string, Map<string, SlotLockRecord>>();

  private readonly logger = new Logger(SlotLockService.name);

  constructor(private readonly redisService: RedisService) {}

  private bucketKey(clinicId: string, dateKey: string): string {
    return `slot_locks:${clinicId}:${dateKey}`;
  }

  private async getReadyRedis() {
    const client = this.redisService.getClient();
    if (!client) return null;
    try {
      if (client.status === "wait" || client.status === "end") {
        await client.connect();
      }
      if (client.status === "ready" || client.status === "connect") {
        return client;
      }
      return null;
    } catch {
      return null;
    }
  }

  async listActiveLocks(
    clinicId: string,
    dateKey: string,
    nowMs: number = Date.now()
  ): Promise<SlotLockRecord[]> {
    const key = this.bucketKey(clinicId, dateKey);
    const redis = await this.getReadyRedis();

    if (redis) {
      try {
        const rawMap = await redis.hgetall(key);
        const active: SlotLockRecord[] = [];
        for (const raw of Object.values(rawMap)) {
          try {
            const parsed = JSON.parse(raw) as SlotLockRecord;
            if (parsed.expiresAtUtc > nowMs) {
              active.push(parsed);
            }
          } catch {
            // Ignore corrupted entries
          }
        }
        return active;
      } catch (err) {
        this.logger.warn(
          `Redis hgetall failed for ${key}, falling back to memory locks: ${
            err instanceof Error ? err.message : "unknown"
          }`
        );
      }
    }

    const bucket = this.memoryBuckets.get(key);
    if (!bucket) return [];
    const active: SlotLockRecord[] = [];
    for (const [id, lock] of bucket.entries()) {
      if (lock.expiresAtUtc <= nowMs) {
        bucket.delete(id);
      } else {
        active.push(lock);
      }
    }
    return active;
  }

  async acquireAtomicIntervalLock(params: {
    clinicId: string;
    dateKey: string;
    dentistId: string;
    chairId: string;
    startTimeUtc: number;
    bufferEndTimeUtc: number;
    sessionId: string;
    nowMs?: number;
  }): Promise<{ ok: true; lock: SlotLockRecord } | { ok: false; conflictLockId: string }> {
    const nowMs = params.nowMs ?? Date.now();
    const lockId = randomUUID();
    const expiresAtUtc = nowMs + SLOT_LOCK_DURATION_MS;
    const record: SlotLockRecord = {
      lockId,
      clinicId: params.clinicId,
      dateKey: params.dateKey,
      dentistId: params.dentistId,
      chairId: params.chairId,
      startTimeUtc: params.startTimeUtc,
      bufferEndTimeUtc: params.bufferEndTimeUtc,
      lockedBySessionId: params.sessionId,
      expiresAtUtc,
    };

    const key = this.bucketKey(params.clinicId, params.dateKey);
    const redis = await this.getReadyRedis();

    if (redis) {
      try {
        const result = (await redis.eval(
          ACQUIRE_INTERVAL_LOCK_LUA,
          1,
          key,
          String(nowMs),
          lockId,
          params.dentistId,
          params.chairId,
          String(params.startTimeUtc),
          String(params.bufferEndTimeUtc),
          params.sessionId,
          String(expiresAtUtc),
          JSON.stringify(record)
        )) as [string, string];

        if (result[0] === "CONFLICT") {
          return { ok: false, conflictLockId: result[1] };
        }
        return { ok: true, lock: record };
      } catch (err) {
        this.logger.warn(
          `Redis acquireAtomicIntervalLock failed for ${key}, falling back to memory locks: ${
            err instanceof Error ? err.message : "unknown"
          }`
        );
      }
    }

    // Synchronous single-threaded JS atomic fallback matching the exact Lua semantics
    let bucket = this.memoryBuckets.get(key);
    if (!bucket) {
      bucket = new Map();
      this.memoryBuckets.set(key, bucket);
    }

    const toDelete: string[] = [];
    for (const [id, item] of bucket.entries()) {
      if (item.expiresAtUtc <= nowMs || item.lockedBySessionId === params.sessionId) {
        toDelete.push(id);
      } else {
        const sameResource =
          item.dentistId === params.dentistId || item.chairId === params.chairId;
        const overlaps = intervalsOverlap(
          item.startTimeUtc,
          item.bufferEndTimeUtc,
          params.startTimeUtc,
          params.bufferEndTimeUtc
        );
        if (sameResource && overlaps) {
          for (const deadId of toDelete) bucket.delete(deadId);
          return { ok: false, conflictLockId: id };
        }
      }
    }

    for (const deadId of toDelete) bucket.delete(deadId);
    bucket.set(lockId, record);
    return { ok: true, lock: record };
  }

  async releaseSessionLocks(
    clinicId: string,
    dateKey: string,
    sessionId: string
  ): Promise<number> {
    const key = this.bucketKey(clinicId, dateKey);
    const nowMs = Date.now();
    const redis = await this.getReadyRedis();

    if (redis) {
      try {
        const released = await redis.eval(
          RELEASE_SESSION_LOCKS_LUA,
          1,
          key,
          String(nowMs),
          sessionId
        );
        return Number(released ?? 0);
      } catch (err) {
        this.logger.warn(
          `Redis releaseSessionLocks failed for ${key}, falling back to memory locks: ${
            err instanceof Error ? err.message : "unknown"
          }`
        );
      }
    }

    const bucket = this.memoryBuckets.get(key);
    if (!bucket) return 0;
    let released = 0;
    for (const [id, item] of bucket.entries()) {
      if (item.expiresAtUtc <= nowMs) {
        bucket.delete(id);
      } else if (item.lockedBySessionId === sessionId) {
        bucket.delete(id);
        released++;
      }
    }
    return released;
  }

  /** Helper for tests to clear in-memory fallback state between test cases. */
  clearMemoryLocks(): void {
    this.memoryBuckets.clear();
  }
}

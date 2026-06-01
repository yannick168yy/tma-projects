import type { Redis } from 'ioredis'
import { randomBytes } from 'node:crypto'

export type AdminJobType = 'games_sync' | 'games_translate'
export type AdminJobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface AdminJob {
  id: string
  type: AdminJobType
  status: AdminJobStatus
  progress: number
  total: number
  message: string
  result?: unknown
  error?: string
  createdAt: string
  updatedAt: string
}

const JOB_TTL_SEC = 86_400
const LOCK_TTL_SEC = 7_200

function jobKey(id: string) {
  return `admin:job:${id}`
}

function lockKey(type: AdminJobType) {
  return `admin:job:lock:${type}`
}

function newJobId(): string {
  return `job_${Date.now()}_${randomBytes(4).toString('hex')}`
}

export async function getActiveJobForType(redis: Redis, type: AdminJobType): Promise<AdminJob | null> {
  const jobId = await redis.get(lockKey(type))
  if (!jobId) return null
  const job = await getJob(redis, jobId)
  if (!job || job.status === 'done' || job.status === 'failed') {
    await redis.del(lockKey(type))
    return null
  }
  return job
}

export async function createJob(redis: Redis, type: AdminJobType): Promise<AdminJob> {
  const locked = await redis.set(lockKey(type), 'pending', 'EX', LOCK_TTL_SEC, 'NX')
  if (!locked) {
    const active = await getActiveJobForType(redis, type)
    if (active) return active
    throw new Error('Another job is starting, please retry')
  }

  const now = new Date().toISOString()
  const job: AdminJob = {
    id: newJobId(),
    type,
    status: 'pending',
    progress: 0,
    total: 0,
    message: '排队中…',
    createdAt: now,
    updatedAt: now,
  }
  await redis.set(jobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SEC)
  await redis.set(lockKey(type), job.id, 'EX', LOCK_TTL_SEC)
  return job
}

export async function getJob(redis: Redis, id: string): Promise<AdminJob | null> {
  const raw = await redis.get(jobKey(id))
  if (!raw) return null
  return JSON.parse(raw) as AdminJob
}

async function saveJob(redis: Redis, job: AdminJob): Promise<void> {
  job.updatedAt = new Date().toISOString()
  await redis.set(jobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SEC)
}

export async function updateJobProgress(
  redis: Redis,
  id: string,
  patch: Partial<Pick<AdminJob, 'progress' | 'total' | 'message' | 'status'>>,
): Promise<void> {
  const job = await getJob(redis, id)
  if (!job) return
  Object.assign(job, patch)
  if (patch.status === 'running' && job.status !== 'running') {
    job.status = 'running'
  }
  await saveJob(redis, job)
}

export async function completeJob(redis: Redis, id: string, result: unknown): Promise<void> {
  const job = await getJob(redis, id)
  if (!job) return
  job.status = 'done'
  job.result = result
  job.message = '完成'
  await saveJob(redis, job)
  await redis.del(lockKey(job.type))
}

export async function failJob(redis: Redis, id: string, error: string): Promise<void> {
  const job = await getJob(redis, id)
  if (!job) return
  job.status = 'failed'
  job.error = error
  job.message = error
  await saveJob(redis, job)
  await redis.del(lockKey(job.type))
}

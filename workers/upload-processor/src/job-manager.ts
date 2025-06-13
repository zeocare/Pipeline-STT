export interface JobManagerConfig {
  kv: KVNamespace
}

export interface CreateJobParams {
  filename: string
  fileSize: number
  contentType: string
  options: ProcessingOptions
  clientInfo: ClientInfo
}

export interface ProcessingOptions {
  language: string
  speakers?: number | null
  minSpeakers?: number | null
  maxSpeakers?: number | null
  format: string
  enhancedAccuracy: boolean
}

export interface ClientInfo {
  userAgent: string
  ip: string
  country: string
}

export interface Job {
  id: string
  status: JobStatus
  filename: string
  fileSize: number
  contentType: string
  options: ProcessingOptions
  clientInfo: ClientInfo
  created: string
  updated: string
  chunks?: any[]
  estimatedTime?: number
  progress?: number
  error?: string
  results?: any
}

export type JobStatus = 
  | 'created'
  | 'chunks_created'
  | 'transcribing'
  | 'processing_ner'
  | 'completed'
  | 'failed'

export class JobManager {
  private kv: KVNamespace

  constructor(config: JobManagerConfig) {
    this.kv = config.kv
  }

  async createJob(params: CreateJobParams): Promise<string> {
    const jobId = this.generateJobId()
    const now = new Date().toISOString()

    const job: Job = {
      id: jobId,
      status: 'created',
      filename: params.filename,
      fileSize: params.fileSize,
      contentType: params.contentType,
      options: params.options,
      clientInfo: params.clientInfo,
      created: now,
      updated: now,
      progress: 0
    }

    // Store job with 7 days TTL
    await this.kv.put(
      `job:${jobId}`,
      JSON.stringify(job),
      { expirationTtl: 7 * 24 * 60 * 60 } // 7 days
    )

    // Store in job index for listing/cleanup
    await this.addToJobIndex(jobId, now)

    console.log('Job created:', jobId)
    return jobId
  }

  async updateJob(jobId: string, updates: Partial<Job>): Promise<void> {
    const job = await this.getJob(jobId)
    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    const updatedJob: Job = {
      ...job,
      ...updates,
      updated: new Date().toISOString()
    }

    await this.kv.put(
      `job:${jobId}`,
      JSON.stringify(updatedJob),
      { expirationTtl: 7 * 24 * 60 * 60 }
    )

    console.log('Job updated:', jobId, 'Status:', updatedJob.status)
  }

  async getJob(jobId: string): Promise<Job | null> {
    const jobData = await this.kv.get(`job:${jobId}`)
    if (!jobData) {
      return null
    }

    try {
      return JSON.parse(jobData) as Job
    } catch (error) {
      console.error('Failed to parse job data:', error)
      return null
    }
  }

  async markJobCompleted(jobId: string, results: any): Promise<void> {
    await this.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      results
    })
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    await this.updateJob(jobId, {
      status: 'failed',
      error
    })
  }

  async getJobsByStatus(status: JobStatus): Promise<Job[]> {
    // In production, you'd implement proper indexing
    // For now, this is a simplified version
    const jobs: Job[] = []
    
    // List all job keys (this is expensive, use proper indexing in production)
    const list = await this.kv.list({ prefix: 'job:' })
    
    for (const key of list.keys) {
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job && job.status === status) {
        jobs.push(job)
      }
    }
    
    return jobs
  }

  async cleanupExpiredJobs(): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 7) // 7 days ago
    
    let deletedCount = 0
    const list = await this.kv.list({ prefix: 'job:' })
    
    for (const key of list.keys) {
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job && new Date(job.created) < cutoffDate) {
        await this.kv.delete(key.name)
        deletedCount++
      }
    }
    
    console.log(`Cleaned up ${deletedCount} expired jobs`)
    return deletedCount
  }

  private generateJobId(): string {
    // Generate a unique job ID
    const timestamp = Date.now().toString(36)
    const randomPart = Math.random().toString(36).substring(2, 15)
    return `stt_${timestamp}_${randomPart}`
  }

  private async addToJobIndex(jobId: string, timestamp: string): Promise<void> {
    // Maintain an index for efficient querying
    const indexKey = `index:jobs:${timestamp.substring(0, 10)}` // Group by date
    
    try {
      const existingIndex = await this.kv.get(indexKey)
      const jobs = existingIndex ? JSON.parse(existingIndex) : []
      
      jobs.push({
        id: jobId,
        timestamp
      })
      
      await this.kv.put(
        indexKey,
        JSON.stringify(jobs),
        { expirationTtl: 8 * 24 * 60 * 60 } // 8 days (longer than jobs)
      )
    } catch (error) {
      console.error('Failed to update job index:', error)
      // Don't fail the job creation if indexing fails
    }
  }

  // Analytics and monitoring
  async getJobStats(): Promise<JobStats> {
    const stats: JobStats = {
      total: 0,
      byStatus: {
        created: 0,
        chunks_created: 0,
        transcribing: 0,
        processing_ner: 0,
        completed: 0,
        failed: 0
      },
      averageProcessingTime: 0,
      successRate: 0
    }

    // This is simplified - in production, use proper analytics
    const list = await this.kv.list({ prefix: 'job:' })
    const jobs: Job[] = []
    
    for (const key of list.keys.slice(0, 100)) { // Limit for performance
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job) {
        jobs.push(job)
      }
    }

    stats.total = jobs.length
    
    for (const job of jobs) {
      stats.byStatus[job.status]++
    }

    const completedJobs = jobs.filter(j => j.status === 'completed')
    const failedJobs = jobs.filter(j => j.status === 'failed')
    
    stats.successRate = jobs.length > 0 
      ? completedJobs.length / (completedJobs.length + failedJobs.length) 
      : 0

    // Calculate average processing time
    const processingTimes = completedJobs
      .map(job => {
        const created = new Date(job.created).getTime()
        const updated = new Date(job.updated).getTime()
        return updated - created
      })
      .filter(time => time > 0)

    stats.averageProcessingTime = processingTimes.length > 0
      ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length / 1000 // Convert to seconds
      : 0

    return stats
  }
}

export interface JobStats {
  total: number
  byStatus: Record<JobStatus, number>
  averageProcessingTime: number // in seconds
  successRate: number // 0-1
}
// Shared job manager - same as upload worker but with transcription-specific methods
export interface JobManagerConfig {
  kv: KVNamespace
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
  transcriptionResults?: any[]
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
      { expirationTtl: 7 * 24 * 60 * 60 } // 7 days
    )

    console.log('Job updated:', jobId, 'Status:', updatedJob.status, 'Progress:', updatedJob.progress)
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    await this.updateJob(jobId, {
      status: 'failed',
      error,
      progress: 0
    })
    
    console.error('Job marked as failed:', jobId, 'Error:', error)
  }

  async saveTranscriptionResults(jobId: string, transcriptionResults: any[]): Promise<void> {
    await this.updateJob(jobId, {
      transcriptionResults,
      progress: 90 // 90% complete after transcription
    })
  }

  async getJobsInProgress(): Promise<Job[]> {
    const jobs: Job[] = []
    
    // Get jobs that are currently being transcribed
    const list = await this.kv.list({ prefix: 'job:' })
    
    for (const key of list.keys.slice(0, 50)) { // Limit for performance
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job && job.status === 'transcribing') {
        jobs.push(job)
      }
    }
    
    return jobs
  }

  async getTranscriptionStats(): Promise<TranscriptionStats> {
    const stats: TranscriptionStats = {
      totalJobs: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
      averageProcessingTime: 0,
      averageConfidence: 0
    }

    const list = await this.kv.list({ prefix: 'job:' })
    const jobs: Job[] = []
    
    for (const key of list.keys.slice(0, 100)) { // Limit for performance
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job) {
        jobs.push(job)
      }
    }

    stats.totalJobs = jobs.length
    stats.inProgress = jobs.filter(j => j.status === 'transcribing').length
    stats.completed = jobs.filter(j => j.status === 'completed').length
    stats.failed = jobs.filter(j => j.status === 'failed').length

    // Calculate average processing time for completed jobs
    const completedJobs = jobs.filter(j => j.status === 'completed' && j.transcriptionResults)
    if (completedJobs.length > 0) {
      const processingTimes = completedJobs.map(job => {
        const created = new Date(job.created).getTime()
        const updated = new Date(job.updated).getTime()
        return updated - created
      })
      
      stats.averageProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length / 1000
      
      // Calculate average confidence
      const confidences = completedJobs
        .map(job => job.transcriptionResults?.reduce((sum: number, result: any) => sum + (result.confidence || 0), 0) / (job.transcriptionResults?.length || 1))
        .filter(conf => conf > 0)
      
      if (confidences.length > 0) {
        stats.averageConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length
      }
    }

    return stats
  }

  // Cleanup methods for maintenance
  async cleanupFailedJobs(olderThanHours: number = 24): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setHours(cutoffDate.getHours() - olderThanHours)
    
    let cleanedCount = 0
    const list = await this.kv.list({ prefix: 'job:' })
    
    for (const key of list.keys) {
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job && 
          job.status === 'failed' && 
          new Date(job.updated) < cutoffDate) {
        await this.kv.delete(key.name)
        cleanedCount++
      }
    }
    
    console.log(`Cleaned up ${cleanedCount} failed jobs older than ${olderThanHours} hours`)
    return cleanedCount
  }

  async retryFailedJobs(limit: number = 10): Promise<string[]> {
    const retriedJobs: string[] = []
    const failedJobs = await this.getJobsByStatus('failed')
    
    for (const job of failedJobs.slice(0, limit)) {
      // Reset status to allow retry
      await this.updateJob(job.id, {
        status: 'chunks_created',
        progress: 0,
        error: undefined
      })
      
      retriedJobs.push(job.id)
    }
    
    return retriedJobs
  }

  private async getJobsByStatus(status: JobStatus): Promise<Job[]> {
    const jobs: Job[] = []
    const list = await this.kv.list({ prefix: 'job:' })
    
    for (const key of list.keys) {
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job && job.status === status) {
        jobs.push(job)
      }
    }
    
    return jobs
  }
}

export interface TranscriptionStats {
  totalJobs: number
  inProgress: number
  completed: number
  failed: number
  averageProcessingTime: number // in seconds
  averageConfidence: number // 0-1
}
// Shared job manager for assembly-ner worker
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

  async markJobCompleted(jobId: string, results: any): Promise<void> {
    await this.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      results
    })
    
    console.log('Job marked as completed:', jobId)
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    await this.updateJob(jobId, {
      status: 'failed',
      error,
      progress: 0
    })
    
    console.error('Job marked as failed:', jobId, 'Error:', error)
  }

  async getJobsInProgress(): Promise<Job[]> {
    const jobs: Job[] = []
    
    // Get jobs that are currently being processed
    const list = await this.kv.list({ prefix: 'job:' })
    
    for (const key of list.keys.slice(0, 50)) { // Limit for performance
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job && job.status === 'processing_ner') {
        jobs.push(job)
      }
    }
    
    return jobs
  }

  async getProcessingStats(): Promise<ProcessingStats> {
    const stats: ProcessingStats = {
      totalJobs: 0,
      byStatus: {
        created: 0,
        chunks_created: 0,
        transcribing: 0,
        processing_ner: 0,
        completed: 0,
        failed: 0
      },
      averageProcessingTime: 0,
      successRate: 0,
      averageEntitiesExtracted: 0,
      popularEntityTypes: {}
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
    
    // Count by status
    for (const job of jobs) {
      stats.byStatus[job.status]++
    }

    const completedJobs = jobs.filter(j => j.status === 'completed')
    const failedJobs = jobs.filter(j => j.status === 'failed')
    
    // Calculate success rate
    const finishedJobs = completedJobs.length + failedJobs.length
    stats.successRate = finishedJobs > 0 ? completedJobs.length / finishedJobs : 0

    // Calculate average processing time for completed jobs
    if (completedJobs.length > 0) {
      const processingTimes = completedJobs.map(job => {
        const created = new Date(job.created).getTime()
        const updated = new Date(job.updated).getTime()
        return updated - created
      })
      
      stats.averageProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length / 1000

      // Calculate entity extraction stats
      const entityCounts = completedJobs
        .map(job => job.results?.entity_counts?.total_entities || 0)
        .filter(count => count > 0)
      
      if (entityCounts.length > 0) {
        stats.averageEntitiesExtracted = entityCounts.reduce((sum, count) => sum + count, 0) / entityCounts.length
      }

      // Popular entity types
      const entityTypeStats: Record<string, number> = {}
      for (const job of completedJobs) {
        if (job.results?.entity_counts) {
          for (const [type, count] of Object.entries(job.results.entity_counts)) {
            if (type !== 'total_entities') {
              entityTypeStats[type] = (entityTypeStats[type] || 0) + (count as number)
            }
          }
        }
      }
      
      stats.popularEntityTypes = entityTypeStats
    }

    return stats
  }

  // Cleanup and maintenance methods
  async cleanupCompletedJobs(olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)
    
    let cleanedCount = 0
    const list = await this.kv.list({ prefix: 'job:' })
    
    for (const key of list.keys) {
      const job = await this.getJob(key.name.replace('job:', ''))
      if (job && 
          job.status === 'completed' && 
          new Date(job.created) < cutoffDate) {
        await this.kv.delete(key.name)
        cleanedCount++
      }
    }
    
    console.log(`Cleaned up ${cleanedCount} completed jobs older than ${olderThanDays} days`)
    return cleanedCount
  }

  async getJobMetrics(jobId: string): Promise<JobMetrics | null> {
    const job = await this.getJob(jobId)
    if (!job || job.status !== 'completed') {
      return null
    }

    const metrics: JobMetrics = {
      jobId,
      processingTime: 0,
      entitiesExtracted: 0,
      entityBreakdown: {},
      transcriptionQuality: 0,
      speakerAccuracy: 0,
      medicalTermsFound: 0
    }

    if (job.results) {
      // Calculate processing time
      const created = new Date(job.created).getTime()
      const completed = new Date(job.updated).getTime()
      metrics.processingTime = (completed - created) / 1000

      // Entity metrics
      if (job.results.entity_counts) {
        metrics.entitiesExtracted = job.results.entity_counts.total_entities || 0
        metrics.entityBreakdown = { ...job.results.entity_counts }
        delete metrics.entityBreakdown.total_entities
      }

      // Quality metrics
      metrics.transcriptionQuality = job.results.processing?.confidence || 0
      metrics.speakerAccuracy = this.calculateSpeakerAccuracy(job.results)
      metrics.medicalTermsFound = this.countMedicalTerms(job.results)
    }

    return metrics
  }

  private calculateSpeakerAccuracy(results: any): number {
    // Simple heuristic: if we have clear speaker separation, accuracy is higher
    if (!results.transcript?.speakers) return 0

    const speakerCount = results.transcript.speakers.length
    const segments = results.transcript.segments || []
    
    if (segments.length === 0) return 0

    // Calculate speaker distribution
    const speakerSegmentCounts: Record<string, number> = {}
    for (const segment of segments) {
      speakerSegmentCounts[segment.speakerId] = (speakerSegmentCounts[segment.speakerId] || 0) + 1
    }

    // If distribution is roughly even, accuracy is higher
    const avgSegmentsPerSpeaker = segments.length / speakerCount
    const variance = Object.values(speakerSegmentCounts)
      .reduce((sum, count) => sum + Math.pow(count - avgSegmentsPerSpeaker, 2), 0) / speakerCount

    // Lower variance = higher accuracy (normalized to 0-1)
    return Math.max(0, 1 - (variance / avgSegmentsPerSpeaker))
  }

  private countMedicalTerms(results: any): number {
    if (!results.medical_entities) return 0

    return Object.values(results.medical_entities)
      .flat()
      .length
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

export interface ProcessingStats {
  totalJobs: number
  byStatus: Record<JobStatus, number>
  averageProcessingTime: number // in seconds
  successRate: number // 0-1
  averageEntitiesExtracted: number
  popularEntityTypes: Record<string, number>
}

export interface JobMetrics {
  jobId: string
  processingTime: number // in seconds
  entitiesExtracted: number
  entityBreakdown: Record<string, number>
  transcriptionQuality: number // 0-1
  speakerAccuracy: number // 0-1
  medicalTermsFound: number
}
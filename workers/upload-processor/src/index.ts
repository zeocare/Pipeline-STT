import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { timing } from 'hono/timing'
import { AudioProcessor } from './audio-processor'
import { JobManager } from './job-manager'
import { ValidationError, ProcessingError } from './errors'

type Bindings = {
  STT_JOBS: KVNamespace
  AUDIO_STORAGE: R2Bucket
  ENVIRONMENT: string
  MAX_FILE_SIZE_MB: string
  CHUNK_SIZE_MB: string
  SUPPORTED_FORMATS: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use('*', logger())
app.use('*', timing())
app.use('*', cors({
  origin: ['https://stt-pipeline.voitherbrazil.com', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}))

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'stt-upload-processor',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT
  })
})

// Upload and process audio
app.post('/upload', async (c) => {
  const startTime = Date.now()
  
  try {
    // Validate request
    const contentType = c.req.header('content-type')
    if (!contentType?.includes('multipart/form-data')) {
      throw new ValidationError('Content-Type must be multipart/form-data')
    }

    // Parse form data
    const formData = await c.req.formData()
    const audioFile = formData.get('audio') as File
    const optionsStr = formData.get('options') as string

    if (!audioFile) {
      throw new ValidationError('No audio file provided')
    }

    // Parse options
    const options = optionsStr ? JSON.parse(optionsStr) : {}
    const processingOptions = {
      language: options.language || 'pt',
      speakers: options.speakers || null,
      minSpeakers: options.minSpeakers || null,
      maxSpeakers: options.maxSpeakers || null,
      format: options.format || 'json',
      enhancedAccuracy: options.enhancedAccuracy || true
    }

    // Initialize processors
    const audioProcessor = new AudioProcessor({
      maxFileSizeMB: parseInt(c.env.MAX_FILE_SIZE_MB),
      chunkSizeMB: parseInt(c.env.CHUNK_SIZE_MB),
      supportedFormats: c.env.SUPPORTED_FORMATS.split(','),
      storage: c.env.AUDIO_STORAGE
    })

    const jobManager = new JobManager({
      kv: c.env.STT_JOBS
    })

    // Create job
    const jobId = await jobManager.createJob({
      filename: audioFile.name,
      fileSize: audioFile.size,
      contentType: audioFile.type,
      options: processingOptions,
      clientInfo: {
        userAgent: c.req.header('user-agent') || '',
        ip: c.req.header('cf-connecting-ip') || '',
        country: c.req.header('cf-ipcountry') || ''
      }
    })

    // Process audio file
    const result = await audioProcessor.processUpload({
      file: audioFile,
      jobId,
      options: processingOptions
    })

    // Update job with processing results
    await jobManager.updateJob(jobId, {
      status: 'chunks_created',
      chunks: result.chunks,
      estimatedProcessingTime: result.estimatedTime,
      processingStarted: new Date().toISOString()
    })

    // Trigger next stage (transcription)
    await triggerTranscription(c.env, {
      jobId,
      chunks: result.chunks,
      options: processingOptions
    })

    const processingTime = Date.now() - startTime

    return c.json({
      success: true,
      jobId,
      status: 'processing',
      chunks: result.chunks.length,
      estimatedTime: result.estimatedTime,
      processingTime,
      message: 'Audio uploaded and chunked successfully'
    })

  } catch (error) {
    console.error('Upload processing error:', error)
    
    if (error instanceof ValidationError) {
      return c.json({
        success: false,
        error: 'validation_error',
        message: error.message
      }, 400)
    }
    
    if (error instanceof ProcessingError) {
      return c.json({
        success: false,
        error: 'processing_error', 
        message: error.message
      }, 422)
    }

    return c.json({
      success: false,
      error: 'internal_error',
      message: 'An unexpected error occurred'
    }, 500)
  }
})

// Get job status
app.get('/status/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId')
    const jobManager = new JobManager({ kv: c.env.STT_JOBS })
    
    const job = await jobManager.getJob(jobId)
    if (!job) {
      return c.json({
        success: false,
        error: 'job_not_found',
        message: 'Job not found'
      }, 404)
    }

    return c.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress || 0,
        created: job.created,
        updated: job.updated,
        estimatedTime: job.estimatedTime,
        error: job.error
      }
    })

  } catch (error) {
    console.error('Status check error:', error)
    return c.json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get job status'
    }, 500)
  }
})

// Trigger transcription in next worker with retry logic
async function triggerTranscription(env: Bindings, payload: {
  jobId: string
  chunks: any[]
  options: any
}) {
  const maxRetries = 3
  const transcriptionWorkerUrl = `https://stt-transcription-engine.${env.ENVIRONMENT === 'development' ? 'dev.voitherbrazil' : 'voitherbrazil'}.workers.dev`
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${transcriptionWorkerUrl}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.INTER_WORKER_TOKEN}`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000) // 30s timeout
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Transcription trigger failed: ${response.status} - ${errorText}`)
      }

      console.log('Transcription triggered successfully for job:', payload.jobId)
      return // Success, exit retry loop
      
    } catch (error) {
      console.error(`Transcription trigger attempt ${attempt} failed:`, error)
      
      if (attempt === maxRetries) {
        throw error // Final attempt failed
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
    }
  }
}
}

export default app
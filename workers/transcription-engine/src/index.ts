import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { timing } from 'hono/timing'
import { TranscriptionEngine } from './transcription-engine'
import { JobManager } from './job-manager'
import { validateInterWorkerAuth } from './auth'

type Bindings = {
  STT_JOBS: KVNamespace
  AUDIO_STORAGE: R2Bucket
  AZURE_OPENAI_API_KEY: string
  INTER_WORKER_TOKEN: string
  AZURE_OPENAI_ENDPOINT: string
  AZURE_OPENAI_API_VERSION: string
  WHISPER_MODEL: string
  MAX_RETRIES: string
  TIMEOUT_MS: string
  ENVIRONMENT: string
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
    service: 'stt-transcription-engine',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT
  })
})

// Process transcription job (called by upload worker)
app.post('/process', async (c) => {
  const startTime = Date.now()

  try {
    // Validate inter-worker authentication
    const authResult = validateInterWorkerAuth(c, c.env.INTER_WORKER_TOKEN)
    if (!authResult.valid) {
      return c.json({
        success: false,
        error: 'unauthorized',
        message: 'Invalid authentication'
      }, 401)
    }

    // Parse request
    const payload = await c.req.json()
    const { jobId, chunks, options } = payload

    if (!jobId || !chunks || !Array.isArray(chunks)) {
      return c.json({
        success: false,
        error: 'invalid_payload',
        message: 'Missing required fields: jobId, chunks'
      }, 400)
    }

    // Initialize services
    const jobManager = new JobManager({ kv: c.env.STT_JOBS })
    const transcriptionEngine = new TranscriptionEngine({
      azureOpenAI: {
        apiKey: c.env.AZURE_OPENAI_API_KEY,
        endpoint: c.env.AZURE_OPENAI_ENDPOINT,
        apiVersion: c.env.AZURE_OPENAI_API_VERSION,
        model: c.env.WHISPER_MODEL
      },
      storage: c.env.AUDIO_STORAGE,
      maxRetries: parseInt(c.env.MAX_RETRIES),
      timeoutMs: parseInt(c.env.TIMEOUT_MS)
    })

    // Update job status
    await jobManager.updateJob(jobId, {
      status: 'transcribing',
      progress: 0
    })

    // Process chunks in parallel (with concurrency limit)
    const transcriptionResults = await transcriptionEngine.processChunks({
      jobId,
      chunks,
      options,
      onProgress: async (progress) => {
        await jobManager.updateJob(jobId, { progress })
      }
    })

    // Trigger assembly worker
    await triggerAssembly(c.env, {
      jobId,
      transcriptionResults,
      originalChunks: chunks,
      options
    })

    const processingTime = Date.now() - startTime

    return c.json({
      success: true,
      jobId,
      chunksProcessed: transcriptionResults.length,
      processingTime,
      message: 'Transcription completed, starting assembly'
    })

  } catch (error) {
    console.error('Transcription processing error:', error)
    
    // Try to update job status to failed (using cached payload)  
    if (payload.jobId) {
      const jobManager = new JobManager({ kv: c.env.STT_JOBS })
      await jobManager.markJobFailed(payload.jobId, error instanceof Error ? error.message : 'Unknown error')
    }

    return c.json({
      success: false,
      error: 'processing_error',
      message: error instanceof Error ? error.message : 'Transcription failed'
    }, 500)
  }
})

// Get transcription status
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
      status: job.status,
      progress: job.progress || 0,
      error: job.error,
      updated: job.updated
    })

  } catch (error) {
    console.error('Status check error:', error)
    return c.json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get transcription status'
    }, 500)
  }
})

// Retry failed transcription
app.post('/retry/:jobId', async (c) => {
  try {
    // Validate authentication
    const authResult = validateInterWorkerAuth(c, c.env.INTER_WORKER_TOKEN)
    if (!authResult.valid) {
      return c.json({
        success: false,
        error: 'unauthorized',
        message: 'Invalid authentication'
      }, 401)
    }

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

    if (job.status !== 'failed') {
      return c.json({
        success: false,
        error: 'invalid_status',
        message: 'Job is not in failed status'
      }, 400)
    }

    // Reset job status and retry
    await jobManager.updateJob(jobId, {
      status: 'transcribing',
      progress: 0,
      error: undefined
    })

    // Re-trigger transcription
    const transcriptionEngine = new TranscriptionEngine({
      azureOpenAI: {
        apiKey: c.env.AZURE_OPENAI_API_KEY,
        endpoint: c.env.AZURE_OPENAI_ENDPOINT,
        apiVersion: c.env.AZURE_OPENAI_API_VERSION,
        model: c.env.WHISPER_MODEL
      },
      storage: c.env.AUDIO_STORAGE,
      maxRetries: parseInt(c.env.MAX_RETRIES),
      timeoutMs: parseInt(c.env.TIMEOUT_MS)
    })

    // Process chunks (assuming chunks are stored in job data)
    if (job.chunks) {
      const transcriptionResults = await transcriptionEngine.processChunks({
        jobId,
        chunks: job.chunks,
        options: job.options,
        onProgress: async (progress) => {
          await jobManager.updateJob(jobId, { progress })
        }
      })

      await triggerAssembly(c.env, {
        jobId,
        transcriptionResults,
        originalChunks: job.chunks,
        options: job.options
      })
    }

    return c.json({
      success: true,
      message: 'Transcription retry initiated'
    })

  } catch (error) {
    console.error('Retry error:', error)
    return c.json({
      success: false,
      error: 'internal_error',
      message: 'Failed to retry transcription'
    }, 500)
  }
})

// Trigger assembly worker
async function triggerAssembly(env: Bindings, payload: {
  jobId: string
  transcriptionResults: any[]
  originalChunks: any[]
  options: any
}) {
  const maxRetries = 3
  const assemblyWorkerUrl = `https://stt-assembly-ner.${env.ENVIRONMENT === 'development' ? 'dev.voitherbrazil' : 'voitherbrazil'}.workers.dev`
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${assemblyWorkerUrl}/process`, {
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
        throw new Error(`Assembly trigger failed: ${response.status} - ${errorText}`)
      }

      console.log('Assembly triggered successfully for job:', payload.jobId)
      return // Success, exit retry loop
      
    } catch (error) {
      console.error(`Assembly trigger attempt ${attempt} failed:`, error)
      
      if (attempt === maxRetries) {
        throw error // Final attempt failed
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
    }
  }
}

export default app
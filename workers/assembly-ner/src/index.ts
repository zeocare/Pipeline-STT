import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { timing } from 'hono/timing'
import { AssemblyEngine } from './assembly-engine'
import { MedicalNER } from './medical-ner'
import { JobManager } from './job-manager'
import { ResultsStorage } from './results-storage'
import { validateInterWorkerAuth } from './auth'

type Bindings = {
  STT_JOBS: KVNamespace
  RESULTS_STORAGE: R2Bucket
  AZURE_AI_API_KEY: string
  OPENAI_API_KEY: string
  INTER_WORKER_TOKEN: string
  AZURE_AI_ENDPOINT: string
  AZURE_AI_API_VERSION: string
  OPENAI_API_ENDPOINT: string
  MAX_RETRIES: string
  TIMEOUT_MS: string
  ENVIRONMENT: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use('*', logger())
app.use('*', timing())
app.use('*', cors({
  origin: ['https://stt-pipeline.com', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}))

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'stt-assembly-ner',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT
  })
})

// Process assembly and NER (called by transcription worker)
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
    const { jobId, transcriptionResults, originalChunks, options } = payload

    if (!jobId || !transcriptionResults || !Array.isArray(transcriptionResults)) {
      return c.json({
        success: false,
        error: 'invalid_payload',
        message: 'Missing required fields: jobId, transcriptionResults'
      }, 400)
    }

    // Initialize services
    const jobManager = new JobManager({ kv: c.env.STT_JOBS })
    const assemblyEngine = new AssemblyEngine()
    const medicalNER = new MedicalNER({
      azureAI: {
        apiKey: c.env.AZURE_AI_API_KEY,
        endpoint: c.env.AZURE_AI_ENDPOINT,
        apiVersion: c.env.AZURE_AI_API_VERSION
      },
      openAI: {
        apiKey: c.env.OPENAI_API_KEY,
        endpoint: c.env.OPENAI_API_ENDPOINT
      },
      maxRetries: parseInt(c.env.MAX_RETRIES),
      timeoutMs: parseInt(c.env.TIMEOUT_MS)
    })
    const resultsStorage = new ResultsStorage({ storage: c.env.RESULTS_STORAGE })

    // Update job status
    await jobManager.updateJob(jobId, {
      status: 'processing_ner',
      progress: 90
    })

    console.log(`Starting assembly and NER for job ${jobId}`)

    // Step 1: Assemble transcription chunks into coherent transcript
    const assembledTranscript = await assemblyEngine.assembleTranscript({
      transcriptionResults,
      originalChunks,
      options
    })

    // Step 2: Perform Medical NER
    const medicalEntities = await medicalNER.extractMedicalEntities({
      transcript: assembledTranscript,
      language: options.language || 'pt'
    })

    // Step 3: Structure medical sections
    const structuredSections = await medicalNER.identifyMedicalSections({
      transcript: assembledTranscript,
      entities: medicalEntities,
      speakers: assembledTranscript.speakers
    })

    // Step 4: Generate final results in multiple formats
    const finalResults = await this.generateFinalResults({
      jobId,
      assembledTranscript,
      medicalEntities,
      structuredSections,
      options,
      originalMetadata: {
        filename: originalChunks[0]?.originalFilename || 'unknown',
        processingTime: Date.now() - startTime,
        chunksProcessed: transcriptionResults.length
      }
    })

    // Step 5: Store results
    const resultUrls = await resultsStorage.storeResults({
      jobId,
      results: finalResults
    })

    // Step 6: Mark job as completed
    await jobManager.markJobCompleted(jobId, {
      ...finalResults,
      downloadUrls: resultUrls,
      processingCompleted: new Date().toISOString()
    })

    const totalProcessingTime = Date.now() - startTime

    console.log(`Job ${jobId} completed successfully in ${totalProcessingTime}ms`)

    return c.json({
      success: true,
      jobId,
      processingTime: totalProcessingTime,
      results: {
        speakers: assembledTranscript.speakers.length,
        segments: assembledTranscript.segments.length,
        medicalEntities: Object.values(medicalEntities).flat().length,
        structuredSections: Object.keys(structuredSections).length,
        downloadUrls: resultUrls
      },
      message: 'Assembly and NER completed successfully'
    })

  } catch (error) {
    console.error('Assembly/NER processing error:', error)
    
    // Try to update job status to failed
    const payload = await c.req.json().catch(() => ({}))
    if (payload.jobId) {
      const jobManager = new JobManager({ kv: c.env.STT_JOBS })
      await jobManager.markJobFailed(
        payload.jobId, 
        error instanceof Error ? error.message : 'Assembly/NER failed'
      )
    }

    return c.json({
      success: false,
      error: 'processing_error',
      message: error instanceof Error ? error.message : 'Assembly/NER failed'
    }, 500)
  }
})

// Get results
app.get('/results/:jobId', async (c) => {
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

    if (job.status !== 'completed') {
      return c.json({
        success: false,
        error: 'job_not_completed',
        message: `Job status: ${job.status}`,
        progress: job.progress || 0
      }, 202) // Accepted but not ready
    }

    return c.json({
      success: true,
      results: job.results
    })

  } catch (error) {
    console.error('Results retrieval error:', error)
    return c.json({
      success: false,
      error: 'internal_error',
      message: 'Failed to retrieve results'
    }, 500)
  }
})

// Download specific format
app.get('/download/:jobId/:format', async (c) => {
  try {
    const jobId = c.req.param('jobId')
    const format = c.req.param('format')
    
    if (!['json', 'txt', 'srt', 'vtt', 'medical_json'].includes(format)) {
      return c.json({
        success: false,
        error: 'invalid_format',
        message: 'Supported formats: json, txt, srt, vtt, medical_json'
      }, 400)
    }

    const resultsStorage = new ResultsStorage({ storage: c.env.RESULTS_STORAGE })
    const fileContent = await resultsStorage.getResultFile(jobId, format)
    
    if (!fileContent) {
      return c.json({
        success: false,
        error: 'file_not_found',
        message: 'Result file not found'
      }, 404)
    }

    // Set appropriate content type and filename
    const contentTypes: Record<string, string> = {
      json: 'application/json',
      txt: 'text/plain',
      srt: 'text/plain',
      vtt: 'text/vtt',
      medical_json: 'application/json'
    }

    const headers = new Headers({
      'Content-Type': contentTypes[format],
      'Content-Disposition': `attachment; filename="${jobId}.${format}"`,
      'Cache-Control': 'max-age=3600'
    })

    return new Response(fileContent, { headers })

  } catch (error) {
    console.error('Download error:', error)
    return c.json({
      success: false,
      error: 'internal_error',
      message: 'Failed to download file'
    }, 500)
  }
})

// Admin endpoints for monitoring
app.get('/admin/stats', async (c) => {
  try {
    // Simple admin auth (in production, use proper auth)
    const adminKey = c.req.header('x-admin-key')
    if (adminKey !== 'your-admin-key') {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const jobManager = new JobManager({ kv: c.env.STT_JOBS })
    const stats = await jobManager.getProcessingStats()

    return c.json({
      success: true,
      stats
    })

  } catch (error) {
    console.error('Stats error:', error)
    return c.json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get stats'
    }, 500)
  }
})

// Helper method to generate final results
async function generateFinalResults(params: {
  jobId: string
  assembledTranscript: any
  medicalEntities: any
  structuredSections: any
  options: any
  originalMetadata: any
}): Promise<any> {
  const {
    jobId,
    assembledTranscript,
    medicalEntities,
    structuredSections,
    options,
    originalMetadata
  } = params

  // Calculate entity counts
  const entityCounts = {
    medications: medicalEntities.medications?.length || 0,
    symptoms: medicalEntities.symptoms?.length || 0,
    procedures: medicalEntities.procedures?.length || 0,
    conditions: medicalEntities.conditions?.length || 0,
    dosages: medicalEntities.dosages?.length || 0,
    timeframes: medicalEntities.timeframes?.length || 0,
    total_entities: Object.values(medicalEntities).flat().length
  }

  return {
    jobId,
    status: 'completed',
    created_at: new Date().toISOString(),
    
    // Core transcript data
    transcript: {
      full_text: assembledTranscript.fullText,
      segments: assembledTranscript.segments,
      speakers: assembledTranscript.speakers
    },
    
    // Medical enhancements
    medical_entities: medicalEntities,
    structured_sections: structuredSections,
    entity_counts: entityCounts,
    
    // Metadata
    audio: {
      filename: originalMetadata.filename,
      duration: assembledTranscript.totalDuration,
      speakers_detected: assembledTranscript.speakers.length
    },
    
    // Processing info
    processing: {
      time_taken: originalMetadata.processingTime / 1000, // Convert to seconds
      chunks_processed: originalMetadata.chunksProcessed,
      model_version: 'whisper-large-v3+medical-ner-v1',
      confidence: assembledTranscript.overallConfidence,
      word_count: assembledTranscript.wordCount,
      medical_accuracy: 0.95 // Placeholder - would be calculated based on entity confidence
    }
  }
}

export default app
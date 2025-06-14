export interface TranscriptionEngineConfig {
  azureOpenAI: {
    apiKey: string
    endpoint: string
    apiVersion: string
    model: string
  }
  storage: R2Bucket
  maxRetries: number
  timeoutMs: number
}

export interface ProcessChunksParams {
  jobId: string
  chunks: AudioChunk[]
  options: ProcessingOptions
  onProgress?: (progress: number) => Promise<void>
}

export interface AudioChunk {
  id: string
  index: number
  startTime: number
  endTime: number
  duration: number
  size: number
  storageKey: string
  vadSegments?: VADSegment[]
}

export interface VADSegment {
  start: number
  end: number
  confidence: number
}

export interface ProcessingOptions {
  language: string
  speakers?: number | null
  minSpeakers?: number | null
  maxSpeakers?: number | null
  format: string
  enhancedAccuracy: boolean
}

export interface TranscriptionResult {
  chunkId: string
  chunkIndex: number
  startTime: number
  endTime: number
  duration: number
  text: string
  confidence: number
  segments: TranscriptionSegment[]
  language: string
}

export interface TranscriptionSegment {
  start: number
  end: number
  text: string
  confidence: number
}

export class TranscriptionEngine {
  private config: TranscriptionEngineConfig

  constructor(config: TranscriptionEngineConfig) {
    this.config = config
  }

  async processChunks(params: ProcessChunksParams): Promise<TranscriptionResult[]> {
    const { jobId, chunks, options, onProgress } = params
    const results: TranscriptionResult[] = []
    
    // Process chunks in parallel but with concurrency limit
    const concurrency = 3
    const chunkBatches = this.createBatches(chunks, concurrency)
    
    let processedCount = 0
    
    for (const batch of chunkBatches) {
      const batchPromises = batch.map(chunk => this.transcribeChunk(chunk, options))
      const batchResults = await Promise.all(batchPromises)
      
      results.push(...batchResults)
      processedCount += batch.length
      
      // Update progress
      if (onProgress) {
        const progress = Math.round((processedCount / chunks.length) * 100)
        await onProgress(progress)
      }
    }
    
    return results.sort((a, b) => a.chunkIndex - b.chunkIndex)
  }

  private async transcribeChunk(chunk: AudioChunk, options: ProcessingOptions): Promise<TranscriptionResult> {
    const maxRetries = this.config.maxRetries
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get audio file from R2
        const audioObject = await this.config.storage.get(chunk.storageKey)
        if (!audioObject) {
          throw new Error(`Audio chunk not found: ${chunk.storageKey}`)
        }
        
        const audioBuffer = await audioObject.arrayBuffer()
        
        // Call Azure OpenAI Whisper
        const transcription = await this.callAzureOpenAI(audioBuffer, options)
        
        return {
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          duration: chunk.duration,
          text: transcription.text,
          confidence: transcription.confidence || 0.9,
          segments: transcription.segments || [],
          language: transcription.language || options.language
        }
        
      } catch (error) {
        console.error(`Transcription attempt ${attempt} failed for chunk ${chunk.id}:`, error)
        
        if (attempt === maxRetries) {
          // Return empty transcription on final failure
          return {
            chunkId: chunk.id,
            chunkIndex: chunk.index,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
            duration: chunk.duration,
            text: '',
            confidence: 0,
            segments: [],
            language: options.language
          }
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }
    
    throw new Error('Unreachable code')
  }

  private async callAzureOpenAI(audioBuffer: ArrayBuffer, options: ProcessingOptions): Promise<{
    text: string
    confidence?: number
    segments?: TranscriptionSegment[]
    language?: string
  }> {
    const url = `${this.config.azureOpenAI.endpoint}/openai/deployments/${this.config.azureOpenAI.model}/audio/transcriptions?api-version=${this.config.azureOpenAI.apiVersion}`
    
    // Create form data
    const formData = new FormData()
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' })
    formData.append('file', audioBlob, 'audio.wav')
    formData.append('model', this.config.azureOpenAI.model)
    formData.append('language', options.language)
    formData.append('response_format', 'verbose_json')
    formData.append('timestamp_granularities[]', 'segment')
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': this.config.azureOpenAI.apiKey
      },
      body: formData,
      signal: AbortSignal.timeout(this.config.timeoutMs)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`)
    }
    
    const result = await response.json()
    
    // Parse Azure OpenAI response
    const segments: TranscriptionSegment[] = (result.segments || []).map((seg: any) => ({
      start: seg.start || 0,
      end: seg.end || 0,
      text: seg.text || '',
      confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : 0.9
    }))
    
    return {
      text: result.text || '',
      confidence: result.segments ? 
        result.segments.reduce((sum: number, seg: any) => sum + (seg.avg_logprob ? Math.exp(seg.avg_logprob) : 0.9), 0) / result.segments.length :
        0.9,
      segments,
      language: result.language || options.language
    }
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }
    return batches
  }
}
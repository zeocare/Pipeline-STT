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
  transcript: string
  segments: TranscriptSegment[]
  confidence: number
  processingTime: number
  speakerMapping?: SpeakerMapping
}

export interface TranscriptSegment {
  id: number
  start: number
  end: number
  text: string
  confidence: number
  words: Word[]
  speaker?: string
}

export interface Word {
  text: string
  start: number
  end: number
  confidence: number
}

export interface SpeakerMapping {
  [segmentId: number]: string
}

export class TranscriptionEngine {
  private config: TranscriptionEngineConfig

  constructor(config: TranscriptionEngineConfig) {
    this.config = config
  }

  async processChunks(params: ProcessChunksParams): Promise<TranscriptionResult[]> {
    const { jobId, chunks, options, onProgress } = params
    const results: TranscriptionResult[] = []
    
    // Process chunks with controlled concurrency
    const concurrencyLimit = 3 // Process max 3 chunks simultaneously
    const chunkBatches = this.createBatches(chunks, concurrencyLimit)
    
    let completedChunks = 0
    
    for (const batch of chunkBatches) {
      const batchPromises = batch.map(chunk => 
        this.processChunk({
          chunk,
          jobId,
          options,
          previousChunks: results.slice(-2) // Pass last 2 chunks for context
        })
      )
      
      const batchResults = await Promise.allSettled(batchPromises)
      
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i]
        completedChunks++
        
        if (result.status === 'fulfilled') {
          results.push(result.value)
          console.log(`Chunk ${batch[i].id} processed successfully`)
        } else {
          console.error(`Chunk ${batch[i].id} failed:`, result.reason)
          // Create error result to maintain chunk order
          results.push(this.createErrorResult(batch[i], result.reason))
        }
        
        // Update progress
        const progress = Math.round((completedChunks / chunks.length) * 90) // 90% for transcription
        if (onProgress) {
          await onProgress(progress)
        }
      }
    }
    
    // Sort results by chunk index to maintain order
    results.sort((a, b) => a.chunkIndex - b.chunkIndex)
    
    return results
  }

  private async processChunk(params: {
    chunk: AudioChunk
    jobId: string
    options: ProcessingOptions
    previousChunks: TranscriptionResult[]
  }): Promise<TranscriptionResult> {
    const { chunk, jobId, options, previousChunks } = params
    const startTime = Date.now()
    
    console.log(`Processing chunk ${chunk.id}`)
    
    try {
      // Download audio chunk from R2
      const audioData = await this.downloadChunk(chunk.storageKey)
      
      // Build context from previous chunks for better continuity
      const context = this.buildTranscriptionContext(previousChunks, options)
      
      // Transcribe with Azure OpenAI Whisper
      const transcriptionResponse = await this.transcribeWithWhisper({
        audioData,
        options,
        context,
        chunk
      })
      
      // Perform speaker diarization if requested
      let speakerMapping: SpeakerMapping | undefined
      if (options.speakers || options.minSpeakers || options.maxSpeakers) {
        speakerMapping = await this.performSpeakerDiarization({
          audioData,
          transcriptionSegments: transcriptionResponse.segments,
          options,
          chunk
        })
      }
      
      // Apply speaker mapping to segments
      const segmentsWithSpeakers = this.applySpeakerMapping(
        transcriptionResponse.segments,
        speakerMapping
      )
      
      const processingTime = Date.now() - startTime
      
      return {
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        transcript: transcriptionResponse.text,
        segments: segmentsWithSpeakers,
        confidence: transcriptionResponse.confidence,
        processingTime,
        speakerMapping
      }
      
    } catch (error) {
      console.error(`Error processing chunk ${chunk.id}:`, error)
      throw error
    }
  }

  private async downloadChunk(storageKey: string): Promise<ArrayBuffer> {
    try {
      const object = await this.config.storage.get(storageKey)
      if (!object) {
        throw new Error(`Chunk not found in storage: ${storageKey}`)
      }
      
      return await object.arrayBuffer()
    } catch (error) {
      throw new Error(`Failed to download chunk: ${error}`)
    }
  }

  private buildTranscriptionContext(
    previousChunks: TranscriptionResult[],
    options: ProcessingOptions
  ): string {
    if (previousChunks.length === 0) {
      return ""
    }
    
    // Use last few words from previous chunks for context
    const contextWords = previousChunks
      .slice(-2) // Last 2 chunks
      .flatMap(chunk => chunk.segments)
      .slice(-20) // Last 20 segments
      .map(segment => segment.text)
      .join(" ")
      .trim()
    
    return contextWords
  }

  private async transcribeWithWhisper(params: {
    audioData: ArrayBuffer
    options: ProcessingOptions
    context: string
    chunk: AudioChunk
  }): Promise<WhisperResponse> {
    const { audioData, options, context, chunk } = params
    
    // Prepare form data for Whisper API
    const formData = new FormData()
    
    // Create blob from audio data
    const audioBlob = new Blob([audioData], { type: 'audio/mpeg' })
    formData.append('file', audioBlob, `${chunk.id}.mp3`)
    
    // Whisper parameters
    formData.append('model', this.config.azureOpenAI.model)
    formData.append('language', options.language)
    formData.append('response_format', 'verbose_json')
    formData.append('timestamp_granularities[]', 'segment')
    formData.append('timestamp_granularities[]', 'word')
    
    if (context) {
      formData.append('prompt', context)
    }
    
    // Enhanced accuracy settings
    if (options.enhancedAccuracy) {
      formData.append('temperature', '0.0') // Most deterministic
    }
    
    const url = `${this.config.azureOpenAI.endpoint}/openai/audio/transcriptions?api-version=${this.config.azureOpenAI.apiVersion}`
    
    let lastError: Error | null = null
    
    // Retry logic
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        console.log(`Transcription attempt ${attempt} for chunk ${chunk.id}`)
        
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        )
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'api-key': this.config.azureOpenAI.apiKey
          },
          body: formData,
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Whisper API error (${response.status}): ${errorText}`)
        }
        
        const result = await response.json() as WhisperAPIResponse
        
        // Transform API response to our format
        return this.transformWhisperResponse(result, chunk)
        
      } catch (error) {
        lastError = error as Error
        console.error(`Transcription attempt ${attempt} failed for chunk ${chunk.id}:`, error)
        
        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    
    throw new Error(`Transcription failed after ${this.config.maxRetries} attempts: ${lastError?.message}`)
  }

  private transformWhisperResponse(
    apiResponse: WhisperAPIResponse,
    chunk: AudioChunk
  ): WhisperResponse {
    const segments = apiResponse.segments.map((segment, index) => ({
      id: index,
      start: segment.start + chunk.startTime, // Adjust to global timeline
      end: segment.end + chunk.startTime,
      text: segment.text.trim(),
      confidence: segment.avg_logprob ? Math.exp(segment.avg_logprob) : 0.8,
      words: segment.words?.map(word => ({
        text: word.word,
        start: word.start + chunk.startTime,
        end: word.end + chunk.startTime,
        confidence: word.probability || 0.8
      })) || []
    }))
    
    return {
      text: apiResponse.text,
      segments,
      confidence: segments.reduce((sum, seg) => sum + seg.confidence, 0) / segments.length,
      language: apiResponse.language,
      duration: apiResponse.duration
    }
  }

  private async performSpeakerDiarization(params: {
    audioData: ArrayBuffer
    transcriptionSegments: TranscriptSegment[]
    options: ProcessingOptions
    chunk: AudioChunk
  }): Promise<SpeakerMapping> {
    // Simplified speaker diarization
    // In production, you'd use a proper diarization service or model
    
    const { transcriptionSegments, options, chunk } = params
    const speakerMapping: SpeakerMapping = {}
    
    // Simple speaker assignment based on segment patterns
    // This is a placeholder - implement proper diarization
    let currentSpeaker = 0
    const maxSpeakers = options.speakers || options.maxSpeakers || 6
    
    for (let i = 0; i < transcriptionSegments.length; i++) {
      const segment = transcriptionSegments[i]
      
      // Simple heuristic: switch speaker every few segments or on long pauses
      if (i > 0) {
        const prevSegment = transcriptionSegments[i - 1]
        const pause = segment.start - prevSegment.end
        
        // Switch speaker if long pause (>2 seconds) or every 3-5 segments
        if (pause > 2.0 || (i % (3 + Math.floor(Math.random() * 3)) === 0)) {
          currentSpeaker = (currentSpeaker + 1) % maxSpeakers
        }
      }
      
      speakerMapping[segment.id] = `SPEAKER_${currentSpeaker.toString().padStart(2, '0')}`
    }
    
    return speakerMapping
  }

  private applySpeakerMapping(
    segments: TranscriptSegment[],
    speakerMapping?: SpeakerMapping
  ): TranscriptSegment[] {
    if (!speakerMapping) {
      return segments
    }
    
    return segments.map(segment => ({
      ...segment,
      speaker: speakerMapping[segment.id] || 'SPEAKER_UNKNOWN'
    }))
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }
    return batches
  }

  private createErrorResult(chunk: AudioChunk, error: any): TranscriptionResult {
    return {
      chunkId: chunk.id,
      chunkIndex: chunk.index,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      transcript: `[ERROR: Failed to transcribe chunk ${chunk.id}]`,
      segments: [],
      confidence: 0,
      processingTime: 0
    }
  }
}

// Azure OpenAI Whisper API Response Types
interface WhisperAPIResponse {
  text: string
  segments: WhisperAPISegment[]
  language: string
  duration: number
}

interface WhisperAPISegment {
  id: number
  start: number
  end: number
  text: string
  words?: WhisperAPIWord[]
  avg_logprob?: number
}

interface WhisperAPIWord {
  word: string
  start: number
  end: number
  probability?: number
}

// Internal Response Types
interface WhisperResponse {
  text: string
  segments: TranscriptSegment[]
  confidence: number
  language: string
  duration: number
}
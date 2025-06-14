import { ValidationError, ProcessingError } from './errors'

export interface AudioProcessorConfig {
  maxFileSizeMB: number
  chunkSizeMB: number
  supportedFormats: string[]
  storage: R2Bucket
}

export interface ProcessUploadParams {
  file: File
  jobId: string
  options: ProcessingOptions
}

export interface ProcessingOptions {
  language: string
  speakers?: number | null
  minSpeakers?: number | null
  maxSpeakers?: number | null
  format: string
  enhancedAccuracy: boolean
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

export interface ProcessingResult {
  chunks: AudioChunk[]
  estimatedTime: number
  totalDuration: number
  vadResult: VADResult
}

export interface VADResult {
  totalSpeechTime: number
  silenceRatio: number
  segments: VADSegment[]
  estimatedSpeakers: number
}

export class AudioProcessor {
  private config: AudioProcessorConfig

  constructor(config: AudioProcessorConfig) {
    this.config = config
  }

  async processUpload(params: ProcessUploadParams): Promise<ProcessingResult> {
    const { file, jobId, options } = params

    // Validate file
    await this.validateFile(file)

    // Get audio metadata
    const metadata = await this.extractMetadata(file)
    
    // Perform Voice Activity Detection
    const vadResult = await this.performVAD(file)

    // Create optimal chunks based on VAD
    const chunks = await this.createOptimalChunks({
      file,
      vadResult,
      jobId,
      metadata
    })

    // Upload chunks to R2
    await this.uploadChunks(chunks, file)

    // Calculate estimated processing time
    const estimatedTime = this.calculateEstimatedTime({
      totalDuration: metadata.duration,
      chunks: chunks.length,
      options
    })

    return {
      chunks,
      estimatedTime,
      totalDuration: metadata.duration,
      vadResult
    }
  }

  private async validateFile(file: File): Promise<void> {
    // Check file size
    const fileSizeMB = file.size / (1024 * 1024)
    if (fileSizeMB > this.config.maxFileSizeMB) {
      throw new ValidationError(
        `File too large: ${fileSizeMB.toFixed(1)}MB. Maximum allowed: ${this.config.maxFileSizeMB}MB`
      )
    }

    // Check file format
    const extension = this.getFileExtension(file.name)
    if (!this.config.supportedFormats.includes(extension)) {
      throw new ValidationError(
        `Unsupported format: ${extension}. Supported: ${this.config.supportedFormats.join(', ')}`
      )
    }

    // Basic file validation
    if (file.size === 0) {
      throw new ValidationError('File is empty')
    }
  }

  private async extractMetadata(file: File): Promise<AudioMetadata> {
    try {
      // For production, you'd use a proper audio metadata extraction library
      // For now, we'll estimate based on file size and format
      const fileSizeMB = file.size / (1024 * 1024)
      const extension = this.getFileExtension(file.name)
      
      // Rough estimation based on format
      const bitrateEstimates: Record<string, number> = {
        'mp3': 128, // kbps
        'wav': 1411, // kbps for CD quality
        'm4a': 128,
        'flac': 1000,
        'ogg': 128
      }

      const estimatedBitrate = bitrateEstimates[extension] || 128
      const estimatedDuration = (file.size * 8) / (estimatedBitrate * 1000)

      return {
        duration: estimatedDuration,
        sampleRate: 44100, // Estimated
        channels: 2, // Estimated
        bitrate: estimatedBitrate,
        format: extension,
        fileSize: file.size
      }
    } catch (error) {
      throw new ProcessingError('Failed to extract audio metadata')
    }
  }

  private async performVAD(file: File): Promise<VADResult> {
    try {
      // Simplified VAD simulation
      // In production, you'd process the audio with WebRTC VAD or similar
      const arrayBuffer = await file.arrayBuffer()
      const duration = await this.estimateDuration(arrayBuffer, file.name)
      
      // Simulate VAD segments (in production, use actual VAD)
      const segments: VADSegment[] = []
      const segmentDuration = 10 // 10 second segments
      let currentTime = 0
      
      while (currentTime < duration) {
        const segmentEnd = Math.min(currentTime + segmentDuration, duration)
        
        // Simulate speech detection (80% of time is speech)
        if (Math.random() > 0.2) {
          segments.push({
            start: currentTime,
            end: segmentEnd,
            confidence: 0.8 + Math.random() * 0.2
          })
        }
        
        currentTime = segmentEnd
      }

      const totalSpeechTime = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
      const silenceRatio = 1 - (totalSpeechTime / duration)
      
      // Estimate speakers based on speech patterns
      const estimatedSpeakers = Math.min(Math.max(Math.ceil(segments.length / 20), 1), 6)

      return {
        totalSpeechTime,
        silenceRatio,
        segments,
        estimatedSpeakers
      }
    } catch (error) {
      throw new ProcessingError('Voice Activity Detection failed')
    }
  }

  private async createOptimalChunks(params: {
    file: File
    vadResult: VADResult
    jobId: string
    metadata: AudioMetadata
  }): Promise<AudioChunk[]> {
    const { file, vadResult, jobId, metadata } = params
    const maxChunkSizeBytes = this.config.chunkSizeMB * 1024 * 1024
    const chunks: AudioChunk[] = []

    // Calculate optimal chunk boundaries based on VAD segments
    const chunkBoundaries = this.calculateChunkBoundaries({
      vadSegments: vadResult.segments,
      totalDuration: metadata.duration,
      maxChunkSizeBytes,
      fileSize: file.size
    })

    // Create chunks
    for (let i = 0; i < chunkBoundaries.length; i++) {
      const boundary = chunkBoundaries[i]
      
      const chunk: AudioChunk = {
        id: `${jobId}_chunk_${i.toString().padStart(3, '0')}`,
        index: i,
        startTime: boundary.start,
        endTime: boundary.end,
        duration: boundary.end - boundary.start,
        size: boundary.estimatedSize,
        storageKey: `jobs/${jobId}/chunks/chunk_${i.toString().padStart(3, '0')}.${this.getFileExtension(file.name)}`,
        vadSegments: boundary.vadSegments
      }

      chunks.push(chunk)
    }

    return chunks
  }

  private calculateChunkBoundaries(params: {
    vadSegments: VADSegment[]
    totalDuration: number
    maxChunkSizeBytes: number
    fileSize: number
  }): ChunkBoundary[] {
    const { vadSegments, totalDuration, maxChunkSizeBytes, fileSize } = params
    
    // Estimate bytes per second
    const bytesPerSecond = fileSize / totalDuration
    const maxChunkDuration = maxChunkSizeBytes / bytesPerSecond
    
    const boundaries: ChunkBoundary[] = []
    let currentStart = 0
    let currentVadSegments: VADSegment[] = []
    
    for (const vadSegment of vadSegments) {
      // Check if adding this segment would exceed chunk duration
      if (vadSegment.end - currentStart > maxChunkDuration && currentVadSegments.length > 0) {
        // Create chunk boundary
        boundaries.push({
          start: currentStart,
          end: currentVadSegments[currentVadSegments.length - 1].end,
          estimatedSize: Math.round((currentVadSegments[currentVadSegments.length - 1].end - currentStart) * bytesPerSecond),
          vadSegments: [...currentVadSegments]
        })
        
        currentStart = vadSegment.start
        currentVadSegments = []
      }
      
      currentVadSegments.push(vadSegment)
    }
    
    // Add final chunk
    if (currentVadSegments.length > 0) {
      boundaries.push({
        start: currentStart,
        end: totalDuration,
        estimatedSize: Math.round((totalDuration - currentStart) * bytesPerSecond),
        vadSegments: currentVadSegments
      })
    }
    
    return boundaries
  }

  private async uploadChunks(chunks: AudioChunk[], originalFile: File): Promise<void> {
    const arrayBuffer = await originalFile.arrayBuffer()
    
    // Store full file for each chunk (simplified chunking for MVP)
    // Each chunk contains timing metadata for proper transcription
    for (const chunk of chunks) {
      try {
        await this.config.storage.put(chunk.storageKey, arrayBuffer, {
          httpMetadata: {
            contentType: originalFile.type,
            cacheControl: 'max-age=3600'
          },
          customMetadata: {
            chunkId: chunk.id,
            startTime: chunk.startTime.toString(),
            endTime: chunk.endTime.toString(),
            duration: chunk.duration.toString(),
            originalFilename: originalFile.name
          }
        })
      } catch (error) {
        throw new ProcessingError(`Failed to upload chunk ${chunk.id}`)
      }
    }
  }

  private calculateEstimatedTime(params: {
    totalDuration: number
    chunks: number
    options: ProcessingOptions
  }): number {
    const { totalDuration, chunks, options } = params
    
    // Base processing time (optimistic: 0.1x real-time)
    let estimatedTime = totalDuration * 0.1
    
    // Add overhead for chunking
    estimatedTime += chunks * 2 // 2 seconds per chunk overhead
    
    // Add overhead for speaker diarization
    if (options.speakers && options.speakers > 2) {
      estimatedTime *= 1.5
    }
    
    // Add overhead for enhanced accuracy
    if (options.enhancedAccuracy) {
      estimatedTime *= 1.2
    }
    
    // Minimum 30 seconds
    return Math.max(estimatedTime, 30)
  }

  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || ''
  }

  private async estimateDuration(arrayBuffer: ArrayBuffer, filename: string): Promise<number> {
    // Simplified duration estimation
    // In production, you'd parse the audio file headers
    const fileSizeMB = arrayBuffer.byteLength / (1024 * 1024)
    const extension = this.getFileExtension(filename)
    
    // Rough estimates (seconds per MB)
    const durationPerMB: Record<string, number> = {
      'mp3': 480,  // ~8 minutes per MB at 128kbps
      'wav': 40,   // ~40 seconds per MB uncompressed
      'm4a': 480,
      'flac': 60,
      'ogg': 480
    }
    
    const rate = durationPerMB[extension] || 480
    return fileSizeMB * rate
  }
}

interface AudioMetadata {
  duration: number
  sampleRate: number
  channels: number
  bitrate: number
  format: string
  fileSize: number
}

interface ChunkBoundary {
  start: number
  end: number
  estimatedSize: number
  vadSegments: VADSegment[]
}
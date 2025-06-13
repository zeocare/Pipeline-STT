export interface AssembledTranscript {
  fullText: string
  segments: AssembledSegment[]
  speakers: Speaker[]
  totalDuration: number
  overallConfidence: number
  wordCount: number
}

export interface AssembledSegment {
  id: number
  startTime: number
  endTime: number
  speakerId: string
  text: string
  confidence: number
  words: Word[]
  chunkIndex: number
}

export interface Speaker {
  id: string
  label: string
  totalSpeakingTime: number
  segmentCount: number
  averageConfidence: number
}

export interface Word {
  text: string
  start: number
  end: number
  confidence: number
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

export interface SpeakerMapping {
  [segmentId: number]: string
}

export interface AssemblyOptions {
  language: string
  speakers?: number | null
  minSpeakers?: number | null
  maxSpeakers?: number | null
  format: string
  enhancedAccuracy: boolean
}

export class AssemblyEngine {
  
  async assembleTranscript(params: {
    transcriptionResults: TranscriptionResult[]
    originalChunks: any[]
    options: AssemblyOptions
  }): Promise<AssembledTranscript> {
    
    const { transcriptionResults, originalChunks, options } = params
    
    console.log(`Assembling transcript from ${transcriptionResults.length} chunks`)
    
    // Step 1: Sort chunks by index to maintain temporal order
    const sortedResults = transcriptionResults.sort((a, b) => a.chunkIndex - b.chunkIndex)
    
    // Step 2: Create global speaker mapping across chunks
    const globalSpeakerMapping = await this.createGlobalSpeakerMapping(sortedResults)
    
    // Step 3: Merge segments with speaker continuity
    const assembledSegments = await this.mergeSegmentsWithContinuity({
      sortedResults,
      globalSpeakerMapping,
      options
    })
    
    // Step 4: Generate speaker statistics
    const speakers = this.generateSpeakerStats(assembledSegments)
    
    // Step 5: Calculate overall metrics
    const metrics = this.calculateOverallMetrics(assembledSegments, sortedResults)
    
    // Step 6: Generate full text
    const fullText = this.generateFullText(assembledSegments, speakers)
    
    return {
      fullText,
      segments: assembledSegments,
      speakers,
      totalDuration: metrics.totalDuration,
      overallConfidence: metrics.overallConfidence,
      wordCount: metrics.wordCount
    }
  }
  
  private async createGlobalSpeakerMapping(
    sortedResults: TranscriptionResult[]
  ): Promise<Map<string, string>> {
    
    const globalMapping = new Map<string, string>()
    const speakerClusters = new Map<string, string[]>()
    
    // Collect all local speaker IDs from each chunk
    for (const result of sortedResults) {
      if (result.speakerMapping) {
        for (const [segmentId, localSpeakerId] of Object.entries(result.speakerMapping)) {
          const key = `${result.chunkId}_${segmentId}`
          
          if (!speakerClusters.has(localSpeakerId)) {
            speakerClusters.set(localSpeakerId, [])
          }
          speakerClusters.get(localSpeakerId)!.push(key)
        }
      }
    }
    
    // Create global speaker mapping using simple clustering
    let globalSpeakerIndex = 0
    const processedLocalSpeakers = new Set<string>()
    
    for (const result of sortedResults) {
      if (result.speakerMapping) {
        for (const [segmentId, localSpeakerId] of Object.entries(result.speakerMapping)) {
          const localSpeakerKey = `${result.chunkIndex}_${localSpeakerId}`
          
          if (!processedLocalSpeakers.has(localSpeakerKey)) {
            // Assign global speaker ID
            const globalSpeakerId = `SPEAKER_${globalSpeakerIndex.toString().padStart(2, '0')}`
            
            // Map all segments with this local speaker to global speaker
            for (const segment of result.segments) {
              if (segment.speaker === localSpeakerId) {
                const key = `${result.chunkId}_${segment.id}`
                globalMapping.set(key, globalSpeakerId)
              }
            }
            
            processedLocalSpeakers.add(localSpeakerKey)
            globalSpeakerIndex++
          }
        }
      } else {
        // Handle segments without speaker mapping
        for (const segment of result.segments) {
          const key = `${result.chunkId}_${segment.id}`
          globalMapping.set(key, 'SPEAKER_00') // Default to first speaker
        }
      }
    }
    
    return globalMapping
  }
  
  private async mergeSegmentsWithContinuity(params: {
    sortedResults: TranscriptionResult[]
    globalSpeakerMapping: Map<string, string>
    options: AssemblyOptions
  }): Promise<AssembledSegment[]> {
    
    const { sortedResults, globalSpeakerMapping, options } = params
    const assembledSegments: AssembledSegment[] = []
    let globalSegmentId = 0
    
    for (const result of sortedResults) {
      for (const segment of result.segments) {
        const segmentKey = `${result.chunkId}_${segment.id}`
        const globalSpeakerId = globalSpeakerMapping.get(segmentKey) || 'SPEAKER_00'
        
        // Create assembled segment
        const assembledSegment: AssembledSegment = {
          id: globalSegmentId++,
          startTime: segment.start,
          endTime: segment.end,
          speakerId: globalSpeakerId,
          text: segment.text.trim(),
          confidence: segment.confidence,
          words: segment.words || [],
          chunkIndex: result.chunkIndex
        }
        
        // Check for speaker continuity and merge if appropriate
        const lastSegment = assembledSegments[assembledSegments.length - 1]
        if (this.shouldMergeSegments(lastSegment, assembledSegment)) {
          // Merge with previous segment
          lastSegment.endTime = assembledSegment.endTime
          lastSegment.text += ` ${assembledSegment.text}`
          lastSegment.words.push(...assembledSegment.words)
          lastSegment.confidence = (lastSegment.confidence + assembledSegment.confidence) / 2
        } else {
          assembledSegments.push(assembledSegment)
        }
      }
    }
    
    return assembledSegments
  }
  
  private shouldMergeSegments(
    lastSegment: AssembledSegment | undefined,
    currentSegment: AssembledSegment
  ): boolean {
    
    if (!lastSegment) return false
    
    const timeDiff = currentSegment.startTime - lastSegment.endTime
    const sameSpeaker = lastSegment.speakerId === currentSegment.speakerId
    const shortPause = timeDiff < 1.0 // Less than 1 second gap
    const shortTexts = lastSegment.text.length < 50 && currentSegment.text.length < 50
    
    return sameSpeaker && shortPause && shortTexts
  }
  
  private generateSpeakerStats(segments: AssembledSegment[]): Speaker[] {
    const speakerStats = new Map<string, {
      totalTime: number
      segmentCount: number
      totalConfidence: number
    }>()
    
    // Calculate stats for each speaker
    for (const segment of segments) {
      const stats = speakerStats.get(segment.speakerId) || {
        totalTime: 0,
        segmentCount: 0,
        totalConfidence: 0
      }
      
      stats.totalTime += segment.endTime - segment.startTime
      stats.segmentCount += 1
      stats.totalConfidence += segment.confidence
      
      speakerStats.set(segment.speakerId, stats)
    }
    
    // Convert to Speaker objects
    const speakers: Speaker[] = []
    for (const [speakerId, stats] of speakerStats.entries()) {
      speakers.push({
        id: speakerId,
        label: speakerId,
        totalSpeakingTime: stats.totalTime,
        segmentCount: stats.segmentCount,
        averageConfidence: stats.totalConfidence / stats.segmentCount
      })
    }
    
    // Sort by total speaking time (descending)
    speakers.sort((a, b) => b.totalSpeakingTime - a.totalSpeakingTime)
    
    return speakers
  }
  
  private calculateOverallMetrics(
    segments: AssembledSegment[],
    transcriptionResults: TranscriptionResult[]
  ): {
    totalDuration: number
    overallConfidence: number
    wordCount: number
  } {
    
    let totalDuration = 0
    let totalConfidence = 0
    let wordCount = 0
    
    if (segments.length > 0) {
      totalDuration = Math.max(...segments.map(s => s.endTime))
      totalConfidence = segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
      wordCount = segments.reduce((sum, s) => sum + s.text.split(' ').length, 0)
    }
    
    return {
      totalDuration,
      overallConfidence: totalConfidence,
      wordCount
    }
  }
  
  private generateFullText(segments: AssembledSegment[], speakers: Speaker[]): string {
    const textParts: string[] = []
    
    for (const segment of segments) {
      const speakerLabel = segment.speakerId
      const timestamp = this.formatTimestamp(segment.startTime)
      textParts.push(`[${timestamp}] ${speakerLabel}: ${segment.text}`)
    }
    
    return textParts.join('\n')
  }
  
  private formatTimestamp(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }
}
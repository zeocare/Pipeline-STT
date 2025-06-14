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

export interface AssembledTranscript {
  fullText: string
  segments: AssembledSegment[]
  speakers: Speaker[]
  totalDuration: number
  overallConfidence: number
  wordCount: number
}

export interface AssembledSegment {
  start: number
  end: number
  text: string
  speaker: string
  confidence: number
  originalChunk: string
}

export interface Speaker {
  id: string
  name: string
  totalSpeechTime: number
  segments: number
  averageConfidence: number
}

export class AssemblyEngine {
  async assembleTranscript(params: {
    transcriptionResults: TranscriptionResult[]
    originalChunks: any[]
    options: any
  }): Promise<AssembledTranscript> {
    const { transcriptionResults } = params
    
    // Sort by chunk index to maintain order
    const sortedResults = transcriptionResults.sort((a, b) => a.chunkIndex - b.chunkIndex)
    
    // Combine all segments with timing adjustment
    const allSegments: AssembledSegment[] = []
    let currentTimeOffset = 0
    
    for (const result of sortedResults) {
      // Add segments from this chunk with proper timing
      for (const segment of result.segments) {
        allSegments.push({
          start: currentTimeOffset + segment.start,
          end: currentTimeOffset + segment.end,
          text: segment.text.trim(),
          speaker: this.detectSpeaker(segment, result.chunkIndex),
          confidence: segment.confidence,
          originalChunk: result.chunkId
        })
      }
      
      // Update time offset for next chunk
      currentTimeOffset += result.duration
    }
    
    // Merge adjacent segments from same speaker
    const mergedSegments = this.mergeAdjacentSegments(allSegments)
    
    // Identify speakers and create speaker map
    const speakers = this.identifySpeakers(mergedSegments)
    
    // Build full text
    const fullText = mergedSegments
      .map(seg => `[${seg.speaker}] ${seg.text}`)
      .join('\n\n')
    
    // Calculate statistics
    const totalDuration = Math.max(...mergedSegments.map(s => s.end), 0)
    const overallConfidence = mergedSegments.length > 0 ? 
      mergedSegments.reduce((sum, seg) => sum + seg.confidence, 0) / mergedSegments.length : 0
    const wordCount = mergedSegments.reduce((count, seg) => count + seg.text.split(' ').length, 0)
    
    return {
      fullText,
      segments: mergedSegments,
      speakers,
      totalDuration,
      overallConfidence,
      wordCount
    }
  }
  
  private detectSpeaker(segment: TranscriptionSegment, chunkIndex: number): string {
    const text = segment.text.toLowerCase()
    
    // Detect if this sounds like a doctor (professional language)
    const doctorKeywords = ['paciente', 'medicamento', 'prescrevo', 'diagnóstico', 'sintomas', 'exame', 'tratamento']
    const patientKeywords = ['dor', 'sinto', 'não consigo', 'me sinto', 'está doendo', 'tenho']
    
    const doctorScore = doctorKeywords.filter(keyword => text.includes(keyword)).length
    const patientScore = patientKeywords.filter(keyword => text.includes(keyword)).length
    
    if (doctorScore > patientScore) {
      return 'Médico'
    } else if (patientScore > 0) {
      return 'Paciente'
    }
    
    // Fallback: alternate between speakers based on chunk
    return chunkIndex % 2 === 0 ? 'Médico' : 'Paciente'
  }
  
  private mergeAdjacentSegments(segments: AssembledSegment[]): AssembledSegment[] {
    if (segments.length === 0) return []
    
    const merged: AssembledSegment[] = []
    let current = { ...segments[0] }
    
    for (let i = 1; i < segments.length; i++) {
      const next = segments[i]
      
      // Merge if same speaker and close in time (less than 2 seconds gap)
      if (current.speaker === next.speaker && (next.start - current.end) < 2.0) {
        current.end = next.end
        current.text += ' ' + next.text
        current.confidence = (current.confidence + next.confidence) / 2
      } else {
        merged.push(current)
        current = { ...next }
      }
    }
    
    merged.push(current)
    return merged
  }
  
  private identifySpeakers(segments: AssembledSegment[]): Speaker[] {
    const speakerMap = new Map<string, {
      totalTime: number
      segmentCount: number
      confidenceSum: number
    }>()
    
    // Calculate speaker statistics
    for (const segment of segments) {
      const speaker = segment.speaker
      const duration = segment.end - segment.start
      
      if (!speakerMap.has(speaker)) {
        speakerMap.set(speaker, {
          totalTime: 0,
          segmentCount: 0,
          confidenceSum: 0
        })
      }
      
      const stats = speakerMap.get(speaker)!
      stats.totalTime += duration
      stats.segmentCount += 1
      stats.confidenceSum += segment.confidence
    }
    
    // Create speaker objects
    const speakers: Speaker[] = []
    for (const [speakerId, stats] of speakerMap) {
      speakers.push({
        id: speakerId,
        name: speakerId,
        totalSpeechTime: stats.totalTime,
        segments: stats.segmentCount,
        averageConfidence: stats.confidenceSum / stats.segmentCount
      })
    }
    
    return speakers.sort((a, b) => b.totalSpeechTime - a.totalSpeechTime)
  }
}
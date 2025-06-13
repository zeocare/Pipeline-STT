export interface ResultsStorageConfig {
  storage: R2Bucket
}

export interface StoreResultsParams {
  jobId: string
  results: TranscriptionResults
}

export interface TranscriptionResults {
  jobId: string
  status: string
  created_at: string
  transcript: any
  medical_entities: any
  structured_sections: any
  entity_counts: any
  audio: any
  processing: any
}

export interface DownloadUrls {
  json: string
  txt: string
  srt: string
  vtt: string
  medical_json: string
}

export class ResultsStorage {
  private config: ResultsStorageConfig

  constructor(config: ResultsStorageConfig) {
    this.config = config
  }

  async storeResults(params: StoreResultsParams): Promise<DownloadUrls> {
    const { jobId, results } = params

    console.log(`Storing results for job ${jobId}`)

    // Generate different output formats
    const formats = {
      json: await this.generateJSONFormat(results),
      txt: await this.generateTXTFormat(results),
      srt: await this.generateSRTFormat(results),
      vtt: await this.generateVTTFormat(results),
      medical_json: await this.generateMedicalJSONFormat(results)
    }

    // Store each format in R2
    const downloadUrls: DownloadUrls = {
      json: '',
      txt: '',
      srt: '',
      vtt: '',
      medical_json: ''
    }

    for (const [format, content] of Object.entries(formats)) {
      const key = `results/${jobId}/${jobId}.${format}`
      
      try {
        await this.config.storage.put(key, content, {
          httpMetadata: {
            contentType: this.getContentType(format),
            cacheControl: 'max-age=86400' // 24 hours
          },
          customMetadata: {
            jobId,
            format,
            generated: new Date().toISOString(),
            size: content.length.toString()
          }
        })

        // Generate download URL (in production, you'd use signed URLs)
        downloadUrls[format as keyof DownloadUrls] = `https://stt-results.voitherbrazil.workers.dev/${key}`
        
      } catch (error) {
        console.error(`Failed to store ${format} format for job ${jobId}:`, error)
        throw new Error(`Storage failed for format: ${format}`)
      }
    }

    console.log(`Results stored successfully for job ${jobId}`)
    return downloadUrls
  }

  async getResultFile(jobId: string, format: string): Promise<string | null> {
    const key = `results/${jobId}/${jobId}.${format}`
    
    try {
      const object = await this.config.storage.get(key)
      if (!object) {
        return null
      }
      
      return await object.text()
    } catch (error) {
      console.error(`Failed to retrieve ${format} file for job ${jobId}:`, error)
      return null
    }
  }

  async deleteResults(jobId: string): Promise<void> {
    const formats = ['json', 'txt', 'srt', 'vtt', 'medical_json']
    
    const deletePromises = formats.map(format => {
      const key = `results/${jobId}/${jobId}.${format}`
      return this.config.storage.delete(key)
    })
    
    try {
      await Promise.all(deletePromises)
      console.log(`Results deleted for job ${jobId}`)
    } catch (error) {
      console.error(`Failed to delete results for job ${jobId}:`, error)
      throw error
    }
  }

  async listJobResults(jobId: string): Promise<string[]> {
    const prefix = `results/${jobId}/`
    
    try {
      const list = await this.config.storage.list({ prefix })
      return list.objects.map(obj => obj.key)
    } catch (error) {
      console.error(`Failed to list results for job ${jobId}:`, error)
      return []
    }
  }

  // Format generators
  private async generateJSONFormat(results: TranscriptionResults): Promise<string> {
    return JSON.stringify(results, null, 2)
  }

  private async generateTXTFormat(results: TranscriptionResults): Promise<string> {
    const lines: string[] = []
    
    // Header
    lines.push('=== TRANSCRIÇÃO DE CONSULTA MÉDICA ===')
    lines.push(`Job ID: ${results.jobId}`)
    lines.push(`Data: ${new Date(results.created_at).toLocaleString('pt-BR')}`)
    lines.push(`Duração: ${this.formatDuration(results.audio?.duration || 0)}`)
    lines.push(`Speakers: ${results.transcript?.speakers?.length || 0}`)
    lines.push(`Palavras: ${results.processing?.word_count || 0}`)
    lines.push(`Confiança: ${(results.processing?.confidence * 100 || 0).toFixed(1)}%`)
    lines.push('')

    // Medical entities summary
    if (results.entity_counts) {
      lines.push('=== ENTIDADES MÉDICAS IDENTIFICADAS ===')
      lines.push(`Medicações: ${results.entity_counts.medications || 0}`)
      lines.push(`Sintomas: ${results.entity_counts.symptoms || 0}`)
      lines.push(`Procedimentos: ${results.entity_counts.procedures || 0}`)
      lines.push(`Condições: ${results.entity_counts.conditions || 0}`)
      lines.push(`Dosagens: ${results.entity_counts.dosages || 0}`)
      lines.push(`Timeframes: ${results.entity_counts.timeframes || 0}`)
      lines.push('')
    }

    // Structured sections
    if (results.structured_sections) {
      lines.push('=== SEÇÕES ESTRUTURADAS ===')
      
      const sectionNames: Record<string, string> = {
        greeting: 'Cumprimento',
        chief_complaint: 'Queixa Principal',
        history: 'História',
        examination: 'Exame',
        plan: 'Plano',
        closing: 'Encerramento'
      }
      
      for (const [key, section] of Object.entries(results.structured_sections)) {
        if (section) {
          lines.push(`${sectionNames[key] || key}:`)
          lines.push(`[${this.formatTime(section.startTime)} - ${this.formatTime(section.endTime)}] ${section.speakerId}`)
          lines.push(section.text)
          lines.push('')
        }
      }
    }

    // Full transcript
    lines.push('=== TRANSCRIÇÃO COMPLETA ===')
    lines.push('')
    
    if (results.transcript?.segments) {
      for (const segment of results.transcript.segments) {
        const timestamp = `[${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}]`
        lines.push(`${timestamp} ${segment.speakerId}: ${segment.text}`)
      }
    }

    return lines.join('\n')
  }

  private async generateSRTFormat(results: TranscriptionResults): Promise<string> {
    const lines: string[] = []
    let subtitleIndex = 1

    if (results.transcript?.segments) {
      for (const segment of results.transcript.segments) {
        const startTime = this.formatSRTTimestamp(segment.startTime)
        const endTime = this.formatSRTTimestamp(segment.endTime)
        
        lines.push(subtitleIndex.toString())
        lines.push(`${startTime} --> ${endTime}`)
        lines.push(`[${segment.speakerId}]: ${segment.text}`)
        lines.push('')
        
        subtitleIndex++
      }
    }

    return lines.join('\n')
  }

  private async generateVTTFormat(results: TranscriptionResults): Promise<string> {
    const lines: string[] = []
    lines.push('WEBVTT')
    lines.push('')

    if (results.transcript?.segments) {
      for (const segment of results.transcript.segments) {
        const startTime = this.formatVTTTimestamp(segment.startTime)
        const endTime = this.formatVTTTimestamp(segment.endTime)
        
        lines.push(`${startTime} --> ${endTime}`)
        lines.push(`<v ${segment.speakerId}>${segment.text}`)
        lines.push('')
      }
    }

    return lines.join('\n')
  }

  private async generateMedicalJSONFormat(results: TranscriptionResults): Promise<string> {
    // Enhanced medical-focused JSON format
    const medicalFormat = {
      consultation: {
        id: results.jobId,
        date: results.created_at,
        duration: results.audio?.duration,
        participants: results.transcript?.speakers?.length || 0
      },
      
      clinical_summary: {
        chief_complaint: results.structured_sections?.chief_complaint?.text || null,
        assessment: results.structured_sections?.examination?.text || null,
        plan: results.structured_sections?.plan?.text || null
      },
      
      medical_entities: {
        medications: results.medical_entities?.medications || [],
        symptoms: results.medical_entities?.symptoms || [],
        conditions: results.medical_entities?.conditions || [],
        procedures: results.medical_entities?.procedures || [],
        dosages: results.medical_entities?.dosages || [],
        temporal_references: results.medical_entities?.timeframes || []
      },
      
      conversation_analysis: {
        speaker_distribution: this.calculateSpeakerDistribution(results.transcript?.segments || []),
        emotional_markers: this.identifyEmotionalMarkers(results.transcript?.segments || []),
        key_phrases: this.extractKeyPhrases(results.transcript?.segments || [])
      },
      
      quality_metrics: {
        transcription_confidence: results.processing?.confidence || 0,
        medical_entity_coverage: this.calculateEntityCoverage(results.medical_entities || {}),
        completeness_score: this.calculateCompletenessScore(results.structured_sections || {})
      },
      
      full_transcript: results.transcript,
      
      metadata: {
        model_version: results.processing?.model_version,
        processing_time: results.processing?.time_taken,
        word_count: results.processing?.word_count,
        generated_at: new Date().toISOString()
      }
    }

    return JSON.stringify(medicalFormat, null, 2)
  }

  // Helper methods
  private getContentType(format: string): string {
    const contentTypes: Record<string, string> = {
      json: 'application/json',
      txt: 'text/plain; charset=utf-8',
      srt: 'text/plain; charset=utf-8',
      vtt: 'text/vtt; charset=utf-8',
      medical_json: 'application/json'
    }
    return contentTypes[format] || 'text/plain'
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (hours > 0) {
      return `${hours}h${minutes.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s`
    } else {
      return `${minutes}m${secs.toString().padStart(2, '0')}s`
    }
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  private formatSRTTimestamp(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const milliseconds = Math.floor((seconds % 1) * 1000)
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`
  }

  private formatVTTTimestamp(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const milliseconds = Math.floor((seconds % 1) * 1000)
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
  }

  private calculateSpeakerDistribution(segments: any[]): Record<string, number> {
    const distribution: Record<string, number> = {}
    
    for (const segment of segments) {
      const duration = segment.endTime - segment.startTime
      distribution[segment.speakerId] = (distribution[segment.speakerId] || 0) + duration
    }
    
    return distribution
  }

  private identifyEmotionalMarkers(segments: any[]): string[] {
    const emotionalMarkers: string[] = []
    const emotionalPatterns = [
      /triste/i, /ansios/i, /preocupad/i, /nervos/i, /irritad/i,
      /feliz/i, /content/i, /alegr/i, /calm/i, /relaxad/i,
      /medo/i, /panic/i, /angustiad/i, /desesperanç/i
    ]
    
    for (const segment of segments) {
      for (const pattern of emotionalPatterns) {
        if (pattern.test(segment.text)) {
          const match = segment.text.match(pattern)
          if (match) {
            emotionalMarkers.push(match[0])
          }
        }
      }
    }
    
    return [...new Set(emotionalMarkers)] // Remove duplicates
  }

  private extractKeyPhrases(segments: any[]): string[] {
    // Simple key phrase extraction based on common medical consultation patterns
    const keyPhrases: string[] = []
    const phrasePatterns = [
      /não consigo/i, /tenho dificuldade/i, /sinto que/i,
      /parece que/i, /acredito que/i, /penso que/i,
      /desde que/i, /quando/i, /sempre/i, /nunca/i,
      /todo dia/i, /toda noite/i, /de manhã/i, /à noite/i
    ]
    
    for (const segment of segments) {
      for (const pattern of phrasePatterns) {
        const matches = segment.text.match(pattern)
        if (matches) {
          keyPhrases.push(...matches)
        }
      }
    }
    
    return [...new Set(keyPhrases)].slice(0, 20) // Top 20 unique phrases
  }

  private calculateEntityCoverage(medicalEntities: any): number {
    const totalEntities = Object.values(medicalEntities)
      .flat()
      .length
    
    // Normalize coverage based on expected entity density
    // Assuming 1 entity per 100 words is good coverage
    return Math.min(totalEntities / 10, 1.0)
  }

  private calculateCompletenessScore(structuredSections: any): number {
    const expectedSections = ['greeting', 'chief_complaint', 'history', 'examination', 'plan']
    const foundSections = Object.keys(structuredSections).filter(key => 
      structuredSections[key] && structuredSections[key].text
    )
    
    return foundSections.length / expectedSections.length
  }
}
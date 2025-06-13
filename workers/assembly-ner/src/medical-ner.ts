export interface MedicalNERConfig {
  azureAI: {
    apiKey: string
    endpoint: string
    apiVersion: string
  }
  openAI: {
    apiKey: string
    endpoint: string
  }
  maxRetries: number
  timeoutMs: number
}

export interface MedicalEntities {
  medications: MedicalEntity[]
  symptoms: MedicalEntity[]
  procedures: MedicalEntity[]
  anatomical: MedicalEntity[]
  dosages: MedicalEntity[]
  timeframes: MedicalEntity[]
  conditions: MedicalEntity[]
}

export interface MedicalEntity {
  text: string
  startTime: number
  endTime: number
  confidence: number
  category: string
  subcategory?: string
  normalizedText?: string
}

export interface StructuredSections {
  greeting?: MedicalSection
  chief_complaint?: MedicalSection
  history?: MedicalSection
  examination?: MedicalSection
  plan?: MedicalSection
  closing?: MedicalSection
}

export interface MedicalSection {
  startTime: number
  endTime: number
  speakerId: string
  text: string
  entities: MedicalEntity[]
  confidence: number
}

export interface AssembledTranscript {
  fullText: string
  segments: any[]
  speakers: any[]
  totalDuration: number
  overallConfidence: number
  wordCount: number
}

export class MedicalNER {
  private config: MedicalNERConfig
  
  constructor(config: MedicalNERConfig) {
    this.config = config
  }
  
  async extractMedicalEntities(params: {
    transcript: AssembledTranscript
    language: string
  }): Promise<MedicalEntities> {
    
    const { transcript, language } = params
    
    console.log(`Extracting medical entities from transcript (${language})`)
    
    // Step 1: Extract entities using Azure AI Language
    const azureEntities = await this.extractWithAzureAI({
      text: transcript.fullText,
      language
    })
    
    // Step 2: Extract entities using custom medical dictionary
    const customEntities = await this.extractWithCustomDictionary({
      transcript,
      language
    })
    
    // Step 3: Extract entities using OpenAI for complex medical reasoning
    const openAIEntities = await this.extractWithOpenAI({
      transcript,
      language
    })
    
    // Step 4: Merge and deduplicate entities
    const mergedEntities = await this.mergeAndDeduplicateEntities([
      azureEntities,
      customEntities,
      openAIEntities
    ])
    
    // Step 5: Map entities to timeline using transcript segments
    const timelineMappedEntities = await this.mapEntitiesToTimeline({
      entities: mergedEntities,
      segments: transcript.segments
    })
    
    return this.categorizeEntities(timelineMappedEntities)
  }
  
  private async extractWithAzureAI(params: {
    text: string
    language: string
  }): Promise<MedicalEntity[]> {
    
    const { text, language } = params
    const entities: MedicalEntity[] = []
    
    try {
      const url = `${this.config.azureAI.endpoint}/language/:analyze-text?api-version=${this.config.azureAI.apiVersion}`
      
      const requestBody = {
        kind: "EntityRecognition",
        parameters: {
          modelVersion: "latest",
          domain: "healthcare"
        },
        analysisInput: {
          documents: [{
            id: "1",
            language: language,
            text: text
          }]
        }
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.config.azureAI.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })
      
      if (!response.ok) {
        throw new Error(`Azure AI API error: ${response.status}`)
      }
      
      const result = await response.json()
      
      // Process Azure AI results
      if (result.results?.documents?.[0]?.entities) {
        for (const entity of result.results.documents[0].entities) {
          entities.push({
            text: entity.text,
            startTime: 0, // Will be mapped later
            endTime: 0,
            confidence: entity.confidenceScore || 0.8,
            category: this.mapAzureCategory(entity.category),
            subcategory: entity.subcategory,
            normalizedText: entity.normalizedText
          })
        }
      }
      
    } catch (error) {
      console.error('Azure AI entity extraction failed:', error)
      // Don't throw - continue with other methods
    }
    
    return entities
  }
  
  private async extractWithCustomDictionary(params: {
    transcript: AssembledTranscript
    language: string
  }): Promise<MedicalEntity[]> {
    
    const entities: MedicalEntity[] = []
    const text = transcript.fullText.toLowerCase()
    
    // Brazilian Portuguese medical dictionaries
    const medicalDictionaries = {
      medications: [
        'sertralina', 'fluoxetina', 'clonazepam', 'diazepam', 'lorazepam',
        'alprazolam', 'rivotril', 'lexapro', 'zoloft', 'prozac',
        'amitriptilina', 'imipramina', 'paroxetina', 'venlafaxina',
        'duloxetina', 'bupropiona', 'mirtazapina', 'quetiapina',
        'olanzapina', 'risperidona', 'aripiprazol', 'haloperidol',
        'clorpromazina', 'lítio', 'carbamazepina', 'ácido valpróico'
      ],
      symptoms: [
        'ansiedade', 'depressão', 'pânico', 'fobia', 'insônia',
        'pesadelos', 'flashbacks', 'tristeza', 'angústia', 'melancolia',
        'euforia', 'mania', 'delírios', 'alucinações', 'paranoia',
        'obsessões', 'compulsões', 'rituais', 'tics', 'tiques',
        'irritabilidade', 'agitação', 'agressividade', 'impulsividade',
        'desatenção', 'hiperatividade', 'esquecimento', 'confusão'
      ],
      conditions: [
        'transtorno de ansiedade', 'depressão maior', 'transtorno bipolar',
        'esquizofrenia', 'transtorno obsessivo compulsivo', 'toc',
        'transtorno de pânico', 'fobia social', 'agorafobia',
        'transtorno de estresse pós-traumático', 'tept', 'ptsd',
        'transtorno de déficit de atenção', 'tdah', 'adhd',
        'transtorno de personalidade borderline', 'tpb',
        'transtorno de personalidade antissocial', 'psicopatia',
        'transtorno alimentar', 'anorexia', 'bulimia', 'compulsão alimentar'
      ],
      procedures: [
        'psicoterapia', 'terapia cognitivo comportamental', 'tcc',
        'psicanálise', 'terapia de grupo', 'terapia familiar',
        'eletroconvulsoterapia', 'ect', 'estimulação magnética transcraniana',
        'internação psiquiátrica', 'hospital dia', 'caps'
      ],
      dosages: [
        /\d+\s*mg/g, /\d+\s*ml/g, /\d+\s*comprimidos?/g,
        /\d+\s*gotas?/g, /\d+\s*vezes?\s*ao\s*dia/g,
        /uma\s*vez\s*ao\s*dia/g, /duas\s*vezes\s*ao\s*dia/g,
        /três\s*vezes\s*ao\s*dia/g, /de\s*\d+\s*em\s*\d+\s*horas/g
      ],
      timeframes: [
        /há\s*\d+\s*dias?/g, /há\s*\d+\s*semanas?/g, /há\s*\d+\s*meses?/g,
        /há\s*\d+\s*anos?/g, /desde\s*\w+/g, /faz\s*\d+\s*\w+/g,
        /ontem/g, /hoje/g, /amanhã/g, /semana\s*passada/g,
        /mês\s*passado/g, /ano\s*passado/g
      ]
    }
    
    // Extract entities using dictionaries
    for (const [category, terms] of Object.entries(medicalDictionaries)) {
      if (Array.isArray(terms)) {
        // String-based terms
        for (const term of terms) {
          const regex = new RegExp(`\\b${term}\\b`, 'gi')
          let match
          while ((match = regex.exec(text)) !== null) {
            entities.push({
              text: match[0],
              startTime: 0, // Will be mapped later
              endTime: 0,
              confidence: 0.9,
              category: category,
              subcategory: 'dictionary_match'
            })
          }
        }
      } else {
        // Regex-based terms
        for (const regex of terms) {
          let match
          while ((match = regex.exec(text)) !== null) {
            entities.push({
              text: match[0],
              startTime: 0, // Will be mapped later  
              endTime: 0,
              confidence: 0.85,
              category: category,
              subcategory: 'pattern_match'
            })
          }
        }
      }
    }
    
    return entities
  }
  
  private async extractWithOpenAI(params: {
    transcript: AssembledTranscript
    language: string
  }): Promise<MedicalEntity[]> {
    
    const entities: MedicalEntity[] = []
    
    try {
      const prompt = `
Extract medical entities from this Portuguese psychiatric consultation transcript.
Focus on medications, symptoms, conditions, procedures, dosages, and timeframes.

Transcript:
${params.transcript.fullText.substring(0, 4000)} // Limit for token size

Return a JSON array of entities with format:
{
  "text": "entity text",
  "category": "medications|symptoms|conditions|procedures|dosages|timeframes", 
  "confidence": 0.0-1.0,
  "normalizedText": "standardized form"
}
`
      
      const response = await fetch(`${this.config.openAI.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.openAI.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{
            role: 'user',
            content: prompt
          }],
          temperature: 0.1,
          max_tokens: 2000
        })
      })
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`)
      }
      
      const result = await response.json()
      const content = result.choices?.[0]?.message?.content
      
      if (content) {
        try {
          const extractedEntities = JSON.parse(content)
          for (const entity of extractedEntities) {
            entities.push({
              text: entity.text,
              startTime: 0, // Will be mapped later
              endTime: 0,
              confidence: entity.confidence || 0.8,
              category: entity.category,
              subcategory: 'openai_extraction',
              normalizedText: entity.normalizedText
            })
          }
        } catch (parseError) {
          console.error('Failed to parse OpenAI response:', parseError)
        }
      }
      
    } catch (error) {
      console.error('OpenAI entity extraction failed:', error)
      // Don't throw - continue with other methods
    }
    
    return entities
  }
  
  private async mergeAndDeduplicateEntities(
    entityLists: MedicalEntity[][]
  ): Promise<MedicalEntity[]> {
    
    const allEntities = entityLists.flat()
    const deduplicatedEntities: MedicalEntity[] = []
    
    for (const entity of allEntities) {
      // Check for duplicates based on text similarity
      const isDuplicate = deduplicatedEntities.some(existing => 
        this.calculateTextSimilarity(entity.text, existing.text) > 0.8 &&
        entity.category === existing.category
      )
      
      if (!isDuplicate) {
        deduplicatedEntities.push(entity)
      } else {
        // Merge with existing entity (keep higher confidence)
        const existingIndex = deduplicatedEntities.findIndex(existing =>
          this.calculateTextSimilarity(entity.text, existing.text) > 0.8 &&
          entity.category === existing.category
        )
        
        if (entity.confidence > deduplicatedEntities[existingIndex].confidence) {
          deduplicatedEntities[existingIndex] = entity
        }
      }
    }
    
    return deduplicatedEntities
  }
  
  private async mapEntitiesToTimeline(params: {
    entities: MedicalEntity[]
    segments: any[]
  }): Promise<MedicalEntity[]> {
    
    const { entities, segments } = params
    const mappedEntities: MedicalEntity[] = []
    
    for (const entity of entities) {
      // Find the segment that contains this entity text
      let bestMatch: { segment: any, index: number } | null = null
      let bestScore = 0
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        const score = this.calculateTextSimilarity(
          entity.text.toLowerCase(),
          segment.text.toLowerCase()
        )
        
        if (score > bestScore && score > 0.3) {
          bestScore = score
          bestMatch = { segment, index: i }
        }
      }
      
      if (bestMatch) {
        mappedEntities.push({
          ...entity,
          startTime: bestMatch.segment.startTime,
          endTime: bestMatch.segment.endTime
        })
      } else {
        // If no good match found, estimate timing
        const estimatedTime = Math.random() * (segments[segments.length - 1]?.endTime || 0)
        mappedEntities.push({
          ...entity,
          startTime: estimatedTime,
          endTime: estimatedTime + 1
        })
      }
    }
    
    return mappedEntities
  }
  
  private categorizeEntities(entities: MedicalEntity[]): MedicalEntities {
    const categorized: MedicalEntities = {
      medications: [],
      symptoms: [],
      procedures: [],
      anatomical: [],
      dosages: [],
      timeframes: [],
      conditions: []
    }
    
    for (const entity of entities) {
      const category = entity.category as keyof MedicalEntities
      if (categorized[category]) {
        categorized[category].push(entity)
      }
    }
    
    // Sort by confidence within each category
    for (const category of Object.keys(categorized) as (keyof MedicalEntities)[]) {
      categorized[category].sort((a, b) => b.confidence - a.confidence)
    }
    
    return categorized
  }
  
  async identifyMedicalSections(params: {
    transcript: AssembledTranscript
    entities: MedicalEntities
    speakers: any[]
  }): Promise<StructuredSections> {
    
    const { transcript, entities, speakers } = params
    const sections: StructuredSections = {}
    
    // Pattern matching for common consultation sections
    const sectionPatterns = {
      greeting: [
        /bom\s*dia/i, /boa\s*tarde/i, /boa\s*noite/i,
        /como\s*está/i, /tudo\s*bem/i, /como\s*vai/i
      ],
      chief_complaint: [
        /o\s*que.*traz/i, /principal.*problema/i, /como.*sente/i,
        /qual.*queixa/i, /motivo.*consulta/i, /por\s*que.*veio/i
      ],
      history: [
        /há\s*quanto\s*tempo/i, /desde\s*quando/i, /história/i,
        /antecedentes/i, /começou/i, /iniciou/i, /primeiro.*episódio/i
      ],
      examination: [
        /vamos\s*examinar/i, /exame/i, /avaliação/i,
        /teste/i, /escala/i, /questionário/i
      ],
      plan: [
        /vamos.*fazer/i, /tratamento/i, /medicação/i,
        /retorno/i, /próxima.*consulta/i, /seguimento/i
      ],
      closing: [
        /até.*próxima/i, /tchau/i, /obrigad/i,
        /pode.*ir/i, /nos.*vemos/i, /até.*logo/i
      ]
    }
    
    // Identify sections based on patterns
    for (const [sectionName, patterns] of Object.entries(sectionPatterns)) {
      const sectionSegments = this.findSectionSegments(transcript.segments, patterns)
      
      if (sectionSegments.length > 0) {
        const sectionEntities = this.getEntitiesInTimeRange(
          entities,
          sectionSegments[0].startTime,
          sectionSegments[sectionSegments.length - 1].endTime
        )
        
        sections[sectionName as keyof StructuredSections] = {
          startTime: sectionSegments[0].startTime,
          endTime: sectionSegments[sectionSegments.length - 1].endTime,
          speakerId: sectionSegments[0].speakerId,
          text: sectionSegments.map(s => s.text).join(' '),
          entities: sectionEntities,
          confidence: sectionSegments.reduce((sum, s) => sum + s.confidence, 0) / sectionSegments.length
        }
      }
    }
    
    return sections
  }
  
  private findSectionSegments(segments: any[], patterns: RegExp[]): any[] {
    const matchingSegments: any[] = []
    
    for (const segment of segments) {
      for (const pattern of patterns) {
        if (pattern.test(segment.text)) {
          matchingSegments.push(segment)
          break
        }
      }
    }
    
    return matchingSegments
  }
  
  private getEntitiesInTimeRange(
    entities: MedicalEntities,
    startTime: number,
    endTime: number
  ): MedicalEntity[] {
    
    const entitiesInRange: MedicalEntity[] = []
    
    for (const categoryEntities of Object.values(entities)) {
      for (const entity of categoryEntities) {
        if (entity.startTime >= startTime && entity.endTime <= endTime) {
          entitiesInRange.push(entity)
        }
      }
    }
    
    return entitiesInRange
  }
  
  private mapAzureCategory(azureCategory: string): string {
    const categoryMapping: Record<string, string> = {
      'MedicationName': 'medications',
      'Dosage': 'dosages',
      'MedicationForm': 'medications',
      'Frequency': 'dosages',
      'SymptomOrSign': 'symptoms',
      'DiagnosisName': 'conditions',
      'ProcedureName': 'procedures',
      'BodyStructure': 'anatomical',
      'Time': 'timeframes',
      'Duration': 'timeframes'
    }
    
    return categoryMapping[azureCategory] || 'conditions'
  }
  
  private calculateTextSimilarity(text1: string, text2: string): number {
    // Simple Jaccard similarity
    const words1 = new Set(text1.toLowerCase().split(/\s+/))
    const words2 = new Set(text2.toLowerCase().split(/\s+/))
    
    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])
    
    return intersection.size / union.size
  }
}
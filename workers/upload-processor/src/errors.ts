export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ProcessingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProcessingError'
  }
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

export class ExternalServiceError extends Error {
  constructor(message: string, public service: string, public statusCode?: number) {
    super(message)
    this.name = 'ExternalServiceError'
  }
}

export function handleError(error: unknown): {
  status: number
  error: string
  message: string
} {
  console.error('Error details:', error)

  if (error instanceof ValidationError) {
    return {
      status: 400,
      error: 'validation_error',
      message: error.message
    }
  }

  if (error instanceof ProcessingError) {
    return {
      status: 422,
      error: 'processing_error',
      message: error.message
    }
  }

  if (error instanceof StorageError) {
    return {
      status: 503,
      error: 'storage_error',
      message: 'Storage service temporarily unavailable'
    }
  }

  if (error instanceof ExternalServiceError) {
    return {
      status: 502,
      error: 'external_service_error',
      message: `${error.service} is temporarily unavailable`
    }
  }

  // Generic error
  return {
    status: 500,
    error: 'internal_error',
    message: 'An unexpected error occurred'
  }
}
import { Context } from 'hono'

export interface AuthValidationResult {
  valid: boolean
  error?: string
}

export function validateInterWorkerAuth(c: Context, expectedToken: string): AuthValidationResult {
  const authHeader = c.req.header('authorization')
  
  if (!authHeader) {
    return {
      valid: false,
      error: 'Missing authorization header'
    }
  }

  const token = authHeader.replace('Bearer ', '')
  
  if (!token) {
    return {
      valid: false,
      error: 'Invalid authorization format'
    }
  }

  if (token !== expectedToken) {
    return {
      valid: false,
      error: 'Invalid token'
    }
  }

  return { valid: true }
}

export function validateApiKey(c: Context, validApiKeys: string[]): AuthValidationResult {
  const apiKey = c.req.header('x-api-key')
  
  if (!apiKey) {
    return {
      valid: false,
      error: 'Missing API key'
    }
  }

  if (!validApiKeys.includes(apiKey)) {
    return {
      valid: false,
      error: 'Invalid API key'
    }
  }

  return { valid: true }
}

export function extractClientInfo(c: Context): {
  userAgent: string
  ip: string
  country: string
  requestId: string
} {
  return {
    userAgent: c.req.header('user-agent') || '',
    ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '',
    country: c.req.header('cf-ipcountry') || '',
    requestId: c.req.header('cf-ray') || crypto.randomUUID()
  }
}
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

export function validateAdminAuth(c: Context, adminKey: string): AuthValidationResult {
  const providedKey = c.req.header('x-admin-key')
  
  if (!providedKey) {
    return {
      valid: false,
      error: 'Missing admin key'
    }
  }

  if (providedKey !== adminKey) {
    return {
      valid: false,
      error: 'Invalid admin key'
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

export function createAuthToken(): string {
  // Generate a secure random token
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function hashToken(token: string): Promise<string> {
  // Hash token for secure storage (if needed)
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  return crypto.subtle.digest('SHA-256', data).then(hash => {
    return Array.from(new Uint8Array(hash), byte => 
      byte.toString(16).padStart(2, '0')
    ).join('')
  })
}
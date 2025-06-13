# STT Pipeline - Deployment Guide

This guide will help you deploy the complete Speech-to-Text pipeline to production.

## Prerequisites

1. **Cloudflare Account** with Workers Paid plan (required for KV and R2)
2. **Azure Account** with access to:
   - Azure OpenAI Service (Brazil Southeast region)
   - Azure Cognitive Services (Brazil Southeast region)
3. **OpenAI Account** with API access
4. **Wrangler CLI** installed: `npm install -g wrangler`
5. **Node.js 18+** for local development

## Azure Resources Setup

### 1. Azure OpenAI Service
```bash
# Create resource group in Brazil Southeast
az group create --name voither-brazil --location brazilsouth

# Create Azure OpenAI resource
az cognitiveservices account create \
  --name voither-openai-brazil \
  --resource-group voither-brazil \
  --location brazilsouth \
  --kind OpenAI \
  --sku S0

# Deploy Whisper model
az cognitiveservices account deployment create \
  --name voither-openai-brazil \
  --resource-group voither-brazil \
  --deployment-name whisper-1 \
  --model-name whisper \
  --model-version "001" \
  --model-format OpenAI \
  --scale-settings-scale-type "Standard"
```

### 2. Azure Cognitive Services
```bash
# Create Cognitive Services for Medical NER
az cognitiveservices account create \
  --name voither-cognitive-brazil \
  --resource-group voither-brazil \
  --location brazilsouth \
  --kind TextAnalytics \
  --sku S
```

### 3. Get API Keys
```bash
# Get Azure OpenAI API key
az cognitiveservices account keys list \
  --name voither-openai-brazil \
  --resource-group voither-brazil

# Get Cognitive Services API key
az cognitiveservices account keys list \
  --name voither-cognitive-brazil \
  --resource-group voither-brazil
```

## Cloudflare Setup

### 1. Login to Cloudflare
```bash
wrangler login
```

### 2. Create KV Namespaces
```bash
# Production KV namespace
wrangler kv:namespace create "STT_JOBS"
# Note the ID: Replace in wrangler.toml files

# Preview KV namespace
wrangler kv:namespace create "STT_JOBS" --preview
# Note the ID: Replace in wrangler.toml files
```

### 3. Create R2 Buckets
```bash
# Audio storage bucket
wrangler r2 bucket create stt-audio-chunks

# Results storage bucket  
wrangler r2 bucket create stt-results

# Development buckets
wrangler r2 bucket create stt-audio-chunks-dev
wrangler r2 bucket create stt-results-dev
```

### 4. Update Configuration
Update the KV namespace IDs in all `wrangler.toml` files:
- Replace `b8e5f5a1234567890abcdef1234567890` with your actual KV namespace ID
- Replace `b8e5f5a1234567890abcdef1234567891` with your preview KV namespace ID

## Secrets Configuration

Run the automated secrets setup:
```bash
./setup-secrets.sh
```

Or manually configure secrets for each worker:

### Upload Processor
```bash
cd workers/upload-processor
wrangler secret put INTER_WORKER_TOKEN
wrangler secret put CLIENT_API_KEY_1
wrangler secret put CLIENT_API_KEY_2
wrangler secret put CLIENT_API_KEY_3
wrangler secret put VAD_WORKER_TOKEN
```

### Transcription Engine
```bash
cd workers/transcription-engine
wrangler secret put AZURE_OPENAI_API_KEY
wrangler secret put INTER_WORKER_TOKEN
```

### Assembly NER
```bash
cd workers/assembly-ner
wrangler secret put AZURE_AI_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put INTER_WORKER_TOKEN
wrangler secret put ADMIN_API_KEY
```

## Worker Deployment

Deploy all workers in order:

### 1. Upload Processor
```bash
cd workers/upload-processor
npm install
wrangler deploy
```

### 2. Transcription Engine
```bash
cd workers/transcription-engine
npm install
wrangler deploy
```

### 3. Assembly NER
```bash
cd workers/assembly-ner
npm install
wrangler deploy
```

## Verification

### 1. Health Checks
```bash
# Test all workers are healthy
curl https://stt-upload-processor.voitherbrazil.workers.dev/health
curl https://stt-transcription-engine.voitherbrazil.workers.dev/health
curl https://stt-assembly-ner.voitherbrazil.workers.dev/health
```

### 2. End-to-End Test
```bash
# Upload a small audio file for testing
curl -X POST https://stt-upload-processor.voitherbrazil.workers.dev/upload \
  -H "X-API-Key: your-client-api-key" \
  -F "audio=@test-audio.mp3" \
  -F 'options={"language":"pt","speakers":2,"format":"json"}'
```

## Production Considerations

### Security
- [ ] Configure proper CORS origins
- [ ] Set up rate limiting
- [ ] Enable Web Application Firewall (WAF)
- [ ] Implement request signing for sensitive endpoints
- [ ] Regular key rotation schedule

### Monitoring
- [ ] Set up Cloudflare Analytics
- [ ] Configure Azure Monitor for Azure services
- [ ] Set up alerting for failures and high latency
- [ ] Monitor KV and R2 usage/costs

### Scaling
- [ ] Configure KEDA for auto-scaling (if using AKS)
- [ ] Set appropriate worker limits and timeouts
- [ ] Monitor queue lengths and processing times
- [ ] Plan for burst capacity during high usage

### Compliance (LGPD)
- [ ] Ensure all data processing stays in Brazil
- [ ] Implement data retention policies
- [ ] Set up audit logging
- [ ] Document data processing activities
- [ ] Implement data subject rights (export/delete)

### Performance
- [ ] Test with various audio file sizes and formats
- [ ] Optimize chunk sizes for your typical audio length
- [ ] Monitor and tune worker memory limits
- [ ] Consider implementing caching for repeated requests

## Troubleshooting

### Common Issues

1. **"KV namespace not found"**
   - Verify KV namespace IDs in wrangler.toml
   - Ensure namespaces are created in correct account

2. **"R2 bucket not found"**
   - Check bucket names match wrangler.toml
   - Verify R2 is enabled on your Cloudflare account

3. **"Azure OpenAI API errors"**
   - Confirm Whisper model is deployed
   - Check API key and endpoint configuration
   - Verify quota and rate limits

4. **"Worker timeout"**
   - Increase timeout limits in wrangler.toml
   - Optimize audio processing chunk sizes
   - Consider implementing queue-based processing

### Logs and Debugging
```bash
# View worker logs
wrangler tail [worker-name]

# View specific deployment logs
wrangler tail [worker-name] --format pretty

# Debug KV operations
wrangler kv:key list --namespace-id [namespace-id]
```

## Support

For technical support or questions:
- Check worker logs: `wrangler tail [worker-name]`
- Monitor Azure service health: Azure Portal > Service Health
- Cloudflare status: https://www.cloudflarestatus.com/
- Review this documentation and code comments
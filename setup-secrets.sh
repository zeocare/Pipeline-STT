#!/bin/bash

# STT Pipeline - Secrets Configuration Script
# This script sets up all required secrets for the Cloudflare Workers

echo "🔐 Setting up STT Pipeline Secrets..."
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to prompt for secret and set it
set_secret() {
    local worker=$1
    local secret_name=$2
    local description=$3
    local example=$4
    
    echo -e "${YELLOW}Setting ${secret_name} for ${worker}${NC}"
    echo "Description: ${description}"
    echo "Example format: ${example}"
    echo -n "Enter value (or press Enter to skip): "
    read -s secret_value
    echo ""
    
    if [[ -n "$secret_value" ]]; then
        cd "workers/${worker}"
        if wrangler secret put "$secret_name" <<< "$secret_value"; then
            echo -e "${GREEN}✅ ${secret_name} set successfully${NC}"
        else
            echo -e "${RED}❌ Failed to set ${secret_name}${NC}"
        fi
        cd "../.."
        echo ""
    else
        echo -e "${YELLOW}⏭️  Skipped ${secret_name}${NC}"
        echo ""
    fi
}

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI not found. Please install with: npm install -g wrangler${NC}"
    exit 1
fi

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}🔑 Please login to Cloudflare first:${NC}"
    echo "wrangler login"
    exit 1
fi

echo -e "${GREEN}🚀 Ready to configure secrets!${NC}"
echo ""

# Upload Processor Secrets
echo "=== UPLOAD PROCESSOR WORKER ==="
set_secret "upload-processor" "INTER_WORKER_TOKEN" "Shared authentication token between workers" "a-secure-random-string-123"
set_secret "upload-processor" "CLIENT_API_KEY_1" "Client API key #1 for authentication" "client_key_abc123"
set_secret "upload-processor" "CLIENT_API_KEY_2" "Client API key #2 for authentication" "client_key_def456"
set_secret "upload-processor" "CLIENT_API_KEY_3" "Client API key #3 for authentication" "client_key_ghi789"
set_secret "upload-processor" "VAD_WORKER_TOKEN" "Voice Activity Detection worker token" "vad_token_xyz789"

# Transcription Engine Secrets
echo "=== TRANSCRIPTION ENGINE WORKER ==="
set_secret "transcription-engine" "AZURE_OPENAI_API_KEY" "Azure OpenAI API key for Whisper" "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
set_secret "transcription-engine" "INTER_WORKER_TOKEN" "Shared authentication token between workers" "a-secure-random-string-123"

# Assembly NER Secrets
echo "=== ASSEMBLY NER WORKER ==="
set_secret "assembly-ner" "AZURE_AI_API_KEY" "Azure Cognitive Services API key" "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
set_secret "assembly-ner" "OPENAI_API_KEY" "OpenAI API key for medical NER" "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
set_secret "assembly-ner" "INTER_WORKER_TOKEN" "Shared authentication token between workers" "a-secure-random-string-123"
set_secret "assembly-ner" "ADMIN_API_KEY" "Admin API key for monitoring endpoints" "admin_key_secure_123"

echo "================================================"
echo -e "${GREEN}🎉 Secrets configuration completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Create KV namespaces: wrangler kv:namespace create STT_JOBS"
echo "2. Create R2 buckets: wrangler r2 bucket create stt-audio-chunks"
echo "3. Create R2 buckets: wrangler r2 bucket create stt-results"
echo "4. Update wrangler.toml files with actual KV namespace IDs"
echo "5. Deploy workers: cd workers/[worker-name] && wrangler deploy"
echo ""
echo -e "${YELLOW}⚠️  Remember to:${NC}"
echo "- Set up Azure OpenAI resource in Brazil Southeast region"
echo "- Set up Azure Cognitive Services in Brazil Southeast region"
echo "- Configure proper CORS domains in production"
echo "- Set up monitoring and alerting"
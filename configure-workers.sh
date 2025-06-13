#!/bin/bash

# STT Pipeline - Cloudflare Workers Configuration Script
# This script configures all Cloudflare Workers with the deployed Azure resources

set -e
source .env

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Configuring STT Pipeline Cloudflare Workers${NC}"
echo "================================================"
echo "Using Azure resources created in: $AZURE_RESOURCE_GROUP"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI not found. Please install with: npm install -g wrangler${NC}"
    exit 1
fi

# Check if user is logged in to Cloudflare
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}🔑 Please login to Cloudflare first:${NC}"
    echo "wrangler login"
    exit 1
fi

# Function to set secret for a worker
set_worker_secret() {
    local worker_dir=$1
    local secret_name=$2
    local secret_value=$3
    local description=$4
    
    echo -n "Setting ${secret_name} for ${worker_dir}... "
    cd "workers/${worker_dir}"
    
    if echo "$secret_value" | wrangler secret put "$secret_name" >/dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
    else
        echo -e "${RED}❌${NC}"
        echo "Failed to set $secret_name for $worker_dir"
    fi
    
    cd "../.."
}

# Check if OpenAI API key is set
if [[ -z "$OPENAI_API_KEY" ]]; then
    echo -e "${YELLOW}⚠️  OpenAI API key not found in .env file${NC}"
    echo "Please add your OpenAI API key to .env file:"
    echo "OPENAI_API_KEY=sk-your-openai-api-key-here"
    echo ""
    read -p "Enter your OpenAI API key now (or press Enter to skip): " openai_key
    if [[ -n "$openai_key" ]]; then
        echo "OPENAI_API_KEY=$openai_key" >> .env
        export OPENAI_API_KEY="$openai_key"
    fi
fi

echo -e "${YELLOW}📦 Configuring Upload Processor Worker...${NC}"
set_worker_secret "upload-processor" "INTER_WORKER_TOKEN" "$INTER_WORKER_TOKEN" "Inter-worker authentication token"
set_worker_secret "upload-processor" "CLIENT_API_KEY_1" "$CLIENT_API_KEY_1" "Client API key #1"
set_worker_secret "upload-processor" "CLIENT_API_KEY_2" "$CLIENT_API_KEY_2" "Client API key #2"
set_worker_secret "upload-processor" "CLIENT_API_KEY_3" "$CLIENT_API_KEY_3" "Client API key #3"
set_worker_secret "upload-processor" "VAD_WORKER_TOKEN" "$VAD_WORKER_TOKEN" "VAD worker token"

echo ""
echo -e "${YELLOW}🎤 Configuring Transcription Engine Worker...${NC}"
set_worker_secret "transcription-engine" "AZURE_OPENAI_API_KEY" "$AZURE_OPENAI_API_KEY" "Azure OpenAI API key"
set_worker_secret "transcription-engine" "INTER_WORKER_TOKEN" "$INTER_WORKER_TOKEN" "Inter-worker authentication token"

echo ""
echo -e "${YELLOW}🧠 Configuring Assembly NER Worker...${NC}"
set_worker_secret "assembly-ner" "AZURE_AI_API_KEY" "$AZURE_AI_API_KEY" "Azure AI Text Analytics key"
set_worker_secret "assembly-ner" "INTER_WORKER_TOKEN" "$INTER_WORKER_TOKEN" "Inter-worker authentication token"
set_worker_secret "assembly-ner" "ADMIN_API_KEY" "$ADMIN_API_KEY" "Admin API key"

if [[ -n "$OPENAI_API_KEY" ]]; then
    set_worker_secret "assembly-ner" "OPENAI_API_KEY" "$OPENAI_API_KEY" "OpenAI API key"
else
    echo -e "${YELLOW}⏭️  Skipping OpenAI API key (not provided)${NC}"
fi

echo ""
echo -e "${YELLOW}📝 Updating Worker Configuration Files...${NC}"

# Update wrangler.toml files with correct endpoints
echo -n "Updating transcription-engine wrangler.toml... "
sed -i "s|AZURE_OPENAI_ENDPOINT = \".*\"|AZURE_OPENAI_ENDPOINT = \"$AZURE_OPENAI_ENDPOINT\"|" workers/transcription-engine/wrangler.toml
echo -e "${GREEN}✅${NC}"

echo -n "Updating assembly-ner wrangler.toml... "
sed -i "s|AZURE_AI_ENDPOINT = \".*\"|AZURE_AI_ENDPOINT = \"$AZURE_AI_ENDPOINT\"|" workers/assembly-ner/wrangler.toml
echo -e "${GREEN}✅${NC}"

echo ""
echo -e "${YELLOW}🚀 Deploying Workers...${NC}"

# Deploy Upload Processor
echo -n "Deploying upload-processor... "
cd workers/upload-processor
if npm install >/dev/null 2>&1 && wrangler deploy >/dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
fi
cd ../..

# Deploy Transcription Engine
echo -n "Deploying transcription-engine... "
cd workers/transcription-engine
if npm install >/dev/null 2>&1 && wrangler deploy >/dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
fi
cd ../..

# Deploy Assembly NER
echo -n "Deploying assembly-ner... "
cd workers/assembly-ner
if npm install >/dev/null 2>&1 && wrangler deploy >/dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
fi
cd ../..

echo ""
echo -e "${YELLOW}🧪 Testing Worker Health...${NC}"

# Test worker health endpoints
for worker in "upload-processor" "transcription-engine" "assembly-ner"; do
    echo -n "Testing $worker health... "
    url="https://stt-${worker}.voitherbrazil.workers.dev/health"
    if curl -s -f "$url" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Healthy${NC}"
    else
        echo -e "${RED}❌ Not responding${NC}"
    fi
done

echo ""
echo "================================================"
echo -e "${GREEN}🎉 STT Pipeline Configuration Complete!${NC}"
echo ""
echo -e "${BLUE}📋 Deployment Summary:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}🏢 Azure Resources:${NC}"
echo "  Resource Group: $AZURE_RESOURCE_GROUP"
echo "  OpenAI Service: openai-stt-sweden (Sweden Central)"
echo "  Text Analytics: textanalytics-stt-voither (Brazil South)"
echo "  Models Deployed: whisper-1, gpt-4"
echo ""
echo -e "${YELLOW}☁️  Cloudflare Workers:${NC}"
echo "  Upload Processor: https://stt-upload-processor.voitherbrazil.workers.dev"
echo "  Transcription: https://stt-transcription-engine.voitherbrazil.workers.dev"
echo "  Assembly NER: https://stt-assembly-ner.voitherbrazil.workers.dev"
echo ""
echo -e "${YELLOW}🔐 Authentication:${NC}"
echo "  Client API Keys: $CLIENT_API_KEY_1, $CLIENT_API_KEY_2, $CLIENT_API_KEY_3"
echo "  Admin Key: $ADMIN_API_KEY"
echo ""
echo -e "${YELLOW}🚀 Next Steps:${NC}"
echo "1. Test the pipeline: ./test-pipeline.sh"
echo "2. Create KV namespaces and R2 buckets in Cloudflare dashboard"
echo "3. Update wrangler.toml files with real KV/R2 IDs"
echo "4. Set up monitoring and alerting"
echo ""
echo -e "${BLUE}📚 Test Command:${NC}"
echo "CLIENT_API_KEY=$CLIENT_API_KEY_1 ./test-pipeline.sh"
echo ""
echo -e "${GREEN}Happy transcribing! 🎤➡️📝${NC}"
#!/bin/bash

# STT Pipeline - Quick Deploy for Testing
# Configura apenas o mínimo necessário para funcionar

echo "🚀 STT Pipeline - Quick Deploy para Testes"
echo "=========================================="

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Verificações básicas
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler não encontrado. Instale com: npm install -g wrangler${NC}"
    exit 1
fi

if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}🔑 Faça login no Cloudflare primeiro: wrangler login${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Wrangler configurado${NC}"

# Ler valores do .env para configurar secrets
if [[ ! -f ".env" ]]; then
    echo -e "${RED}❌ Arquivo .env não encontrado${NC}"
    exit 1
fi

source .env

echo -e "${YELLOW}📝 Configurando secrets dos workers...${NC}"

# Upload Processor
echo "Configurando upload-processor..."
cd workers/upload-processor
echo "$INTER_WORKER_TOKEN" | wrangler secret put INTER_WORKER_TOKEN
echo "$CLIENT_API_KEY_1" | wrangler secret put CLIENT_API_KEY_1
echo "$CLIENT_API_KEY_2" | wrangler secret put CLIENT_API_KEY_2  
echo "$CLIENT_API_KEY_3" | wrangler secret put CLIENT_API_KEY_3
echo "$VAD_WORKER_TOKEN" | wrangler secret put VAD_WORKER_TOKEN
cd ../..

# Transcription Engine  
echo "Configurando transcription-engine..."
cd workers/transcription-engine
echo "$AZURE_OPENAI_API_KEY" | wrangler secret put AZURE_OPENAI_API_KEY
echo "$INTER_WORKER_TOKEN" | wrangler secret put INTER_WORKER_TOKEN
cd ../..

# Assembly NER
echo "Configurando assembly-ner..."
cd workers/assembly-ner
echo "$AZURE_AI_API_KEY" | wrangler secret put AZURE_AI_API_KEY
echo "$OPENAI_API_KEY" | wrangler secret put OPENAI_API_KEY
echo "$INTER_WORKER_TOKEN" | wrangler secret put INTER_WORKER_TOKEN
echo "$ADMIN_API_KEY" | wrangler secret put ADMIN_API_KEY
cd ../..

echo -e "${GREEN}✅ Secrets configurados${NC}"

# Deploy dos workers
echo -e "${YELLOW}🚀 Deployando workers...${NC}"

# Upload Processor
echo "Deployando upload-processor..."
cd workers/upload-processor
npm install > /dev/null 2>&1
wrangler deploy
cd ../..

# Transcription Engine
echo "Deployando transcription-engine..."
cd workers/transcription-engine  
npm install > /dev/null 2>&1
wrangler deploy
cd ../..

# Assembly NER
echo "Deployando assembly-ner..."
cd workers/assembly-ner
npm install > /dev/null 2>&1
wrangler deploy
cd ../..

echo -e "${GREEN}🎉 Deploy concluído!${NC}"
echo ""
echo "URLs dos workers:"
echo "📤 Upload: https://stt-upload-processor.voitherbrazil.workers.dev"
echo "🎤 Transcription: https://stt-transcription-engine.voitherbrazil.workers.dev"  
echo "🏥 Assembly: https://stt-assembly-ner.voitherbrazil.workers.dev"
echo ""
echo "Teste básico:"
echo "curl https://stt-upload-processor.voitherbrazil.workers.dev/health"
echo ""
echo -e "${YELLOW}⚠️  Para produção, lembre-se de:${NC}"
echo "- Mover secrets para Key Vault"
echo "- Configurar Azure OpenAI em Brazil South (LGPD)"
echo "- Implementar monitoramento adequado"
# Pipeline STT - Inventário Completo de Secrets & Configurações

**Data**: 2025-06-14  
**Status**: Ambiente de Produção Configurado  
**Região Principal**: Brazil South (LGPD Compliance)

## 🔐 Azure Resources & Endpoints

### Azure OpenAI Services
| Resource | Region | Endpoint | Resource Group | Status |
|----------|--------|----------|----------------|--------|
| `openai-stt-voither` | Brazil South | `https://openai-stt-voither.openai.azure.com/` | `rg-stt-pipeline` | ✅ Active |
| `openai-stt-sweden` | Sweden Central | `https://openai-stt-sweden.openai.azure.com/` | `rg-stt-pipeline` | ⚠️ Backup |
| `openai-stt-whisper` | East US | `https://openai-stt-whisper.openai.azure.com/` | `rg-stt-pipeline` | ⚠️ Backup |

### Azure AI Services
| Resource | Type | Region | Endpoint | Resource Group |
|----------|------|--------|----------|----------------|
| `textanalytics-stt-voither` | Text Analytics | Brazil South | `https://textanalytics-stt-voither.cognitiveservices.azure.com/` | `rg-stt-pipeline` |
| `voither-ai-resource` | AI Services | Brazil South | N/A | `voither-brazilsouth` |

## 🔑 API Keys & Secrets

### Azure OpenAI - Brazil South (PRIMARY)
```
Resource: openai-stt-voither
Key1: 2fe29bdaf37946dc8f574eb25540fd1f
Key2: a42e4b7718bc4111a983e3e47af34748
Endpoint: https://openai-stt-voither.openai.azure.com/
API Version: 2024-02-15-preview
Model: whisper-1
```

### Azure OpenAI - Sweden (BACKUP)
```
Resource: openai-stt-sweden
Key1: a9a1d868ca37463182ece0ae26f21e03
Key2: [Hidden - Available via Azure CLI]
Endpoint: https://openai-stt-sweden.openai.azure.com/
```

### Azure Text Analytics - Brazil South
```
Resource: textanalytics-stt-voither
Key1: 923a38c2062543b79f448493676e1dd8
Key2: fb0cd53b851041c78231eea64f7468d6
Endpoint: https://textanalytics-stt-voither.cognitiveservices.azure.com/
API Version: 2023-04-01
```

## 🌐 Cloudflare Workers

### Worker URLs
| Worker | URL | Status |
|--------|-----|--------|
| Upload Processor | `https://stt-upload-processor.gms-1a4.workers.dev` | ✅ Active |
| Transcription Engine | `https://stt-transcription-engine.gms-1a4.workers.dev` | ✅ Active |
| Assembly NER | `https://stt-assembly-ner.gms-1a4.workers.dev` | ✅ Active |

### Cloudflare Account
```
Account ID: 1a481f7cdb7027c30174a692c89cbda1
User: gms@ireaje.cloud
Domain: gms-1a4.workers.dev
```

## 🔐 Worker Secrets (Configured via Wrangler)

### Upload Processor Secrets
```
INTER_WORKER_TOKEN: f3b9964f99da33af7c6227e117046a6e0d8afc7a196aee2e28c42601bf0bcfc4
CLIENT_API_KEY_1: [Generated 24-char hex via openssl]
```

### Transcription Engine Secrets
```
AZURE_OPENAI_API_KEY: 2fe29bdaf37946dc8f574eb25540fd1f
INTER_WORKER_TOKEN: f3b9964f99da33af7c6227e117046a6e0d8afc7a196aee2e28c42601bf0bcfc4
```

### Assembly NER Secrets
```
AZURE_AI_API_KEY: 923a38c2062543b79f448493676e1dd8
INTER_WORKER_TOKEN: f3b9964f99da33af7c6227e117046a6e0d8afc7a196aee2e28c42601bf0bcfc4
```

## ⚙️ Environment Variables (wrangler.toml)

### Upload Processor
```
ENVIRONMENT: production
MAX_FILE_SIZE_MB: 500
CHUNK_SIZE_MB: 25
SUPPORTED_FORMATS: mp3,wav,m4a,flac,ogg,mp4,avi,mov
```

### Transcription Engine
```
ENVIRONMENT: production
AZURE_OPENAI_ENDPOINT: https://openai-stt-voither.openai.azure.com/
AZURE_OPENAI_API_VERSION: 2024-02-15-preview
WHISPER_MODEL: whisper-1
MAX_RETRIES: 3
TIMEOUT_MS: 600000
```

### Assembly NER
```
ENVIRONMENT: production
AZURE_AI_ENDPOINT: https://textanalytics-stt-voither.cognitiveservices.azure.com/
AZURE_AI_API_VERSION: 2023-04-01
OPENAI_API_ENDPOINT: https://api.openai.com
MAX_RETRIES: 3
TIMEOUT_MS: 600000
```

## 📦 Cloudflare Resources

### KV Namespaces
```
STT_JOBS:
  ID: 0c67436e3e304e1eb111f20b6b951928
  Preview ID: 596acaf3c2d14ce2b1aef43d1eed2a36
```

### R2 Buckets
```
AUDIO_STORAGE:
  Bucket: stt-audio-chunks
  Preview: stt-audio-chunks-dev

RESULTS_STORAGE:
  Bucket: stt-results
  Preview: stt-results-dev
```

## 🏥 Azure Key Vault (STT Pipeline)
```
Name: stt-pipeline-kv
Resource Group: rg-stt-pipeline
Location: Brazil South
URI: https://stt-pipeline-kv.vault.azure.net/
Status: ✅ Active & Configured
RBAC: Key Vault Secrets Officer (gms@healthhealth.io)
Retention: 90 days soft delete
```

### Key Vault Secrets Stored
| Secret Name | Description | Status |
|-------------|-------------|--------|
| `azure-openai-key-primary` | Azure OpenAI Brazil South - Primary Key | ✅ Stored |
| `azure-openai-key-backup` | Azure OpenAI Brazil South - Backup Key | ✅ Stored |
| `azure-ai-key-primary` | Azure Text Analytics - Primary Key | ✅ Stored |
| `azure-openai-sweden-key` | Azure OpenAI Sweden - Backup Region | ✅ Stored |
| `inter-worker-token` | Inter-worker communication token | ✅ Stored |
| `cloudflare-account-id` | Cloudflare Account ID | ✅ Stored |

## 🔒 Security Tokens Generated

### Inter-Worker Communication
```
Token: f3b9964f99da33af7c6227e117046a6e0d8afc7a196aee2e28c42601bf0bcfc4
Algorithm: OpenSSL rand -hex 32
Usage: Secure communication between workers
Configured: All 3 workers
```

### Client API Keys
```
CLIENT_API_KEY_1: [24-char hex generated via openssl]
Usage: Client authentication for upload processor
```

## 📋 Deployment Commands

### Wrangler Secret Configuration
```bash
# Transcription Engine
echo "2fe29bdaf37946dc8f574eb25540fd1f" | wrangler secret put AZURE_OPENAI_API_KEY
echo "f3b9964f99da33af7c6227e117046a6e0d8afc7a196aee2e28c42601bf0bcfc4" | wrangler secret put INTER_WORKER_TOKEN

# Assembly NER
echo "923a38c2062543b79f448493676e1dd8" | wrangler secret put AZURE_AI_API_KEY
echo "f3b9964f99da33af7c6227e117046a6e0d8afc7a196aee2e28c42601bf0bcfc4" | wrangler secret put INTER_WORKER_TOKEN

# Upload Processor
echo "f3b9964f99da33af7c6227e117046a6e0d8afc7a196aee2e28c42601bf0bcfc4" | wrangler secret put INTER_WORKER_TOKEN
openssl rand -hex 24 | wrangler secret put CLIENT_API_KEY_1
```

## ✅ Key Vault Migration Complete

### Actual Key Vault Structure
```
stt-pipeline-kv/ (https://stt-pipeline-kv.vault.azure.net/)
├── azure-openai-key-primary ✅
├── azure-openai-key-backup ✅
├── azure-ai-key-primary ✅
├── azure-openai-sweden-key ✅
├── inter-worker-token ✅
└── cloudflare-account-id ✅
```

### Retrieve Secrets Commands
```bash
# Get Azure OpenAI key
az keyvault secret show --vault-name "stt-pipeline-kv" --name "azure-openai-key-primary" --query "value" -o tsv

# Get Text Analytics key
az keyvault secret show --vault-name "stt-pipeline-kv" --name "azure-ai-key-primary" --query "value" -o tsv

# Get inter-worker token
az keyvault secret show --vault-name "stt-pipeline-kv" --name "inter-worker-token" --query "value" -o tsv
```

## ⚠️ Security Notes

1. **LGPD Compliance**: All primary services in Brazil South
2. **Secrets Rotation**: Implement 90-day rotation policy
3. **Access Control**: Limit Key Vault access to deployment principals
4. **Monitoring**: Enable Azure Monitor for all resources
5. **Backup**: Sweden Central as failover region

## 📞 Emergency Contacts
- **Azure Subscription**: gms@healthhealth.io
- **Cloudflare Account**: gms@ireaje.cloud
- **Resource Group**: rg-stt-pipeline

---
**⚠️ CONFIDENTIAL**: Este documento contém informações sensíveis. Migrar para Key Vault imediatamente.
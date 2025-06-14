#!/bin/bash

# Teste rápido do pipeline STT
echo "🧪 Testando STT Pipeline..."

# Health checks
echo "Verificando saúde dos workers..."

echo -n "Upload Processor: "
if curl -s https://stt-upload-processor.voitherbrazil.workers.dev/health | grep -q "healthy"; then
    echo "✅ OK"
else
    echo "❌ ERRO"
fi

echo -n "Transcription Engine: "
if curl -s https://stt-transcription-engine.voitherbrazil.workers.dev/health | grep -q "healthy"; then
    echo "✅ OK"
else
    echo "❌ ERRO"
fi

echo -n "Assembly NER: "
if curl -s https://stt-assembly-ner.voitherbrazil.workers.dev/health | grep -q "healthy"; then
    echo "✅ OK"
else
    echo "❌ ERRO"
fi

echo ""
echo "Pipeline está pronto para testes!"
echo ""
echo "Para testar upload (substitua YOUR_API_KEY):"
echo "curl -X POST https://stt-upload-processor.voitherbrazil.workers.dev/upload \\"
echo "  -H \"X-API-Key: YOUR_API_KEY\" \\"
echo "  -F \"audio=@seu-arquivo.mp3\" \\"
echo "  -F 'options={\"language\":\"pt\",\"speakers\":2,\"format\":\"json\"}'"
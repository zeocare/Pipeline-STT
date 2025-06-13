#!/usr/bin/env python3
"""
Script de teste para verificar se todas as dependências estão instaladas corretamente
para o Pipeline STT
"""

import sys
import importlib
import torch
import warnings

# Suprimir warnings desnecessários
warnings.filterwarnings("ignore")

def test_import(module_name, description=""):
    """Testa se um módulo pode ser importado"""
    try:
        importlib.import_module(module_name)
        print(f"✅ {module_name} - {description}")
        return True
    except ImportError as e:
        print(f"❌ {module_name} - {description} - Error: {e}")
        return False

def test_models():
    """Testa se os modelos podem ser carregados"""
    print("\n🔍 Testando modelos...")
    
    # Teste do spaCy
    try:
        import spacy
        nlp = spacy.load("pt_core_news_lg")
        print("✅ spaCy - Modelo português pt_core_news_lg carregado")
    except Exception as e:
        print(f"❌ spaCy - Erro ao carregar modelo português: {e}")
    
    # Teste do Whisper (modelo pequeno para teste rápido)
    try:
        import whisper
        # Teste apenas se o modelo existe no cache
        import os
        whisper_cache = os.path.expanduser("~/.cache/whisper")
        if os.path.exists(whisper_cache):
            print("✅ Whisper - Cache de modelos encontrado")
        else:
            print("⚠️  Whisper - Cache não encontrado, mas biblioteca funcional")
    except Exception as e:
        print(f"❌ Whisper - Erro: {e}")

def test_pytorch():
    """Testa PyTorch e disponibilidade de GPU"""
    print("\n🔍 Testando PyTorch...")
    
    print(f"✅ PyTorch versão: {torch.__version__}")
    
    if torch.cuda.is_available():
        print(f"✅ CUDA disponível - Dispositivos: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            print(f"  - GPU {i}: {torch.cuda.get_device_name(i)}")
    else:
        print("⚠️  CUDA não disponível - Usando CPU")
    
    # Teste básico de tensor
    try:
        x = torch.randn(3, 3)
        y = torch.randn(3, 3)
        z = torch.matmul(x, y)
        print("✅ PyTorch - Operações básicas funcionando")
    except Exception as e:
        print(f"❌ PyTorch - Erro em operações básicas: {e}")

def main():
    """Função principal de teste"""
    print("🚀 Testando configuração do Pipeline STT\n")
    
    # Lista de módulos essenciais para testar
    essential_modules = [
        ("torch", "PyTorch para computação tensorial"),
        ("torchaudio", "PyTorch Audio para processamento de áudio"),
        ("whisper", "OpenAI Whisper para transcr,ição"),
        ("spacy", "spaCy para processamento de linguagem natural"),
        ("librosa", "Librosa para análise de áudio"),
        ("soundfile", "SoundFile para I/O de arquivos de áudio"),
        ("numpy", "NumPy para computação numérica"),
        ("scipy", "SciPy para computação científica"),
        ("sklearn", "Scikit-learn para machine learning"),
        ("pandas", "Pandas para manipulação de dados"),
    ]
    
    azure_modules = [
        ("azure.functions", "Azure Functions"),
        ("azure.storage.blob", "Azure Blob Storage"),
        ("azure.servicebus", "Azure Service Bus"),
    ]
    
    monitoring_modules = [
        ("opentelemetry", "OpenTelemetry para observabilidade"),
        ("structlog", "Structured logging"),
    ]
    
    web_modules = [
        ("fastapi", "FastAPI para APIs web"),
        ("pydantic", "Pydantic para validação de dados"),
    ]
    
    print("📦 Testando módulos essenciais:")
    essential_ok = all(test_import(module, desc) for module, desc in essential_modules)
    
    print("\n☁️  Testando módulos Azure:")
    azure_ok = all(test_import(module, desc) for module, desc in azure_modules)
    
    print("\n📊 Testando módulos de monitoramento:")
    monitoring_ok = all(test_import(module, desc) for module, desc in monitoring_modules)
    
    print("\n🌐 Testando módulos web:")
    web_ok = all(test_import(module, desc) for module, desc in web_modules)
    
    # Testes específicos
    test_pytorch()
    test_models()
    
    print("\n" + "="*60)
    print("📋 RESUMO DOS TESTES:")
    print(f"Essential modules: {'✅ OK' if essential_ok else '❌ FALHOU'}")
    print(f"Azure modules: {'✅ OK' if azure_ok else '❌ FALHOU'}")
    print(f"Monitoring modules: {'✅ OK' if monitoring_ok else '❌ FALHOU'}")
    print(f"Web modules: {'✅ OK' if web_ok else '❌ FALHOU'}")
    
    if essential_ok:
        print("\n🎉 Setup básico concluído com sucesso!")
        print("Próximos passos:")
        print("1. Configure as variáveis de ambiente do Azure")
        print("2. Execute os testes de integração")
        print("3. Deploy da infraestrutura")
    else:
        print("\n⚠️  Alguns módulos essenciais falharam. Verifique a instalação.")
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
@description('Location for all resources')
param location string = 'brazilsouth'

@description('Unique suffix')
param suffix string = uniqueString(resourceGroup().id)

// Azure OpenAI Service
resource openAiService 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'openai-stt-${suffix}'
  location: location
  sku: {
    name: 'S0'
  }
  kind: 'OpenAI'
  properties: {
    customSubDomainName: 'openai-stt-${suffix}'
    publicNetworkAccess: 'Enabled'
  }
}

// Whisper model deployment
resource whisperDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAiService
  name: 'whisper-1'
  properties: {
    model: {
      format: 'OpenAI'
      name: 'whisper'
      version: '001'
    }
    scaleSettings: {
      scaleType: 'Standard'
    }
  }
}

// GPT-4 model deployment
resource gpt4Deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAiService
  name: 'gpt-4'
  dependsOn: [whisperDeployment]
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4'
      version: '1106-Preview'
    }
    scaleSettings: {
      scaleType: 'Standard'
    }
  }
}

// Azure AI Text Analytics
resource textAnalytics 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'textanalytics-stt-${suffix}'
  location: location
  sku: {
    name: 'S'
  }
  kind: 'TextAnalytics'
  properties: {
    customSubDomainName: 'textanalytics-stt-${suffix}'
    publicNetworkAccess: 'Enabled'
  }
}

// Outputs
output AZURE_OPENAI_ENDPOINT string = openAiService.properties.endpoint
output AZURE_OPENAI_SERVICE_NAME string = openAiService.name
output AZURE_AI_ENDPOINT string = textAnalytics.properties.endpoint
output AZURE_AI_SERVICE_NAME string = textAnalytics.name
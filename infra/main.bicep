@description('Location for all resources')
param location string = 'brazilsouth'

@description('Name of the project')
param projectName string = 'stt-pipeline'

@description('Environment name')
param environmentName string = 'prod'

@description('Unique suffix for resource names')
param resourceSuffix string = uniqueString(resourceGroup().id)

// Variables
var abbrs = loadJsonContent('abbreviations.json')
var tags = {
  'azd-env-name': environmentName
  project: projectName
  environment: environmentName
  purpose: 'speech-to-text-pipeline'
  compliance: 'lgpd-brazil'
}

// Resource names with modern naming conventions
var aiHubName = '${abbrs.cognitiveServicesAccounts}${projectName}-hub-${resourceSuffix}'
var openAiName = '${abbrs.cognitiveServicesAccounts}${projectName}-openai-${resourceSuffix}'
var textAnalyticsName = '${abbrs.cognitiveServicesAccounts}${projectName}-text-${resourceSuffix}'
var storageAccountName = '${abbrs.storageStorageAccounts}${replace(projectName, '-', '')}${resourceSuffix}'
var keyVaultName = '${abbrs.keyVaultVaults}${replace(projectName, '-', '')}${resourceSuffix}'
var logAnalyticsName = '${abbrs.operationalInsightsWorkspaces}${projectName}-${resourceSuffix}'
var appInsightsName = '${abbrs.insightsComponents}${projectName}-${resourceSuffix}'

// Log Analytics Workspace
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      searchVersion: 1
      legacy: 0
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// Storage Account for AI Hub
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    encryption: {
      services: {
        blob: {
          enabled: true
        }
        file: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

// Key Vault for secrets
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    accessPolicies: []
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enableRbacAuthorization: true
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// Azure AI Hub (Modern approach replacing individual AI services)
resource aiHub 'Microsoft.MachineLearningServices/workspaces@2024-04-01' = {
  name: aiHubName
  location: location
  tags: tags
  kind: 'Hub'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: 'STT Pipeline AI Hub'
    description: 'Azure AI Hub for Speech-to-Text Pipeline with Medical NER'
    storageAccount: storageAccount.id
    keyVault: keyVault.id
    applicationInsights: appInsights.id
    hbiWorkspace: false
    v1LegacyMode: false
    publicNetworkAccess: 'Enabled'
    discoveryUrl: 'https://${location}.api.azureml.ms/discovery'
  }
}

// Azure OpenAI Service (Latest API version)
resource openAiService 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAiName
  location: location
  tags: tags
  sku: {
    name: 'S0'
  }
  kind: 'OpenAI'
  properties: {
    customSubDomainName: openAiName
    networkAcls: {
      defaultAction: 'Allow'
    }
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

// Whisper model deployment (Latest version)
resource whisperDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAiService
  name: 'whisper-1'
  properties: {
    model: {
      format: 'OpenAI'
      name: 'whisper'
      version: '001'
    }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'OnceCurrentVersionExpired'
    scaleSettings: {
      scaleType: 'Standard'
    }
  }
}

// GPT-4 model deployment for Medical NER
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
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'OnceCurrentVersionExpired'
    scaleSettings: {
      scaleType: 'Standard'
    }
  }
}

// Azure AI Text Analytics (Latest version)
resource textAnalytics 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: textAnalyticsName
  location: location
  tags: tags
  sku: {
    name: 'S'
  }
  kind: 'TextAnalytics'
  properties: {
    customSubDomainName: textAnalyticsName
    networkAcls: {
      defaultAction: 'Allow'
    }
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

// Role assignments for AI Hub
resource aiHubStorageContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, aiHub.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe') // Storage Blob Data Contributor
    principalId: aiHub.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource aiHubKeyVaultUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, aiHub.id, '4633458b-17de-408a-b874-0445c86b69e6')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Crypto User
    principalId: aiHub.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Store secrets in Key Vault
resource openAiApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-openai-api-key'
  properties: {
    value: openAiService.listKeys().key1
    attributes: {
      enabled: true
    }
    contentType: 'Azure OpenAI API Key'
  }
}

resource textAnalyticsApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-ai-api-key'
  properties: {
    value: textAnalytics.listKeys().key1
    attributes: {
      enabled: true
    }
    contentType: 'Azure AI Text Analytics API Key'
  }
}

resource openAiEndpointSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-openai-endpoint'
  properties: {
    value: openAiService.properties.endpoint
    attributes: {
      enabled: true
    }
    contentType: 'Azure OpenAI Endpoint'
  }
}

resource textAnalyticsEndpointSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-ai-endpoint'
  properties: {
    value: textAnalytics.properties.endpoint
    attributes: {
      enabled: true
    }
    contentType: 'Azure AI Text Analytics Endpoint'
  }
}

// Outputs for configuration (without secrets)
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup().name
output AZURE_AI_HUB_NAME string = aiHub.name
output AZURE_OPENAI_SERVICE_NAME string = openAiService.name
output AZURE_OPENAI_ENDPOINT string = openAiService.properties.endpoint
output AZURE_AI_SERVICE_NAME string = textAnalytics.name
output AZURE_AI_ENDPOINT string = textAnalytics.properties.endpoint
output AZURE_KEY_VAULT_NAME string = keyVault.name
output AZURE_KEY_VAULT_URI string = keyVault.properties.vaultUri
output AZURE_STORAGE_ACCOUNT_NAME string = storageAccount.name
output AZURE_APP_INSIGHTS_CONNECTION_STRING string = appInsights.properties.ConnectionString

// Configuration info (no secrets)
output AZURE_OPENAI_API_VERSION string = '2024-10-21'
output AZURE_AI_API_VERSION string = '2023-04-01'
output WHISPER_MODEL string = 'whisper-1'
output GPT_MODEL string = 'gpt-4'
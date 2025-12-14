import type {
  LanguageModelV2
  // LanguageModelV2Options
} from '@ai-sdk/provider'

export interface BedrockConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export type BedrockModelFactory = (modelId: string) => LanguageModelV2

export type ToolNameMapping = Record<string, string>

export interface BedrockRequestBody {
  [key: string]: any
  _toolMapping?: ToolNameMapping
}

export interface TruncationConfig {
  shouldTruncate: boolean
  maxDescriptionLength: number
  maxPropertyDescLength: number
}

export interface ConvertedPrompt {
  body: BedrockRequestBody
  toolMapping?: ToolNameMapping
}

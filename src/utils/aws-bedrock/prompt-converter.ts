import { convertToClaudeFormat } from './converters/claude'
import {
  convertToLlamaFormat,
  convertToMistralFormat,
  convertToNovaFormat,
  convertToCohereFormat,
  convertToGenericFormat,
  convertToJambaFormat
} from './converters/other-models'
import type { BedrockRequestBody } from './types'

/**
 * Converts AI SDK prompt to the appropriate Bedrock model format
 *
 * Routes to model-specific converters based on modelId prefix:
 * - anthropic.* -> Claude format
 * - meta.llama* -> Llama chat template
 * - mistral.* -> Mistral instruction format
 * - amazon.nova* -> Nova structured format
 * - cohere.* -> Cohere Command R format
 * - * -> Generic text format
 *
 * @param modelId - Bedrock model identifier
 * @param prompt - AI SDK message array
 * @param settings - Generation settings
 * @returns Request body with optional tool mapping
 */
export function convertPromptToBedrock(
  modelId: string,
  prompt: any[],
  settings: any
): BedrockRequestBody {
  if (modelId.startsWith('anthropic.')) {
    const { body, toolMapping } = convertToClaudeFormat(prompt, settings)
    body._toolMapping = toolMapping
    return body
  }

  if (modelId.startsWith('meta.llama') || modelId.startsWith('us.meta.llama')) {
    return convertToLlamaFormat(prompt, settings)
  }

  if (modelId.startsWith('mistral.')) {
    return convertToMistralFormat(prompt, settings)
  }

  if (modelId.startsWith('amazon.nova')) {
    return convertToNovaFormat(prompt, settings)
  }

  if (modelId.startsWith('cohere.')) {
    return convertToCohereFormat(prompt, settings)
  }
  if (modelId.startsWith('ai21.')) {
    return convertToJambaFormat(prompt, settings)
  }

  return convertToGenericFormat(prompt, settings)
}

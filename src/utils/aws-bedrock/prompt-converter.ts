import { convertToClaudeFormat } from './converters/claude'
import { convertToNovaFormat } from './converters/nova'
import {
  convertToLlamaFormat,
  convertToMistralFormat,
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

  if (modelId.startsWith('mistral.') || modelId.startsWith('us.mistral.')) {
    return convertToMistralFormat(prompt, settings)
  }

  if (modelId.startsWith('amazon.nova')) {
    const result = convertToNovaFormat(prompt, settings)

    result.body._toolMapping = result.toolMapping
    result.body._useConverseApi = result.useConverseApi

    return result.body
  }

  if (modelId.startsWith('cohere.')) {
    return convertToCohereFormat(prompt, settings)
  }
  if (modelId.startsWith('ai21.')) {
    return convertToJambaFormat(prompt, settings)
  }

  return convertToGenericFormat(prompt, settings)
}

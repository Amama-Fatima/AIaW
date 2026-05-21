import { convertToClaudeFormat } from './claude/convert-prompt-to-claude-format'
import { convertToCohereFormat } from './cohere/convert-prompt-to-cohere-format'

import { convertToJambaFormat } from './jamba/convert-prompt-to-jamba-format'
import { convertToLlamaFormat } from './llama/convert-prompt-to-llama-format'
import { convertToMistralFormat } from './mistral/convert-prompt-to-mistral-format'
import { convertToNovaFormat } from './nova/convert-prompt-to-nova-format'
import type { BedrockRequestBody } from './types'
import { modelIdStartsWith } from './utils'

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
  if (modelIdStartsWith(modelId, 'anthropic.')) {
    const { body, toolMapping } = convertToClaudeFormat(prompt, settings)
    body._toolMapping = toolMapping
    return body
  }

  if (modelIdStartsWith(modelId, 'meta.llama')) {
    return convertToLlamaFormat(prompt, settings)
  }

  if (modelIdStartsWith(modelId, 'mistral.')) {
    return convertToMistralFormat(prompt, settings, modelId)
  }

  if (modelIdStartsWith(modelId, 'amazon.nova')) {
    const result = convertToNovaFormat(prompt, settings)

    result.body._toolMapping = result.toolMapping
    result.body._useConverseApi = result.useConverseApi

    return result.body
  }

  if (modelIdStartsWith(modelId, 'cohere.')) {
    const result = convertToCohereFormat(prompt, settings)
    result.body._toolMapping = result.toolMapping
    result.body._useConverseApi = result.useConverseApi
    return result.body
  }

  return convertToJambaFormat(prompt, settings)
}

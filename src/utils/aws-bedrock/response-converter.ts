import type { StandardResponse, ToolNameMapping } from './types'
import { convertClaudeResponse } from './claude/convert-claude-response'
import { convertLlamaResponse } from './llama/convert-llama-response'
import { convertNovaResponse } from './nova/convert-nova-response'
import { convertCohereResponse } from './cohere/convert-cohere-response'
import { convertJambaResponse } from './jamba/convert-jamba-response'

function convertMistralResponse(responseBody: any): Partial<StandardResponse> {
  const generatedText = responseBody.outputs?.[0]?.text || ''

  const toolCallMatch = generatedText.match(/\[TOOL_CALL\]\s*(\{.*?\})/s)

  let content: any[]
  if (toolCallMatch) {
    try {
      const toolCall = JSON.parse(toolCallMatch[1])
      content = [{
        type: 'tool-call' as const,
        toolCallId: `call_${Date.now()}`,
        toolName: toolCall.name,
        args: toolCall.arguments
      }]
    } catch {
      content = [{ type: 'text' as const, text: generatedText }]
    }
  } else {
    content = [{ type: 'text' as const, text: generatedText }]
  }

  return {
    content,
    finishReason: responseBody.stop_reason || 'stop',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    }
  }
}

/**
 * Main response converter - routes to model-specific converter
 *
 * @param modelId - Bedrock model identifier
 * @param responseBody - Raw response from Bedrock API
 * @param requestBody - Original request body
 * @param toolMapping - Tool name mapping (for Claude)
 * @returns Standardized AI SDK response
 */
export function convertBedrockResponse(
  modelId: string,
  responseBody: any,
  requestBody: any,
  toolMapping: ToolNameMapping = {}
): StandardResponse {
  let partial: Partial<StandardResponse>

  if (modelId.startsWith('anthropic.')) {
    partial = convertClaudeResponse(responseBody, toolMapping)
  } else if (modelId.startsWith('meta.llama') || modelId.startsWith('us.meta.llama')) {
    partial = convertLlamaResponse(responseBody)
  } else if (modelId.startsWith('mistral.') || modelId.startsWith('us.mistral.')) {
    partial = convertMistralResponse(responseBody)
  } else if (modelId.startsWith('amazon.nova')) {
    partial = convertNovaResponse(responseBody, toolMapping)
  } else if (modelId.startsWith('cohere.')) {
    partial = convertCohereResponse(responseBody)
  } else if (modelId.startsWith('ai21.')) {
    partial = convertJambaResponse(responseBody)
  }

  return {
    content: partial.content || [],
    finishReason: partial.finishReason || 'stop',
    usage: partial.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    request: {
      body: JSON.stringify(requestBody)
    },
    response: {
      id: responseBody.id || `res_${Date.now()}`,
      timestamp: new Date()
    },
    warnings: []
  }
}

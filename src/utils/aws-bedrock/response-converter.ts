// response-converter.ts - Converts Bedrock responses to AI SDK formatx

import type {
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason
} from '@ai-sdk/provider'
import { mapClaudeStopReason } from './utils'
import type { ToolNameMapping } from './types'

interface StandardResponse {
  content: any[]
  finishReason: LanguageModelV2FinishReason
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  request: {
    body: string
  }
  response: {
    id: string
    timestamp: Date
  }
  warnings: LanguageModelV2CallWarning[]
}

function convertClaudeResponse(
  responseBody: any,
  toolMapping: ToolNameMapping
): Partial<StandardResponse> {
  const content = responseBody.content?.map((item: any) => {
    if (item.type === 'text') {
      return { type: 'text' as const, text: item.text }
    }

    if (item.type === 'tool_use') {
      // Restore full tool name using mapping
      const baseToolName = item.name
      const fullToolName = toolMapping[baseToolName] || baseToolName

      return {
        type: 'tool-call' as const,
        toolCallId: item.id,
        toolName: fullToolName,
        args: item.input
      }
    }

    return item
  }) || []

  const finishReason = mapClaudeStopReason(responseBody.stop_reason)
  const inputTokens = responseBody.usage?.input_tokens || 0
  const outputTokens = responseBody.usage?.output_tokens || 0

  return {
    content,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    }
  }
}

function convertLlamaResponse(responseBody: any): Partial<StandardResponse> {
  const generatedText = responseBody.generation || ''

  // Try to parse tool calls from JSON in response
  const toolCallMatch = generatedText.match(/\{"tool":\s*"([^"]+)",\s*"parameters":\s*(\{.*?\})\}/s)

  let content: any[]
  if (toolCallMatch) {
    const toolName = toolCallMatch[1]
    const toolParams = JSON.parse(toolCallMatch[2])

    content = [{
      type: 'tool-call' as const,
      toolCallId: `call_${Date.now()}`,
      toolName,
      args: toolParams
    }]
  } else {
    content = [{ type: 'text' as const, text: generatedText }]
  }

  const finishReason = responseBody.stop_reason === 'stop' ? 'stop' : 'length'
  const inputTokens = responseBody.prompt_token_count || 0
  const outputTokens = responseBody.generation_token_count || 0

  return {
    content,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    }
  }
}

function convertMistralResponse(responseBody: any): Partial<StandardResponse> {
  const generatedText = responseBody.outputs?.[0]?.text || ''

  const toolCallMatch = generatedText.match(/\[TOOL_CALL\]\s*(\{.*?\})/s)

  let content: any[]
  if (toolCallMatch) {
    const toolCall = JSON.parse(toolCallMatch[1])
    content = [{
      type: 'tool-call' as const,
      toolCallId: `call_${Date.now()}`,
      toolName: toolCall.name,
      args: toolCall.arguments
    }]
  } else {
    content = [{ type: 'text' as const, text: generatedText }]
  }

  return {
    content,
    finishReason: 'stop',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  }
}

function convertNovaResponse(responseBody: any): Partial<StandardResponse> {
  const output = responseBody.output?.message

  const content = output?.content?.map((item: any) => {
    if (item.text) {
      return { type: 'text' as const, text: item.text }
    }
    if (item.toolUse) {
      return {
        type: 'tool-call' as const,
        toolCallId: item.toolUse.toolUseId,
        toolName: item.toolUse.name,
        args: item.toolUse.input
      }
    }
    return null
  }).filter(Boolean) || []

  const inputTokens = responseBody.usage?.inputTokens || 0
  const outputTokens = responseBody.usage?.outputTokens || 0
  const finishReason = output?.stopReason === 'end_turn' ? 'stop' : 'length'

  return {
    content,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    }
  }
}

function convertCohereResponse(responseBody: any): Partial<StandardResponse> {
  const text = responseBody.text || ''
  const toolCalls = responseBody.tool_calls || []

  const content: any[] = []

  if (text) {
    content.push({ type: 'text' as const, text })
  }

  toolCalls.forEach((call: any) => {
    content.push({
      type: 'tool-call' as const,
      toolCallId: call.id || `call_${Date.now()}`,
      toolName: call.name,
      args: call.parameters
    })
  })

  return {
    content,
    finishReason: 'stop',
    usage: {
      inputTokens: responseBody.meta?.tokens?.input_tokens || 0,
      outputTokens: responseBody.meta?.tokens?.output_tokens || 0,
      totalTokens: (responseBody.meta?.tokens?.input_tokens || 0) +
        (responseBody.meta?.tokens?.output_tokens || 0)
    }
  }
}

/**
 * Converts generic model response to AI SDK format
 */
function convertGenericResponse(responseBody: any): Partial<StandardResponse> {
  const text = responseBody.completions?.[0]?.data?.text ||
    responseBody.generation || ''

  const toolCallMatch = text.match(/\{"tool":\s*"([^"]+)",\s*"parameters":\s*(\{.*?\})\}/s)

  let content: any[]
  if (toolCallMatch) {
    content = [{
      type: 'tool-call' as const,
      toolCallId: `call_${Date.now()}`,
      toolName: toolCallMatch[1],
      args: JSON.parse(toolCallMatch[2])
    }]
  } else {
    content = [{ type: 'text' as const, text }]
  }

  return {
    content,
    finishReason: 'stop',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
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
  } else if (modelId.startsWith('meta.llama')) {
    partial = convertLlamaResponse(responseBody)
  } else if (modelId.startsWith('mistral.')) {
    partial = convertMistralResponse(responseBody)
  } else if (modelId.startsWith('amazon.nova')) {
    partial = convertNovaResponse(responseBody)
  } else if (modelId.startsWith('cohere.')) {
    partial = convertCohereResponse(responseBody)
  } else {
    partial = convertGenericResponse(responseBody)
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

// utils.ts - Utility helper functions

import type { LanguageModelV2FinishReason } from '@ai-sdk/provider'
import { TruncationConfig } from './types'

/**
 * Extracts the base tool name by removing prefixes
 *
 * Bedrock/Claude strips prefixes from tool names (e.g., MCP server IDs)
 * Example: "106207316cab49-sequential_thinking" -> "sequential_thinking"
 *
 * @param fullName - The full tool name with potential prefix
 * @returns The base tool name without prefix
 */
export function extractBaseToolName(fullName: string): string {
  if (fullName.includes('-')) {
    return fullName.split('-').pop() || fullName
  }
  return fullName
}

/**
 * Maps Claude's stop reasons to AI SDK's LanguageModelV2FinishReason
 *
 * @param reason - Claude's stop reason string
 * @returns Standardized finish reason
 */
export function mapClaudeStopReason(reason: string): LanguageModelV2FinishReason {
  switch (reason) {
    case 'end_turn': return 'stop'
    case 'max_tokens': return 'length'
    case 'stop_sequence': return 'stop'
    case 'tool_use': return 'tool-calls'
    default: return 'stop'
  }
}

/**
 * Determines truncation settings based on total tool count
 *
 * With many MCP tools (150+), descriptions must be truncated to avoid
 * exceeding Bedrock's input token limits
 *
 * @param toolCount - Total number of tools
 * @returns Truncation configuration
 */
export function getTruncationConfig(toolCount: number): TruncationConfig {
  if (toolCount > 150) {
    return {
      shouldTruncate: true,
      maxDescriptionLength: 50,
      maxPropertyDescLength: 60
    }
  } else if (toolCount > 100) {
    return {
      shouldTruncate: true,
      maxDescriptionLength: 80,
      maxPropertyDescLength: 80
    }
  } else if (toolCount > 50) {
    return {
      shouldTruncate: true,
      maxDescriptionLength: 120,
      maxPropertyDescLength: 100
    }
  }

  return {
    shouldTruncate: false,
    maxDescriptionLength: Infinity,
    maxPropertyDescLength: Infinity
  }
}

/**
 * Truncates a string if it exceeds maximum length
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum allowed length
 * @returns Truncated text with "..." or original text
 */
export function truncateText(text: string, maxLength: number): string {
  if (maxLength === Infinity || text.length <= maxLength) {
    return text
  }
  return text.substring(0, maxLength) + '...'
}

/**
 * Gets the AI SDK v5 max output token setting with a legacy fallback.
 *
 * AI SDK renamed maxTokens to maxOutputTokens. Keeping maxTokens as a fallback
 * makes this provider tolerant of older call sites without ignoring new ones.
 */
export function getMaxOutputTokens(settings: any, fallback: number): number {
  return settings.maxOutputTokens ?? settings.maxTokens ?? fallback
}

const BedrockInferenceProfilePrefixes = ['us', 'eu', 'apac', 'global', 'jp', 'au']

/**
 * Removes the geography prefix from Bedrock system inference profile IDs.
 *
 * Example: global.anthropic.claude-sonnet-4-5... -> anthropic.claude-sonnet-4-5...
 */
export function getBaseModelId(modelId: string): string {
  const [prefix, ...rest] = modelId.split('.')
  if (rest.length > 0 && BedrockInferenceProfilePrefixes.includes(prefix)) {
    return rest.join('.')
  }
  return modelId
}

export function modelIdStartsWith(modelId: string, prefix: string): boolean {
  return getBaseModelId(modelId).startsWith(prefix)
}

/**
 * Converts an async generator to a ReadableStream
 *
 * Required for browser compatibility with streaming responses
 *
 * @param generator - Async generator yielding stream chunks
 * @returns ReadableStream that can be consumed by browsers
 */
export function convertAsyncGeneratorToReadableStream<T>(
  generator: AsyncGenerator<T>
): ReadableStream<T> {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          controller.enqueue(chunk)
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    }
  })
}

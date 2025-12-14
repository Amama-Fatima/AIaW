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

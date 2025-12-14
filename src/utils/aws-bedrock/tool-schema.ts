import { extractBaseToolName, getTruncationConfig, truncateText } from './utils'
import type { ToolNameMapping } from './types'

export interface ProcessedTools {
  tools: any[]
  toolMapping: ToolNameMapping
}

/**
 * Extracts and cleans JSON schema from AI SDK tool definition
 *
 * The AI SDK may wrap schemas in various ways. This function normalizes them.
 *
 * @param tool - AI SDK tool definition
 * @returns Clean JSON schema object
 */
function extractInputSchema(tool: any): any {
  let inputSchema = tool.inputSchema || tool.parameters || { type: 'object', properties: {} }

  if (inputSchema.$schema || inputSchema.__absolute_uri__) {
    inputSchema = { ...inputSchema }
  } else if (inputSchema.jsonSchema) {
    inputSchema = inputSchema.jsonSchema
  }

  if (!inputSchema.type) {
    inputSchema.type = 'object'
  }
  if (!inputSchema.properties) {
    inputSchema.properties = {}
  }

  return inputSchema
}

/**
 * Identifies flow-control boolean properties that should be required
 *
 * Claude sometimes omits optional booleans with defaults (e.g., continue_needed: false)
 * This causes infinite loops where Claude never signals completion.
 *
 * We force these booleans to be required so Claude must provide them.
 *
 * @param properties - Schema properties object
 * @param existingRequired - Existing required fields
 * @returns Updated required fields array
 */
function identifyRequiredBooleans(properties: any, existingRequired: string[]): string[] {
  const required = [...existingRequired]

  Object.entries(properties).forEach(([propName, propSchema]: [string, any]) => {
    const isFlowControlBoolean =
      propSchema.type === 'boolean' &&
      propSchema.default !== undefined &&
      !required.includes(propName) &&
      (propName.includes('needed') || propName.includes('continue') || propName.includes('next'))

    if (isFlowControlBoolean) {
      required.push(propName)
    }
  })

  return required
}

/**
 * Normalizes integer schema constraints for better Claude understanding
 *
 * Converts exclusiveMinimum to minimum (more explicit)
 * Example: exclusiveMinimum: 0 -> minimum: 1
 *
 * @param properties - Schema properties object
 */
function normalizeIntegerConstraints(properties: any): void {
  Object.values(properties).forEach((schema: any) => {
    if (schema.type === 'integer' && schema.exclusiveMinimum !== undefined) {
      schema.minimum = schema.exclusiveMinimum + 1
      delete schema.exclusiveMinimum
    }
  })
}

/**
 * Truncates property descriptions based on truncation config
 *
 * @param properties - Schema properties object
 * @param maxLength - Maximum description length
 */
function truncatePropertyDescriptions(properties: any, maxLength: number): void {
  Object.values(properties).forEach((propSchema: any) => {
    if (propSchema.description) {
      propSchema.description = truncateText(propSchema.description, maxLength)
    }
  })
}

/**
 * Creates a clean schema object for Bedrock API
 *
 * @param inputSchema - Raw input schema
 * @param shouldTruncate - Whether to apply truncation
 * @param maxPropertyDescLength - Max length for property descriptions
 * @returns Clean schema object
 */
function createCleanSchema(
  inputSchema: any,
  shouldTruncate: boolean,
  maxPropertyDescLength: number
): any {
  const requiredFields = identifyRequiredBooleans(
    inputSchema.properties || {},
    inputSchema.required || []
  )

  const cleanSchema = {
    type: inputSchema.type,
    properties: inputSchema.properties,
    required: requiredFields,
    additionalProperties: inputSchema.additionalProperties
  }

  if (shouldTruncate && cleanSchema.properties) {
    truncatePropertyDescriptions(cleanSchema.properties, maxPropertyDescLength)
  }

  if (cleanSchema.properties) {
    normalizeIntegerConstraints(cleanSchema.properties)
  }

  return cleanSchema
}

/**
 * Processes all tools for Claude API
 *
 * Handles:
 * - Schema extraction and cleaning
 * - Description truncation for large tool sets (150+ MCP tools)
 * - Boolean flow-control marking as required
 * - Tool name mapping (Bedrock strips prefixes)
 *
 * @param tools - Array of AI SDK tool definitions
 * @returns Processed tools and name mapping
 */
export function processToolsForClaude(tools: any[]): ProcessedTools {
  if (!tools || tools.length === 0) {
    return { tools: [], toolMapping: {} }
  }

  const toolCount = tools.length
  const config = getTruncationConfig(toolCount)

  if (config.shouldTruncate) {
    console.log(
      `⚠️ Truncating tool descriptions: ${toolCount} tools detected, ` +
      `max description: ${config.maxDescriptionLength} chars, ` +
      `max property desc: ${config.maxPropertyDescLength} chars`
    )
  }

  const toolMapping: ToolNameMapping = {}

  const processedTools = tools.map((tool: any) => {
    const inputSchema = extractInputSchema(tool)
    const cleanSchema = createCleanSchema(
      inputSchema,
      config.shouldTruncate,
      config.maxPropertyDescLength
    )

    // Extract base name for Bedrock (Claude strips prefixes)
    const baseName = extractBaseToolName(tool.name)

    toolMapping[baseName] = tool.name

    const description = truncateText(
      tool.description || '',
      config.maxDescriptionLength
    )

    return {
      name: baseName,
      description,
      input_schema: cleanSchema
    }
  })

  return { tools: processedTools, toolMapping }
}

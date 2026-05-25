import { extractBaseToolName, getTruncationConfig, truncateText } from './utils'
import type { ToolNameMapping } from './types'

export interface ProcessedTools {
  tools: any[]
  toolMapping: ToolNameMapping
}

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

function normalizeIntegerConstraints(properties: any): void {
  Object.values(properties).forEach((schema: any) => {
    if (schema.type === 'integer' && schema.exclusiveMinimum !== undefined) {
      schema.minimum = schema.exclusiveMinimum + 1
      delete schema.exclusiveMinimum
    }
  })
}

function truncatePropertyDescriptions(properties: any, maxLength: number): void {
  Object.values(properties).forEach((propSchema: any) => {
    if (propSchema.description) {
      propSchema.description = truncateText(propSchema.description, maxLength)
    }
  })
}

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

export function processToolsForClaude(tools: any[]): ProcessedTools {
  if (!tools || tools.length === 0) {
    return { tools: [], toolMapping: {} }
  }

  const toolCount = tools.length
  const config = getTruncationConfig(toolCount)

  const toolMapping: ToolNameMapping = {}

  const processedTools = tools.map((tool: any) => {
    const inputSchema = extractInputSchema(tool)
    const cleanSchema = createCleanSchema(
      inputSchema,
      config.shouldTruncate,
      config.maxPropertyDescLength
    )

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

/**
 * Extracts base tool name by removing MCP namespace prefix
 */
function extractBaseToolName(fullName: string): string {
  const match = fullName.match(/^[a-zA-Z0-9]+-(.+)$/) || fullName.match(/^[a-zA-Z0-9]+_(.+)$/)
  return match ? match[1] : fullName
}

/**
 * Converts prompt to Amazon Nova format with extensive debugging
 */
export function convertToNovaFormat(prompt: any[], settings: any): any {
  const messages = prompt.map((msg: any, idx: number) => {
    console.log(`\n📨 Processing message ${idx}:`, msg.role)

    if (msg.role === 'tool') {
      const toolResult = {
        role: 'user',
        content: msg.content.map((c: any) => {
          // Parse the result properly
          let resultContent

          if (typeof c.result === 'string') {
            // Try to parse as JSON
            try {
              const parsed = JSON.parse(c.result)
              resultContent = { json: parsed }
            } catch {
              // Not JSON, use text
              resultContent = { text: c.result }
            }
          } else if (c.result && typeof c.result === 'object') {
            resultContent = { json: c.result }
          } else {
            resultContent = { text: String(c.result || '') }
          }

          return {
            toolResult: {
              toolUseId: c.toolCallId,
              content: [resultContent]
            }
          }
        })
      }
      console.log('🔧 Tool result message:', JSON.stringify(toolResult, null, 2))
      return toolResult
    }

    const processedContent = Array.isArray(msg.content)
      ? msg.content.map((c: any, cIdx: number) => {
        console.log(`  📝 Content block ${cIdx}:`, c.type)

        if (c.type === 'text') {
          return { text: c.text }
        }

        if (c.type === 'tool-call') {
          console.log('    🔨 Tool call detected!')
          console.log('    - toolCallId:', c.toolCallId)
          console.log('    - toolName:', c.toolName)
          console.log('    - input (raw):', c.input)

          let inputObject
          try {
            inputObject = typeof c.input === 'string'
              ? JSON.parse(c.input)
              : c.input
            console.log('    - input (parsed):', JSON.stringify(inputObject, null, 2))
          } catch (e) {
            console.error('    ❌ Failed to parse tool input:', e)
            inputObject = {}
          }

          const toolUse = {
            toolUse: {
              toolUseId: c.toolCallId,
              name: c.toolName,
              input: inputObject
            }
          }
          return toolUse
        }

        if (c.type === 'file' && c.mimeType?.startsWith('image/')) {
          return {
            image: {
              format: c.mimeType.split('/')[1] || 'jpeg',
              source: { bytes: c.data }
            }
          }
        }

        return c
      })
      : [{ text: typeof msg.content === 'string' ? msg.content : '' }]

    return {
      role: msg.role,
      content: processedContent
    }
  })

  let cleanedTools: any[] = []
  const toolNameMapping: { [safeName: string]: string } = {}

  if (settings.tools && settings.tools.length > 0) {
    console.log('\n🔧 === PROCESSING TOOLS ===')
    console.log('📋 Original tools count:', settings.tools.length)

    cleanedTools = settings.tools.map((tool: any, idx: number) => {
      console.log(`\n🔨 Tool ${idx}: ${tool.name}`)

      const baseName = extractBaseToolName(tool.name)
      const safeName = baseName.replace(/-/g, '_')

      if (safeName !== tool.name) {
        console.log(`  ⚠️ Transformed tool name: ${tool.name} → ${safeName}`)
        toolNameMapping[safeName] = tool.name
      }

      const originalSchema = tool.inputSchema || tool.parameters
      console.log('  Original schema:', JSON.stringify(originalSchema, null, 2))

      const cleanedSchema = cleanNovaSchema(originalSchema)
      console.log('  Cleaned schema:', JSON.stringify(cleanedSchema, null, 2))

      return {
        toolSpec: {
          name: safeName,
          description: tool.description || '',
          inputSchema: {
            json: cleanedSchema
          }
        }
      }
    })

    console.log('\n✅ Cleaned tools:', JSON.stringify(cleanedTools, null, 2))
  }

  // CRITICAL: Set temperature to 0 for tool calling (AWS recommendation)
  const inferenceConfig: any = {
    max_new_tokens: settings.maxTokens || 2048,
    temperature: 0, // MUST be 0 for tool calling
    top_p: settings.topP
  }

  console.log('\n⚙️ Inference config:', JSON.stringify(inferenceConfig, null, 2))

  const body: any = {
    messages,
    inferenceConfig
  }

  if (cleanedTools.length > 0) {
    body.toolConfig = {
      tools: cleanedTools,
      // Optional: Force tool usage
      toolChoice: { auto: {} } // Let model decide, or use { any: {} } to require tool use
    }
    console.log('\n🔧 Tool config added to body')
    console.log('  Tool choice:', body.toolConfig.toolChoice)
  }

  // Store the tool name mapping so we can reverse it later
  if (Object.keys(toolNameMapping).length > 0) {
    body._toolNameMapping = toolNameMapping
    console.log('\n🗺️ Tool name mapping:', JSON.stringify(toolNameMapping, null, 2))
  }

  console.log('\n📦 === FINAL REQUEST BODY ===')
  console.log(JSON.stringify(body, null, 2))
  console.log('🔍 === NOVA FORMAT CONVERSION END ===\n')

  return body
}

/**
 * Clean JSON schema to only include fields supported by Nova
 * Nova only supports: type, properties, required at top level
 */
function cleanNovaSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const cleaned: any = {}

  // Only include supported fields
  if (schema.type) {
    cleaned.type = schema.type
  }

  if (schema.properties) {
    cleaned.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      cleaned.properties[key] = cleanNovaSchemaProperty(value)
    }
  }

  if (schema.required) {
    cleaned.required = schema.required
  }

  // Log removed fields
  const removedFields = Object.keys(schema).filter(
    k => !['type', 'properties', 'required'].includes(k)
  )
  if (removedFields.length > 0) {
    console.log(`    ⚠️ Removed unsupported fields: ${removedFields.join(', ')}`)
  }

  return cleaned
}

/**
 * Clean individual property schemas
 */
function cleanNovaSchemaProperty(prop: any): any {
  if (!prop || typeof prop !== 'object') {
    return prop
  }

  const cleaned: any = {}

  // Allowed fields for properties
  const allowedFields = ['type', 'description', 'enum', 'items', 'properties', 'required']

  for (const field of allowedFields) {
    if (prop[field] !== undefined) {
      if (field === 'items' || field === 'properties') {
        cleaned[field] = cleanNovaSchemaProperty(prop[field])
      } else {
        cleaned[field] = prop[field]
      }
    }
  }

  return cleaned
}

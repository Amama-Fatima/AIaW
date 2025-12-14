/**
 * Coerces tool input types based on the tool's JSON schema
 *
 * Problem: Claude sometimes returns strings for integers/booleans
 * Example: { "count": "5", "enabled": "true" } should be { "count": 5, "enabled": true }
 *
 * This function fixes type mismatches by parsing the raw input according to
 * the schema's type definitions
 *
 * @param toolName - Name of the tool being called
 * @param rawInput - Raw input object from Claude (may have wrong types)
 * @param toolSchemas - Array of tool schema definitions
 * @returns Coerced input with correct types
 */
export function coerceToolInput(
  toolName: string,
  rawInput: any,
  toolSchemas: any[]
): any {
  if (!toolSchemas || !Array.isArray(toolSchemas)) {
    return rawInput
  }

  const toolSchema = toolSchemas.find(t => t.name === toolName)
  if (!toolSchema || !toolSchema.inputSchema) {
    return rawInput
  }

  const schema = toolSchema.inputSchema
  const properties = schema.properties || {}
  const coerced: any = { ...rawInput }

  for (const [key, value] of Object.entries(rawInput)) {
    const propSchema = properties[key]
    if (!propSchema) continue

    const targetType = propSchema.type

    if (targetType === 'string') continue

    if (targetType === 'integer' && typeof value === 'string') {
      const parsed = parseInt(value, 10)
      if (!isNaN(parsed)) {
        coerced[key] = parsed
      }
    }

    if (targetType === 'number' && typeof value === 'string') {
      const parsed = parseFloat(value)
      if (!isNaN(parsed)) {
        coerced[key] = parsed
      }
    }

    if (targetType === 'boolean' && typeof value === 'string') {
      if (value === 'true') coerced[key] = true
      else if (value === 'false') coerced[key] = false
    }
  }

  return coerced
}

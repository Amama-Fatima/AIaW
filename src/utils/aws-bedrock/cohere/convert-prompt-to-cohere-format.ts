export function convertToCohereFormat(prompt: any[], settings: any): any {
  const messages = prompt.map((msg: any) => {
    if (msg.role === 'system') return null

    if (msg.role === 'tool') {
      return {
        role: 'TOOL',
        tool_results: msg.content.map((c: any) => ({
          call: { name: c.toolName || 'unknown', parameters: {} },
          outputs: [{ result: typeof c.result === 'string' ? c.result : JSON.stringify(c.result) }]
        }))
      }
    }

    return {
      role: msg.role === 'user' ? 'USER' : 'CHATBOT',
      message: Array.isArray(msg.content)
        ? msg.content.map((c: any) => {
          if (c.type === 'text') return c.text
          if (c.type === 'tool-call') {
            return `[Tool Call: ${c.toolName}(${JSON.stringify(c.args)})]`
          }
          return ''
        }).filter(Boolean).join('\n')
        : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''
    }
  }).filter(Boolean)

  const body: any = {
    message: messages[messages.length - 1]?.message || '',
    chat_history: messages.slice(0, -1),
    max_tokens: settings.maxTokens || 2048,
    temperature: settings.temperature
  }

  if (settings.topP !== undefined) {
    body.p = Math.min(settings.topP, 0.99)
  } else {
    body.p = 0.99
  }

  if (settings.tools && settings.tools.length > 0) {
    body.tools = settings.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      parameter_definitions: tool.parameters.properties || {}
    }))
  }

  return body
}

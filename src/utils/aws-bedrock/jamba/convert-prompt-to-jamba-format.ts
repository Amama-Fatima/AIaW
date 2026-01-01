export function convertToJambaFormat(prompt: any[], settings: any): any {
  const messages = prompt.map((msg: any) => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content.map((c: any) => ({
          type: 'tool_result',
          tool_use_id: c.toolCallId,
          content: typeof c.result === 'string' ? c.result : JSON.stringify(c.result)
        }))
      }
    }

    return {
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map((c: any) => {
          if (c.type === 'text') return c.text
          if (c.type === 'tool-call') {
            return JSON.stringify({
              type: 'tool_use',
              id: c.toolCallId,
              name: c.toolName,
              input: c.args
            })
          }
          return ''
        }).filter(Boolean).join('\n')
        : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''
    }
  })

  const body: any = {
    messages,
    max_tokens: settings.maxTokens || 2048
  }

  // Add optional parameters only if they're provided
  if (settings.temperature !== undefined) {
    body.temperature = settings.temperature
  }
  if (settings.topP !== undefined) {
    body.top_p = settings.topP
  }

  if (settings.tools && settings.tools.length > 0) {
    body.tools = settings.tools.map((tool: any) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters
      }
    }))
  }

  return body
}

/* eslint-disable brace-style */

export function convertToMistralFormat(prompt: any[], settings: any): any {
  let formattedPrompt = ''
  const hasTools = settings.tools && settings.tools.length > 0

  if (hasTools) {
    const toolDescriptions = settings.tools.map((tool: any) => {
      return `[TOOL] ${tool.name}: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`
    }).join('\n')
    formattedPrompt += `[INST] ${toolDescriptions} [/INST]\n`
  }

  formattedPrompt += prompt.map((msg: any) => {
    if (msg.role === 'tool') {
      const results = msg.content.map((c: any) =>
        `[TOOL_RESULT ${c.toolCallId}] ${typeof c.result === 'string' ? c.result : JSON.stringify(c.result)}`
      ).join('\n')
      return `[INST] ${results} [/INST]`
    }

    const content = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
        if (c.type === 'text') return c.text
        if (c.type === 'tool-call') {
          return `[TOOL_CALL] {"name": "${c.toolName}", "arguments": ${JSON.stringify(c.args)}}`
        }
        return ''
      }).filter(Boolean).join('\n')
      : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''

    return msg.role === 'user' ? `[INST] ${content} [/INST]` : content
  }).join('\n')

  return {
    prompt: formattedPrompt,
    max_tokens: settings.maxTokens || 2048,
    temperature: settings.temperature,
    top_p: settings.topP
  }
}

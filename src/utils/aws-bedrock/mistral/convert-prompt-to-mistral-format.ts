import { getMaxOutputTokens } from '../utils'
import {
  convertMistralMessage,
  createMistralToolConfig,
  filterEmptyMistralMessages,
  prepareMistralPrompt,
  supportsMistralNativeToolConfig
} from './helper-function'

export function convertToMistralFormat(
  prompt: any[],
  settings: any,
  modelId = ''
): {
  body: any;
  toolMapping: { [key: string]: string };
  useConverseApi: boolean
} {
  const finalPrompt = prepareMistralPrompt(prompt)
  const { toolConfig, toolMapping, originalToSafeToolName } = createMistralToolConfig(settings.tools || [])
  const messages = filterEmptyMistralMessages(
    finalPrompt.map((msg: any) => convertMistralMessage(msg, originalToSafeToolName))
  )

  const body: any = {
    messages,
    inferenceConfig: {
      maxTokens: getMaxOutputTokens(settings, 2048),
      temperature: settings.temperature ?? 0.7,
      topP: settings.topP ?? 0.9
    }
  }

  if (toolConfig) {
    if (!supportsMistralNativeToolConfig(modelId)) {
      throw new Error(
        `AWS Bedrock model ${modelId} does not support native tool use. ` +
        'Disable tools/plugins or choose a Mistral model that supports Bedrock tool use, such as Mistral Large or Magistral.'
      )
    }

    body.toolConfig = toolConfig
  }

  return {
    body,
    toolMapping,
    useConverseApi: true
  }
}

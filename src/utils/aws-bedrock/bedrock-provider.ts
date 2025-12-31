import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ConverseCommand,
  ConverseStreamCommand
} from '@aws-sdk/client-bedrock-runtime'
import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'

import { convertPromptToBedrock } from './prompt-converter'
import { convertBedrockResponse } from './response-converter'
import { createBedrockStream } from './stream-processor'
import { convertAsyncGeneratorToReadableStream } from './utils'
import type { BedrockConfig, BedrockModelFactory } from './types'

/**
 * Creates a Bedrock provider with AWS credentials
 */
export function createBedrock(config: BedrockConfig): BedrockModelFactory {
  if (!config.accessKeyId || !config.secretAccessKey || !config.region) {
    throw new Error(
      'AWS Bedrock credentials are incomplete. ' +
      'Please check accessKeyId, secretAccessKey, and region.'
    )
  }

  const client = new BedrockRuntimeClient({
    region: config.region.trim(),
    credentials: {
      accessKeyId: config.accessKeyId.trim(),
      secretAccessKey: config.secretAccessKey.trim()
    }
  })

  return (modelId: string): LanguageModelV2 => {
    return {
      specificationVersion: 'v2' as const,
      provider: 'aws-bedrock',
      modelId,
      supportedUrls: {},

      /**
       * Non-streaming generation
       */
      async doGenerate(options: LanguageModelV2CallOptions) {
        const { prompt, ...settings } = options

        const result = convertPromptToBedrock(modelId, prompt, settings)

        const body = result.body || result
        const toolMapping = result.toolMapping || body._toolMapping || {}

        const useConverseApi = result.useConverseApi || body._useConverseApi || false

        delete body._toolMapping
        delete body._useConverseApi

        if (modelId.startsWith('amazon.nova') && useConverseApi) {
          const command = new ConverseCommand({
            modelId,
            messages: body.messages,
            toolConfig: body.toolConfig,
            inferenceConfig: body.inferenceConfig,
            system: body.system
          })

          try {
            const response = await client.send(command)
            return convertBedrockResponse(modelId, response, body, toolMapping)
          } catch (error) {
            console.error('\n Bedrock Converse API error:', error)
            throw error
          }
        }

        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body)
        })

        try {
          const response = await client.send(command)
          const responseBody = JSON.parse(new TextDecoder().decode(response.body))
          return convertBedrockResponse(modelId, responseBody, body, toolMapping)
        } catch (error) {
          console.error('Bedrock API error:', error)
          throw error
        }
      },

      /**
       * Streaming generation
      */
      async doStream(options: LanguageModelV2CallOptions) {
        const { prompt, ...settings } = options
        const result = convertPromptToBedrock(modelId, prompt, settings)

        const body = result.body || result
        const toolMapping = result.toolMapping || body._toolMapping || {}
        const useConverseApi = result.useConverseApi || body._useConverseApi || false

        delete body._toolMapping
        delete body._useConverseApi

        if (modelId.startsWith('amazon.nova') && useConverseApi) {
          const command = new ConverseStreamCommand({
            modelId,
            messages: body.messages,
            toolConfig: body.toolConfig,
            inferenceConfig: body.inferenceConfig,
            system: body.system
          })

          try {
            const response = await client.send(command)

            return {
              stream: convertAsyncGeneratorToReadableStream(
                createBedrockStream(
                  modelId,
                  response.stream,
                  toolMapping,
                  settings.tools || []
                )
              ),
              rawCall: {
                rawPrompt: body,
                rawSettings: settings
              }
            }
          } catch (error) {
            console.error('\n Bedrock ConverseStream error:', error)

            throw error
          }
        }

        const command = new InvokeModelWithResponseStreamCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body)
        })

        try {
          const response = await client.send(command)

          return {
            stream: convertAsyncGeneratorToReadableStream(
              createBedrockStream(
                modelId,
                response.body,
                toolMapping,
                settings.tools || []
              )
            ),
            rawCall: {
              rawPrompt: body,
              rawSettings: settings
            }
          }
        } catch (error) {
          console.error('Bedrock streaming error:', error)
          throw error
        }
      }
    }
  }
}

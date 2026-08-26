# Chat Completions Gateway Compatibility

## Scope

Pi Desktop sends requests to the configured `baseUrl` through the OpenAI Chat
Completions API:

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <api-key>
Accept: application/json
```

This is not the OpenAI Responses API and not the Anthropic Messages API. In
particular, the request does not use `input`, `previous_response_id`, `output`,
or `function_call_output` items.

## Required Request Support

The gateway must accept this request shape:

```json
{
  "model": "glm-5.3",
  "messages": [],
  "stream": true,
  "stream_options": { "include_usage": true },
  "store": false,
  "max_completion_tokens": 16384,
  "tools": [],
  "tool_choice": "auto"
}
```

`max_tokens` may be used instead of `max_completion_tokens` for a provider
whose gateway explicitly requires the legacy field. The gateway should either
support both names or document the required one.

`stream_options` and `store` are optional OpenAI-compatible fields. They should
be accepted and ignored when unsupported rather than rejected. `tools` may be
an empty array after a conversation has used tools.

## Message Rules

The `messages` array is Chat Completions history. The gateway must preserve its
order and support these roles.

| Role | `content` accepted by the gateway | Other required fields |
| --- | --- | --- |
| `system` | string | none |
| `developer` | string | none |
| `user` | string, or an array of text/image parts | none |
| `assistant` | string or `null` | `tool_calls` when the model requests tools |
| `tool` | string | `tool_call_id` matching an earlier tool call |

For a reasoning model, Pi Desktop can send the system prompt with
`role: "developer"`. The gateway must accept both `system` and `developer`.

The important compatibility point is an assistant turn that only contains tool
calls. OpenAI Chat Completions represents it with `content: null`:

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_01",
      "type": "function",
      "function": {
        "name": "bash",
        "arguments": "{\"command\":\"pwd\"}"
      }
    }
  ]
}
```

The gateway must accept `null` here. Rejecting it as an invalid
`messages[n].content` type breaks valid tool-calling conversations after the
first tool turn. It may optionally normalize this value internally to an empty
string, but it must not reject the request.

`assistant.content` is a string for normal assistant text turns. `tool.content`
is always a string, including command output, JSON text, or a placeholder when
the tool has no textual output.

## Tool Schema

When tools are available, they use the Chat Completions function-tool shape:

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "bash",
        "description": "Run a shell command",
        "parameters": {
          "type": "object",
          "properties": {
            "command": { "type": "string" }
          },
          "required": ["command"],
          "additionalProperties": false
        },
        "strict": false
      }
    }
  ],
  "tool_choice": "auto"
}
```

The gateway must tolerate the optional `strict` field. A model may return one
or more entries in `tool_calls`; every entry must have a stable `id`, a
`type: "function"`, and `function.name` / JSON-string `function.arguments`.

## Complete Tool-Use Example

This is a valid history after the model has called `bash` and Pi Desktop has
supplied the result. The error observed in production is consistent with a
gateway rejecting the second entry's `content: null`.

```json
{
  "model": "glm-5.3",
  "stream": true,
  "messages": [
    {
      "role": "developer",
      "content": "You are a coding assistant."
    },
    {
      "role": "user",
      "content": "Show the current directory."
    },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_01",
          "type": "function",
          "function": {
            "name": "bash",
            "arguments": "{\"command\":\"pwd\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_01",
      "content": "/workspace\\n"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "bash",
        "description": "Run a shell command",
        "parameters": { "type": "object", "properties": {} },
        "strict": false
      }
    }
  ]
}
```

The following sequence is valid and must be supported repeatedly:

1. `assistant` returns `tool_calls` with `content: null`.
2. The client appends one `tool` message for each tool call, using the same ID.
3. The client sends the complete history back to `/v1/chat/completions`.
4. The gateway returns the next assistant response or further `tool_calls`.

## Streaming Response Support

For `stream: true`, return Server-Sent Events in the Chat Completions chunk
format and terminate with `data: [DONE]`:

```text
data: {"id":"chatcmpl_01","object":"chat.completion.chunk","created":0,"model":"glm-5.3","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl_01","object":"chat.completion.chunk","created":0,"model":"glm-5.3","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_01","type":"function","function":{"name":"bash","arguments":"{\\\"command\\\":\\\"pwd"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl_01","object":"chat.completion.chunk","created":0,"model":"glm-5.3","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"}"}}]},"finish_reason":"tool_calls"}]}

data: [DONE]
```

For text output, stream text in `choices[0].delta.content` and finish with
`finish_reason: "stop"`. For a tool call, finish with
`finish_reason: "tool_calls"`. Include a final usage chunk when
`stream_options.include_usage` is requested if usage accounting is available.

## Gateway Acceptance Checklist

- Route `POST /v1/chat/completions`, not `/v1/responses`.
- Accept `system` and `developer` roles.
- Accept assistant `content` as either a string or `null`.
- Accept `tool_calls` on assistant messages and `tool_call_id` on tool messages.
- Keep tool-call IDs unchanged across request and response.
- Accept `tools`, `tool_choice`, `stream_options`, and `store`.
- Stream OpenAI Chat Completions SSE chunks and emit `[DONE]`.
- Do not validate Chat Completions messages with a Responses or Anthropic
  content-block schema.

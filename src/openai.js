const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function nullable(type) {
  const list = Array.isArray(type) ? type : [type];
  return list.includes('null') ? list : [...list, 'null'];
}

function strictSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = { ...schema };
  if (out.type === 'array' && out.items) out.items = strictSchema(out.items);
  if (out.properties) {
    const required = new Set(schema.required || []);
    out.properties = {};
    for (const [name, value] of Object.entries(schema.properties)) {
      const inner = strictSchema(value);
      out.properties[name] = required.has(name) ? inner : { ...inner, type: nullable(inner.type) };
    }
    out.required = Object.keys(schema.properties);
    out.additionalProperties = false;
  }
  return out;
}

function partOf(block) {
  if (block.type === 'image' && block.source && block.source.type === 'base64') {
    return { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
  }
  return { type: 'text', text: block.text || '' };
}

function toOpenAI(request) {
  const messages = [];
  if (request.system) messages.push({ role: 'system', content: request.system });
  for (const message of request.messages || []) {
    messages.push({
      role: message.role,
      content: Array.isArray(message.content) ? message.content.map(partOf) : message.content,
    });
  }

  const body = { model: request.model, messages, max_completion_tokens: request.max_tokens };
  const output = request.output_config || {};
  if (output.format && output.format.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'answer', schema: strictSchema(output.format.schema), strict: true },
    };
  }
  if (output.effort) body.reasoning_effort = output.effort;
  return body;
}

function fromOpenAI(data) {
  const choice = (data.choices && data.choices[0]) || {};
  const message = choice.message || {};
  const usage = data.usage || {};
  const out = {
    content: [{ type: 'text', text: message.content || '' }],
    usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 },
    stop_reason: choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    stop_details: null,
  };
  if (message.refusal) {
    out.stop_reason = 'refusal';
    out.stop_details = { category: null, explanation: message.refusal };
  }
  return out;
}

function createOpenAICall(apiKey, { fetchImpl = fetch } = {}) {
  return async (request) => {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toOpenAI(request)),
    });
    const data = await response.json();
    if (!response.ok) {
      const err = new Error(`OpenAI ${response.status}: ${(data.error && data.error.message) || 'без описания'}`);
      err.status = response.status;
      throw err;
    }
    return fromOpenAI(data);
  };
}

module.exports = { createOpenAICall, toOpenAI, fromOpenAI, strictSchema };

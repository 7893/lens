export class ClassifyWithModelTask {
  async run(env, { description, modelName }) {
    const prompt = `Classify this image into ONE category. Return ONLY a JSON object: {"label": "category-name", "score": 0.95}

Description: "${description}"

Return a single-word or hyphenated category (lowercase) with confidence score 0-1.`;

    try {
      const response = await env.AI.run(modelName, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 50,
        temperature: 0.1
      });

      const text = response.response?.trim();
      if (!text) return null;

      const jsonMatch = text.match(/\{[^}]+\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      if (!result.label || !result.score) return null;

      const label = result.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const score = parseFloat(result.score);

      if (label && score >= 0 && score <= 1) {
        return { label, score, model: modelName };
      }
      return null;
    } catch (error) {
      console.error(`Model ${modelName} failed:`, error.message);
      return null;
    }
  }
}

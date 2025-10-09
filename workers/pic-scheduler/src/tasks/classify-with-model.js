export class ClassifyWithModelTask {
  async run(env, { description, modelName }) {
    const prompt = `Classify this image into ONE category. Return ONLY a JSON object: {"label": "category-name", "score": 0.95}

Description: "${description}"

Return a single-word or hyphenated category (lowercase) with confidence score 0-1.`;

    const maxRetries = 1;
    const timeout = 30000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI timeout')), timeout)
        );

        const aiPromise = env.AI.run(modelName, {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 50,
          temperature: 0.1
        });

        const response = await Promise.race([aiPromise, timeoutPromise]);

        const text = response.response?.trim();
        if (!text) continue;

        const jsonMatch = text.match(/\{[^}]+\}/);
        if (!jsonMatch) continue;

        const result = JSON.parse(jsonMatch[0]);
        if (!result.label || !result.score) continue;

        const label = result.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const score = parseFloat(result.score);

        if (label && score >= 0 && score <= 1) {
          return { label, score, model: modelName };
        }
      } catch (error) {
        if (attempt === maxRetries) {
          console.error(`Model ${modelName} failed after ${maxRetries + 1} attempts:`, error.message);
          return null;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return null;
  }
}

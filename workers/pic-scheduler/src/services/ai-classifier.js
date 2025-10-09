export class AIClassifier {
  constructor(ai) {
    this.ai = ai;
    this.models = [
      '@cf/meta/llama-3-8b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/mistral/mistral-7b-instruct-v0.1',
      '@cf/meta/llama-3.2-3b-instruct'
    ];
  }

  async classifyWithModel(description, modelName) {
    const prompt = `Classify this image into ONE category. Return ONLY a JSON object with format: {"label": "category-name", "score": 0.95}

Description: "${description}"

Return a single-word or hyphenated category (lowercase) with confidence score 0-1.
Examples: {"label": "nature", "score": 0.92}, {"label": "street-photography", "score": 0.88}`;

    try {
      const response = await this.ai.run(modelName, {
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
        return { label, score };
      }
      return null;
    } catch (error) {
      console.error(`Model ${modelName} failed:`, error.message);
      return null;
    }
  }

  async classifyImage(description) {
    const results = await Promise.all(
      this.models.map(model => this.classifyWithModel(description, model))
    );

    const validResults = results.filter(r => r !== null);
    if (validResults.length === 0) {
      return { category: 'uncategorized', confidence: 0, scores: {} };
    }

    // 置信度加权：汇总相同标签的分数
    const scoreMap = {};
    validResults.forEach(({ label, score }) => {
      scoreMap[label] = (scoreMap[label] || 0) + score;
    });

    // 找出总分最高的标签
    let bestLabel = 'uncategorized';
    let bestScore = 0;
    for (const [label, totalScore] of Object.entries(scoreMap)) {
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestLabel = label;
      }
    }

    return {
      category: bestLabel,
      confidence: bestScore / this.models.length, // 归一化
      scores: scoreMap
    };
  }
}

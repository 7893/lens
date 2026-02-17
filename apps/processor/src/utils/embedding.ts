export function buildEmbeddingText(caption: string, tags: string[], meta?: any): string {
  const parts = [caption];
  if (tags.length) parts.push(`Tags: ${tags.join(', ')}`);
  if (meta?.alt_description) parts.push(meta.alt_description);
  if (meta?.description) parts.push(meta.description);
  if (meta?.user?.name) parts.push(`Photographer: ${meta.user.name}`);
  if (meta?.location?.name) parts.push(`Location: ${meta.location.name}`);
  const topics = Object.keys(meta?.topic_submissions || {});
  if (topics.length) parts.push(`Topics: ${topics.join(', ')}`);
  return parts.join(' | ');
}
